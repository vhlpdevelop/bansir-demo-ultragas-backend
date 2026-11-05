import {z} from 'zod';
import {httpError} from './database.js';
import {ufCodes} from './fiscal.js';
import {unseal,secretContext,seal} from './secrets.js';
import {parseDistribution,decodeDocument,nextPoll,parseInboundDocument,MAX_XML_BYTES} from './inbound-parser.js';
import {findNode,parseXml,list} from './inbound-parser.js';
import {enqueue} from './queue.js';
import {requirePermission} from './catalog.js';
export function mountFiscalMonitor(app,{scoped}){
 const unseen="d.badge_since IS NOT NULL AND d.status<>'CANCELLED' AND NOT EXISTS(SELECT 1 FROM bansir.fiscal_inbound_seen s WHERE (s.tenant_id,s.establishment_id,s.document_id)=(d.tenant_id,d.establishment_id,d.id) AND s.user_id=bansir.actor_id())";
 app.get('/api/v1/fiscal/inbound/unseen',scoped('fiscal',true,async c=>({data:(await c.query(`SELECT count(*)::int AS count FROM bansir.fiscal_inbound d WHERE ${unseen}`)).rows[0]})));
 app.post('/api/v1/fiscal/inbound/seen',scoped('fiscal',true,async(c,req)=>{
  const {id}=z.object({id:z.uuid()}).strict().parse(req.body),i=req.identity;
  await c.query(`INSERT INTO bansir.fiscal_inbound_seen(tenant_id,establishment_id,document_id,user_id)
   SELECT d.tenant_id,d.establishment_id,d.id,$2 FROM bansir.fiscal_inbound d WHERE d.id=$1 AND ${unseen} ON CONFLICT DO NOTHING`,[id,i.userId]);
  return {data:true};
 }));
 app.post('/api/v1/fiscal/inbound/import',scoped('fiscal',false,async(c,req)=>{
  const {xml}=z.object({xml:z.string().min(1).max(MAX_XML_BYTES)}).strict().parse(req.body),i=req.identity;
  const monitor=(await c.query('SELECT id,cnpj,environment FROM bansir.fiscal_monitors WHERE environment=1 ORDER BY active DESC,created_at DESC LIMIT 1')).rows[0];
  if(!monitor)throw httpError(409,'Configure o monitor fiscal de produção deste estabelecimento antes de importar.','FISCAL_MONITOR_REQUIRED');
  let doc;
  try{doc=parseInboundDocument(xml,monitor);}catch{throw httpError(400,'XML inválido ou incompatível com uma NF-e de entrada de produção.','INVALID_INBOUND_XML');}
  if(!doc?.xml)throw httpError(400,'Use o XML completo da NF-e modelo 55 emitida para o CNPJ do estabelecimento.','INVALID_INBOUND_XML');
  const encrypted=seal(xml,secretContext(i,'inbound:'+doc.accessKey));
  const {rows:[row]}=await c.query(`INSERT INTO bansir.fiscal_inbound(tenant_id,establishment_id,monitor_id,access_key,supplier_cnpj,supplier_name,number,issued_at,total_cents,status,items,encrypted_xml)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'AVAILABLE',$10,$11)
   ON CONFLICT(tenant_id,establishment_id,monitor_id,access_key) DO UPDATE SET
   supplier_cnpj=EXCLUDED.supplier_cnpj,supplier_name=EXCLUDED.supplier_name,number=EXCLUDED.number,issued_at=EXCLUDED.issued_at,total_cents=EXCLUDED.total_cents,status='AVAILABLE',items=EXCLUDED.items,encrypted_xml=EXCLUDED.encrypted_xml,updated_at=now()
   WHERE bansir.fiscal_inbound.status<>'CANCELLED' AND bansir.fiscal_inbound.encrypted_xml IS NULL RETURNING id`,
   [i.tenantId,i.establishmentId,monitor.id,doc.accessKey,doc.supplierCnpj,doc.supplierName,doc.number,doc.issuedAt,doc.totalCents,JSON.stringify(doc.items),encrypted]);
  if(!row)throw httpError(409,'Esta nota já tem XML cadastrado ou foi cancelada.','INBOUND_ALREADY_REGISTERED');
  return {status:201,data:row};
 }));
 app.post('/api/v1/fiscal/inbound/:id/science',scoped('fiscal-manifest',false,async(c,req,member)=>{
  requirePermission(member,'fiscal',true);z.object({consent:z.literal(true)}).strict().parse(req.body);
  const doc=(await c.query("SELECT id,monitor_id,access_key FROM bansir.fiscal_inbound WHERE id=$1 AND status<>'CANCELLED'",[z.uuid().parse(req.params.id)])).rows[0];if(!doc)throw httpError(404,'Nota indisponível para manifestação.','NOT_FOUND');
  const jobId=await enqueue(c,req.identity,{kind:'fiscal',key:'science:'+doc.id,payload:{action:'science',monitorId:doc.monitor_id,documentId:doc.id,userId:req.identity.userId},maxAttempts:5});return {status:202,data:{jobId}};
 }));
 app.get('/api/v1/fiscal/inbound/:id/science',scoped('fiscal-manifest',true,async(c,req,member)=>{
  requirePermission(member,'fiscal',true);
  const {rows:[row]}=await c.query(`SELECT d.science_status,coalesce(d.encrypted_xml<>'',false) AS xml_available,j.state,j.last_error
   FROM bansir.fiscal_inbound d LEFT JOIN bansir.jobs j ON
   (j.tenant_id,j.establishment_id)=(d.tenant_id,d.establishment_id) AND j.kind='fiscal' AND j.dedupe_key='science:'||d.id
   WHERE d.id=$1`,[z.uuid().parse(req.params.id)]);
  if(!row)throw httpError(404,'Nota não encontrada.','NOT_FOUND');
  return {data:{confirmed:row.science_status==='acknowledged',xmlAvailable:row.xml_available,state:row.state,
   error:row.last_error==='SCIENCE_NOT_ACCEPTED'?'A SEFAZ não confirmou o registro da Ciência da Operação.':null}};
 }));
 app.get('/api/v1/fiscal/monitor',scoped('settings',true,async c=>({data:(await c.query('SELECT * FROM bansir.fiscal_monitors ORDER BY created_at DESC')).rows})));
 app.post('/api/v1/fiscal/monitor',scoped('settings',false,async(c,req)=>{
  const input=z.object({uf:z.enum(Object.keys(ufCodes)),environment:z.coerce.number().int().refine(n=>[1,2].includes(n))}).strict().parse(req.body),i=req.identity;
  const cert=(await c.query('SELECT cnpj FROM bansir.fiscal_certificates WHERE active AND valid_from<=now() AND valid_until>now()')).rows[0];if(!cert)throw httpError(409,'Cadastre e ative um certificado A1 válido.','CERTIFICATE_REQUIRED');
  return {status:201,data:(await c.query(`INSERT INTO bansir.fiscal_monitors(tenant_id,establishment_id,cnpj,uf,environment) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,establishment_id,cnpj,environment) DO UPDATE SET active=true,uf=EXCLUDED.uf RETURNING *`,[i.tenantId,i.establishmentId,cert.cnpj,input.uf,input.environment])).rows[0]};
 }));
 app.patch('/api/v1/fiscal/monitor/:id',scoped('settings',false,async(c,req)=>{const {active}=z.object({active:z.boolean()}).strict().parse(req.body);const row=(await c.query('UPDATE bansir.fiscal_monitors SET active=$2 WHERE id=$1 RETURNING *',[z.uuid().parse(req.params.id),active])).rows[0];if(!row)throw httpError(404,'Monitor não encontrado.','NOT_FOUND');return {data:row};}));
 app.get('/api/v1/fiscal/inbound',scoped('fiscal',true,async(c,req)=>{const page=z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.page);return {data:(await c.query(`SELECT (${unseen}) AS unseen,id,monitor_id,access_key,supplier_name,supplier_cnpj,number,issued_at,total_cents,status,items,science_status,science_at,coalesce(encrypted_xml<>'',false) AS xml_available,EXISTS(SELECT 1 FROM bansir.fiscal_stock_receipts r WHERE r.access_key=d.access_key) AS stock_received,created_at FROM bansir.fiscal_inbound d ORDER BY created_at DESC,id LIMIT 30 OFFSET $1`,[page*30])).rows,meta:{total:(await c.query('SELECT count(*)::int AS n FROM bansir.fiscal_inbound')).rows[0].n}};}));
 app.get('/api/v1/fiscal/inbound/:id/xml',scoped('fiscal',true,async(c,req)=>{
  const doc=(await c.query('SELECT id,access_key,encrypted_xml FROM bansir.fiscal_inbound WHERE id=$1',[z.uuid().parse(req.params.id)])).rows[0];if(!doc)throw httpError(404,'Nota não encontrada.','NOT_FOUND');if(!doc.encrypted_xml)throw httpError(409,'A SEFAZ disponibilizou apenas o resumo. O XML completo ainda não está disponível.','XML_NOT_AVAILABLE');
  return {data:{filename:doc.access_key+'.xml',xml:unseal(doc.encrypted_xml,secretContext(req.identity,'inbound:'+doc.access_key))}};
 }));
 app.get('/api/v1/fiscal/recipients',scoped('settings',true,async c=>({data:(await c.query(`SELECT em.user_id AS id,u.name,em.role,coalesce(p.enabled,true) AS enabled,(em.role IN('admin','superadmin') OR 'fiscal-notify'=ANY(em.allowed_routes)) AS eligible FROM bansir.establishment_memberships em JOIN bansir.users u ON u.id=em.user_id LEFT JOIN bansir.fiscal_recipients p ON(p.tenant_id,p.establishment_id,p.user_id)=(em.tenant_id,em.establishment_id,em.user_id) WHERE em.active AND u.active ORDER BY u.name`)).rows})));
 app.put('/api/v1/fiscal/recipients/:id',scoped('settings',false,async(c,req)=>{
  const id=z.uuid().parse(req.params.id),{enabled}=z.object({enabled:z.boolean()}).strict().parse(req.body),i=req.identity;
  const eligible=(await c.query("SELECT 1 FROM bansir.establishment_memberships WHERE user_id=$1 AND active AND(role IN('admin','superadmin') OR 'fiscal-notify'=ANY(allowed_routes))",[id])).rowCount;
  if(!eligible)throw httpError(403,'O usuário não possui permissão para receber alertas fiscais nesta unidade.','FORBIDDEN');
  await c.query('INSERT INTO bansir.fiscal_recipients(tenant_id,establishment_id,user_id,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,establishment_id,user_id) DO UPDATE SET enabled=EXCLUDED.enabled',[i.tenantId,i.establishmentId,id,enabled]);return {data:{id,enabled}};
 }));
}
export async function processInbound(queue,job,{wizard}={}){
 const scope={tenantId:job.tenant_id,establishmentId:job.establishment_id};let monitor;
 try{
  const context=await queue.scope(job,async c=>{
   monitor=(await c.query('SELECT * FROM bansir.fiscal_monitors WHERE id=$1 AND active FOR UPDATE',[job.payload.monitorId])).rows[0];if(!monitor)return null;
   const cert=(await c.query('SELECT * FROM bansir.fiscal_certificates WHERE active AND valid_from<=now() AND valid_until>now() AND cnpj=$1',[monitor.cnpj])).rows[0];if(!cert)throw new Error('NO_VALID_CERTIFICATE');
   return {certificate:unseal(cert.encrypted_bundle,secretContext(scope,'certificate')),settings:{cnpj:monitor.cnpj,environment:monitor.environment,address:{uf:monitor.uf},cscId:'',},csc:''};
  });
  if(!context)return;
  if(job.payload.action==='science'){
   const doc=await queue.scope(job,async c=>{
    const actor=(await c.query("SELECT bansir.fiscal_manifest_active($1,$2,$3) AS allowed",[job.tenant_id,job.establishment_id,job.payload.userId])).rows[0].allowed;
    if(!actor)throw new Error('EMITTER_ACCESS_REVOKED');
    return (await c.query("SELECT * FROM bansir.fiscal_inbound WHERE id=$1 AND monitor_id=$2 AND status<>'CANCELLED'",[job.payload.documentId,monitor.id])).rows[0];
   });
   if(!doc||doc.science_status==='acknowledged')return;
   const payload={idLote:String(Date.now()),evento:[{cOrgao:91,tpAmb:monitor.environment,CNPJ:monitor.cnpj,chNFe:doc.access_key,dhEvento:new Date().toISOString().replace(/\.\d{3}Z$/,'+00:00'),tpEvento:'210210',nSeqEvento:1,verEvento:'1.00',detEvento:{descEvento:'Ciencia da Operacao'}}]};
   const response=await wizard({...context,action:'science',model:'55',payload});
   const raw=typeof response.result==='string'?parseXml(response.result):response.result;
   const accepted=list(findNode(raw,'retEvento')).some(e=>{const v=e.infEvento;return v&&['135','136','573'].includes(String(v.cStat))&&String(v.tpAmb)===String(monitor.environment)&&String(v.chNFe)===doc.access_key&&String(v.tpEvento)==='210210'&&String(v.nSeqEvento)==='1';});
   if(!accepted)throw new Error('SCIENCE_NOT_ACCEPTED');
   await queue.scope(job,c=>c.query("UPDATE bansir.fiscal_inbound SET science_status='acknowledged',science_at=now() WHERE id=$1",[doc.id]));return;
  }
  const response=await wizard({...context,action:'distribute',model:'55',payload:{ufCode:ufCodes[monitor.uf],ultNSU:monitor.ult_nsu}});
  const m={...monitor,ultNSU:monitor.ult_nsu,maxNSU:monitor.max_nsu},result=parseDistribution(response.result,m);
  const documents=result.documents.map(d=>decodeDocument(d,m)).filter(Boolean);
  await queue.scope(job,async c=>{
   const current=(await c.query('SELECT active,ult_nsu FROM bansir.fiscal_monitors WHERE id=$1 FOR UPDATE',[monitor.id])).rows[0];if(!current?.active||current.ult_nsu!==monitor.ult_nsu)return;
   for(const doc of documents){
    const prior=(await c.query('SELECT id,status,encrypted_xml FROM bansir.fiscal_inbound WHERE monitor_id=$1 AND access_key=$2 FOR UPDATE',[monitor.id,doc.accessKey])).rows[0];
    const state=prior?.status==='CANCELLED'?'CANCELLED':doc.status,xml=doc.xml?seal(doc.xml,secretContext(scope,'inbound:'+doc.accessKey)):null;
    await c.query(`INSERT INTO bansir.fiscal_inbound(tenant_id,establishment_id,monitor_id,access_key,supplier_cnpj,supplier_name,number,issued_at,total_cents,status,items,encrypted_xml) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(tenant_id,establishment_id,monitor_id,access_key) DO UPDATE SET supplier_cnpj=coalesce(EXCLUDED.supplier_cnpj,bansir.fiscal_inbound.supplier_cnpj),supplier_name=coalesce(EXCLUDED.supplier_name,bansir.fiscal_inbound.supplier_name),number=coalesce(EXCLUDED.number,bansir.fiscal_inbound.number),issued_at=coalesce(EXCLUDED.issued_at,bansir.fiscal_inbound.issued_at),total_cents=coalesce(EXCLUDED.total_cents,bansir.fiscal_inbound.total_cents),status=CASE WHEN bansir.fiscal_inbound.status='CANCELLED' THEN 'CANCELLED' WHEN EXCLUDED.status='SUMMARY' AND bansir.fiscal_inbound.encrypted_xml IS NOT NULL THEN 'AVAILABLE' ELSE EXCLUDED.status END,items=CASE WHEN EXCLUDED.encrypted_xml IS NOT NULL THEN EXCLUDED.items ELSE bansir.fiscal_inbound.items END,encrypted_xml=coalesce(EXCLUDED.encrypted_xml,bansir.fiscal_inbound.encrypted_xml),updated_at=now()`,[job.tenant_id,job.establishment_id,monitor.id,doc.accessKey,doc.supplierCnpj||null,doc.supplierName||null,doc.number||null,doc.issuedAt||null,doc.totalCents??null,state,JSON.stringify(doc.items),xml]);
    if(!prior||prior.status!==state||(!prior.encrypted_xml&&xml))await c.query('SELECT bansir.notify_fiscal($1,$2,$3)',[`inbound:${monitor.id}:${doc.accessKey}:${state}`,state==='CANCELLED'?'NF-e de fornecedor cancelada':'Nova nota de fornecedor',state==='CANCELLED'?'Uma nota foi cancelada. Confira o documento e os registros da loja.':'Uma nota está disponível para conferência. Abra Minha empresa → Fiscal para conferir os produtos recebidos.']);
   }
   await c.query('UPDATE bansir.fiscal_monitors SET ult_nsu=$2,max_nsu=$3,last_status=$4,last_polled_at=now(),next_poll_at=$5 WHERE id=$1',[monitor.id,result.ultNSU,result.maxNSU,result.status,nextPoll(result)]);
  });
 }catch(e){
  if(monitor)await queue.scope(job,async c=>{await c.query("UPDATE bansir.fiscal_monitors SET last_status=$2,last_polled_at=now(),next_poll_at=greatest(next_poll_at,now()+interval '65 minutes') WHERE id=$1",[monitor.id,e.message==='NO_VALID_CERTIFICATE'?'NO_VALID_CERTIFICATE':'ERROR']);await c.query('SELECT bansir.notify_fiscal($1,$2,$3)',[`monitor:${monitor.id}:${new Date().toISOString().slice(0,10)}`,'Consulta fiscal precisa de atenção','Confira o certificado e o status da busca de notas nas configurações fiscais.']);});
  throw new Error('INBOUND_SYNC_FAILED');
 }
}
