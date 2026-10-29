import {z} from 'zod';
import {randomInt,createHash} from 'node:crypto';
import {httpError} from './database.js';
import {seal,inspectCertificate,secretContext} from './secrets.js';
import {enqueue} from './queue.js';

export const ufCodes={RO:11,AC:12,AM:13,RR:14,PA:15,AP:16,TO:17,MA:21,PI:22,CE:23,RN:24,PB:25,PE:26,AL:27,SE:28,BA:29,MG:31,ES:32,RJ:33,SP:35,PR:41,SC:42,RS:43,MS:50,MT:51,GO:52,DF:53};
const text=z.string().trim().min(1).max(120);
export const fiscalSettingsInput=z.object({
 cnpj:z.string().regex(/^\d{14}$/),legalName:text,tradeName:text,ie:z.string().regex(/^\d{2,14}$/),
 crt:z.coerce.number().int().refine(n=>[1,2,3,4].includes(n)),environment:z.coerce.number().int().refine(n=>[1,2].includes(n)),
 series:z.coerce.number().int().min(1).max(889),nextNumber:z.coerce.number().int().min(1).max(999999999),
 timeZone:z.enum(['America/Sao_Paulo','America/Cuiaba','America/Manaus','America/Rio_Branco','America/Noronha']).default('America/Cuiaba'),
 cscId:z.string().regex(/^\d{1,6}$/),cscToken:z.string().trim().min(16).max(100).optional(),
 address:z.object({street:text,number:z.string().trim().min(1).max(20),district:text,city:text,cityCode:z.string().regex(/^\d{7}$/),uf:z.enum(Object.keys(ufCodes)),cep:z.string().regex(/^\d{8}$/),phone:z.string().regex(/^\d{10,14}$/)}).strict()
}).strict().refine(d=>d.address.cityCode.startsWith(String(ufCodes[d.address.uf])),{message:'Código IBGE incompatível com a UF.'});
const certificateInput=z.object({base64:z.string().max(1400000),password:z.string().min(1).max(256),name:z.string().trim().min(2).max(100).default('Certificado A1')}).strict();
const canonical=v=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const fiscalDraftHash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const digest=fiscalDraftHash;
export const configurationVersion=row=>digest({data:row.data,csc:row.encrypted_csc,updatedAt:row.updated_at});
function publicCertificate(row){return row?{subject:row.subject,cnpj:row.cnpj,validFrom:row.valid_from,validUntil:row.valid_until,fingerprint:row.fingerprint,active:row.active,name:row.name}:null;}
export function accessKey({uf,cnpj,series,number,issuedAt,code}) {
 const body=String(ufCodes[uf])+issuedAt.slice(2,4)+issuedAt.slice(5,7)+cnpj+'65'+String(series).padStart(3,'0')+String(number).padStart(9,'0')+'1'+code;
 let sum=0,weight=2;for(let i=body.length-1;i>=0;i--){sum+=Number(body[i])*weight;weight=weight===9?2:weight+1;}const digit=11-sum%11;
 return body+(digit>=10?0:digit);
}
export function issuedTimestamp(timeZone,date=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'}).formatToParts(date);
 const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${p.timeZoneName==='GMT'?'+00:00':p.timeZoneName.replace('GMT','')}`;
}
export function mountFiscal(app,{scoped}) {
 app.get('/api/v1/fiscal/settings',scoped('settings',false,async c=>{
  const cert=(await c.query('SELECT subject,cnpj,valid_from,valid_until,fingerprint,active,name FROM bansir.fiscal_certificates')).rows[0];
  const cfg=(await c.query('SELECT data FROM bansir.fiscal_settings')).rows[0];
  if(cfg){const counter=(await c.query('SELECT last_number FROM bansir.fiscal_numbering WHERE environment=$1 AND series=$2',[cfg.data.environment,cfg.data.series])).rows[0];if(counter)cfg.data.nextNumber=counter.last_number+1;}
  const store=(await c.query('SELECT e.legal_name,e.name,e.document_id FROM bansir.establishments e WHERE id=bansir.establishment_id()')).rows[0];
  return {data:{certificate:publicCertificate(cert),settings:cfg?.data||null,store,readiness:{encryption:!!process.env.FISCAL_ENCRYPTION_KEY,xmlStorage:!!process.env.FISCAL_S3_BUCKET,productionEnabled:process.env.FISCAL_PRODUCTION_ENABLED==='true'}}};
 }));
 app.patch('/api/v1/fiscal/certificate',scoped('settings',false,async(c,req)=>{
  const {active}=z.object({active:z.boolean()}).strict().parse(req.body);
  const row=(await c.query('UPDATE bansir.fiscal_certificates SET active=$1,updated_at=now() WHERE (NOT $1 OR valid_until>now()) RETURNING subject,cnpj,valid_from,valid_until,fingerprint,active,name',[active])).rows[0];
  if(!row)throw httpError(409,'Certificado indisponível ou vencido.','CERTIFICATE_REQUIRED');return {data:{certificate:publicCertificate(row)}};
 }));
 app.post('/api/v1/fiscal/certificate',scoped('settings',false,async(c,req)=>{
  const data=certificateInput.parse(req.body),cert=inspectCertificate(data.base64,data.password),i=req.identity;
  const store=(await c.query('SELECT document_id FROM bansir.establishments WHERE id=$1',[i.establishmentId])).rows[0];
  if(store?.document_id&&store.document_id.replace(/\D/g,'')!==cert.cnpj)throw httpError(409,'O CNPJ do certificado difere do estabelecimento selecionado.','CERTIFICATE_CNPJ_MISMATCH');
  const cfg=(await c.query('SELECT data FROM bansir.fiscal_settings')).rows[0];
  if(cfg && cfg.data.cnpj!==cert.cnpj)throw httpError(409,'O CNPJ do certificado difere do emitente cadastrado.','CERTIFICATE_CNPJ_MISMATCH');
  const encrypted=seal({base64:data.base64,password:data.password},secretContext(i,'certificate'));
  await c.query(`INSERT INTO bansir.fiscal_certificates(tenant_id,establishment_id,encrypted_bundle,subject,cnpj,fingerprint,valid_from,valid_until,name)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,establishment_id) DO UPDATE SET encrypted_bundle=EXCLUDED.encrypted_bundle,subject=EXCLUDED.subject,cnpj=EXCLUDED.cnpj,fingerprint=EXCLUDED.fingerprint,valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until,active=true,name=EXCLUDED.name,updated_at=now()`,
  [i.tenantId,i.establishmentId,encrypted,cert.subject,cert.cnpj,cert.fingerprint,cert.validFrom,cert.validUntil,data.name]);
  return {status:201,data:{certificate:{...cert}}};
 }));
 app.put('/api/v1/fiscal/settings',scoped('settings',false,async(c,req)=>{
  const data=fiscalSettingsInput.parse(req.body),i=req.identity;
  const cert=(await c.query('SELECT cnpj,valid_until,active FROM bansir.fiscal_certificates FOR UPDATE')).rows[0];
  if(!cert || cert.active===false || new Date(cert.valid_until)<=new Date())throw httpError(409,'Envie um certificado válido primeiro.','CERTIFICATE_REQUIRED');
  if(cert.cnpj!==data.cnpj)throw httpError(400,'CNPJ deve corresponder ao certificado.','CERTIFICATE_CNPJ_MISMATCH');
  const current=(await c.query('SELECT * FROM bansir.fiscal_settings')).rows[0];
  if(!data.cscToken && (!current || current.data.environment!==data.environment || current.data.cscId!==data.cscId))throw httpError(400,'Informe o CSC deste ambiente.','CSC_REQUIRED');
  const encrypted=data.cscToken?seal(data.cscToken,secretContext(i,'csc')):current.encrypted_csc;
  delete data.cscToken;
  await c.query(`INSERT INTO bansir.fiscal_settings(tenant_id,establishment_id,data,encrypted_csc) VALUES($1,$2,$3,$4)
   ON CONFLICT(tenant_id,establishment_id) DO UPDATE SET data=EXCLUDED.data,encrypted_csc=EXCLUDED.encrypted_csc,updated_at=now()`,[i.tenantId,i.establishmentId,data,encrypted]);
  // Numbering may move forward, never backward, even after a config change.
  const counter=(await c.query('SELECT last_number FROM bansir.fiscal_numbering WHERE environment=$1 AND series=$2 FOR UPDATE',[data.environment,data.series])).rows[0];
  if(counter && data.nextNumber<=counter.last_number)throw httpError(409,'Próximo número deve superar a última numeração reservada.','NUMBER_ALREADY_USED');
  await c.query(`INSERT INTO bansir.fiscal_numbering(tenant_id,establishment_id,environment,series,last_number) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(tenant_id,establishment_id,environment,series) DO UPDATE SET last_number=greatest(bansir.fiscal_numbering.last_number,EXCLUDED.last_number)`,[i.tenantId,i.establishmentId,data.environment,data.series,data.nextNumber-1]);
  return {data};
 }));
 app.get('/api/v1/fiscal/documents',scoped('fiscal',true,async c=>({data:(await c.query('SELECT id,environment,access_key,status,protocol,rejection_code,s3_key,created_at FROM bansir.fiscal_documents ORDER BY created_at DESC LIMIT 100')).rows})));
 app.get('/api/v1/fiscal/documents/:id/xml',scoped('fiscal',true,async(c,req)=>{
  const doc=(await c.query('SELECT access_key,status,xml FROM bansir.fiscal_documents WHERE id=$1',[z.uuid().parse(req.params.id)])).rows[0];
  if(!doc)throw httpError(404,'Documento não encontrado.','NOT_FOUND');
  if(doc.status!=='authorized' || !doc.xml)throw httpError(409,'XML autorizado ainda não disponível.','XML_NOT_AVAILABLE');
  return {data:{xml:doc.xml,filename:`${doc.access_key}.xml`}};
 }));
 // Fiscal draft includes accountant-approved taxes. Never invent GLP taxation from a product price.
 app.post('/api/v1/fiscal/documents',scoped('fiscal',false,async(c,req)=>{
  return {status:202,data:await createFiscalDocument(c,req.identity,req.body)};
 }));
}
export async function createFiscalDocument(c,identity,body) {
  const input=z.object({requestKey:z.uuid(),draft:z.object({det:z.array(z.object({prod:z.object({cProd:text,xProd:text,NCM:z.string().regex(/^\d{8}$/),CFOP:z.string().regex(/^\d{4}$/),qCom:z.number().positive(),vUnCom:z.number().nonnegative(),vProd:z.number().nonnegative()}).passthrough(),imposto:z.object({ICMS:z.record(z.string(),z.unknown()),PIS:z.record(z.string(),z.unknown()),COFINS:z.record(z.string(),z.unknown())}).passthrough()}).passthrough()).min(1).max(200),total:z.object({ICMSTot:z.object({vNF:z.number().positive(),vProd:z.number().positive()}).passthrough()}).strict(),pag:z.object({detPag:z.array(z.object({tPag:z.string().regex(/^\d{2}$/),vPag:z.number().nonnegative()}).passthrough()).min(1)}).passthrough(),dest:z.record(z.string(),z.unknown()).optional(),transp:z.record(z.string(),z.unknown()).optional(),infAdic:z.record(z.string(),z.unknown()).optional()}).strict()}).strict().parse(body);
  if(input.draft.det.some(d=>['ICMS','PIS','COFINS'].some(k=>!Object.keys(d.imposto[k]).length)))throw httpError(400,'Preencha a tributação de todos os itens com orientação contábil.','FISCAL_TAX_REQUIRED');
  const i=identity;
  // Lock configuration serializes allocation, idempotency and changes of certificate/config.
  const cert=(await c.query('SELECT * FROM bansir.fiscal_certificates FOR UPDATE')).rows[0];
  const cfg=(await c.query('SELECT * FROM bansir.fiscal_settings FOR UPDATE')).rows[0];
  if(!cfg || !cert || cert.active===false || new Date(cert.valid_until)<=new Date())throw httpError(409,'Cadastre certificado válido e emitente.','FISCAL_NOT_READY');
  const existing=(await c.query('SELECT id,status,payload FROM bansir.fiscal_documents WHERE request_key=$1',[input.requestKey])).rows[0];
  if(existing){if(existing.payload.draftHash!==digest(input.draft))throw httpError(409,'Identificador já usado com outro conteúdo.','IDEMPOTENCY_CONFLICT');return {id:existing.id,status:existing.status};}
  const s=cfg.data,draft=input.draft;
  if(s.environment===1 && process.env.FISCAL_PRODUCTION_ENABLED!=='true')throw httpError(409,'A emissão de produção ainda não foi habilitada neste ambiente.','PRODUCTION_DISABLED');
  const cents=n=>Math.round(n*100),total=draft.det.reduce((n,d)=>n+cents(d.prod.vProd),0);
  if(total!==cents(draft.total.ICMSTot.vProd) || draft.det.some(d=>cents(d.prod.qCom*d.prod.vUnCom)!==cents(d.prod.vProd)) || draft.pag.detPag.reduce((n,p)=>n+cents(p.vPag),0)-cents(draft.pag.vTroco||0)!==cents(draft.total.ICMSTot.vNF))throw httpError(400,'Valores dos itens, totais ou pagamentos inconsistentes.','FISCAL_TOTAL_MISMATCH');
  const {rows:[counter]}=await c.query('UPDATE bansir.fiscal_numbering SET last_number=last_number+1 WHERE environment=$1 AND series=$2 AND last_number<999999999 RETURNING last_number',[s.environment,s.series]);
  if(!counter)throw httpError(409,'Numeração fiscal indisponível.','NUMBERING_UNAVAILABLE');
  // XML schema requires a numeric UTC offset; access-key month uses the issuer's same local timestamp.
  const issuedAt=issuedTimestamp(s.timeZone),code=String(randomInt(100000000)).padStart(8,'0');
  const key=accessKey({uf:s.address.uf,cnpj:s.cnpj,series:s.series,number:counter.last_number,issuedAt,code});
  const a=s.address;
  const infNFe={...structuredClone(draft),Id:key,versao:'4.00',emit:{CNPJCPF:s.cnpj,xNome:s.legalName,xFant:s.tradeName,IE:s.ie,CRT:s.crt,enderEmit:{xLgr:a.street,nro:a.number,xBairro:a.district,cMun:Number(a.cityCode),xMun:a.city,UF:a.uf,CEP:a.cep,fone:a.phone,cPais:1058,xPais:'BRASIL'}},ide:{cUF:ufCodes[a.uf],cNF:code,natOp:'VENDA',mod:65,serie:s.series,nNF:counter.last_number,dhEmi:issuedAt,tpNF:1,idDest:1,cMunFG:Number(a.cityCode),tpImp:4,tpEmis:1,cDV:Number(key.at(-1)),tpAmb:s.environment,finNFe:1,indFinal:1,indPres:1,procEmi:0,verProc:'Bansir-1'},det:draft.det.map((d,index)=>({...structuredClone(d),nItem:index+1})),transp:draft.transp||{modFrete:9}};
  if(s.environment===2){infNFe.det[0].prod.xProd='NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';if(infNFe.dest)infNFe.dest.xNome='NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';}
  const payload={draftHash:digest(draft),request:{idLote:counter.last_number,indSinc:1,NFe:{infNFe}}};
  const {rows:[doc]}=await c.query(`INSERT INTO bansir.fiscal_documents(tenant_id,establishment_id,request_key,environment,access_key,payload,configuration_version,certificate_fingerprint)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,status`,[i.tenantId,i.establishmentId,input.requestKey,s.environment,key,payload,configurationVersion(cfg),cert.fingerprint]);
  await enqueue(c,i,{kind:'fiscal',key:doc.id,payload:{documentId:doc.id,userId:i.userId}});
  return doc;
}



