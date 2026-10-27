import {z} from 'zod';
import {httpError} from './database.js';
import {normalizePhone,customersForPhone} from './phone.js';
import {fiscalDraftHash} from './fiscal.js';
import {readPdfTable,pdfLine,customerReportRows} from './pdf-import.js';

export const customerInput=z.object({name:z.string().trim().min(2).max(200),phone:z.string().max(40).default('').transform(v=>normalizePhone(v,{optional:true})),document:z.string().max(25).default('').transform(v=>v.replace(/\D/g,'')).refine(v=>!v||[11,14].includes(v.length),'Documento deve ter 11 ou 14 dígitos.'),address:z.string().trim().max(1000).default(''),email:z.union([z.email(),z.literal('')]).default(''),birthDate:z.union([z.iso.date(),z.literal('')]).default(''),notes:z.string().trim().max(3000).default('')}).strict();
export async function createCustomer(c,identity,body,{useExisting=false}={}){
 const data=customerInput.parse(body);
 if(data.phone){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`customer:${identity.tenantId}:${identity.establishmentId}:${data.phone}`]);const found=await customersForPhone(c,data.phone);
  if(found.length>1)throw httpError(409,'Há cadastros duplicados para este telefone. Revise os clientes ativos.','DUPLICATE_PHONE');
  if(found.length){if(useExisting)return found[0];throw httpError(409,'Este telefone já está cadastrado. Busque e selecione o cliente existente.','CUSTOMER_EXISTS');}
 }
 return (await c.query('INSERT INTO bansir.customers(tenant_id,establishment_id,name,document,phone,address,email,birth_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,name,document,phone,address',[identity.tenantId,identity.establishmentId,data.name,data.document,data.phone,data.address,data.email,data.birthDate,data.notes])).rows[0];
}

export function rowsFromPdfLines(lines){
 const rows=[];const phonePattern=/(?<!\d)(?:\+?55[ .-]*)?\(?[1-9]\d\)?[ .-]*(?:9[ .-]*\d{4}|[2-9]\d{3})[ .-]*\d{4}(?!\d)/g;
 for(const line of lines){const matches=[...line.matchAll(phonePattern)];if(!matches.length)continue;
  const distinct=[...new Set(matches.map(m=>{try{return normalizePhone(m[0]);}catch{return null;}}).filter(Boolean))];
  if(!distinct.length)continue;
  const phone=distinct[0],cells=line.split(/\t+|\s{2,}/).map(v=>v.trim()).filter(Boolean);phonePattern.lastIndex=0;
  const withoutPhone=line.replace(phonePattern,' ').trim();phonePattern.lastIndex=0;
  const document=withoutPhone.match(/(?<!\d)(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})(?!\d)/)?.[0]?.replace(/\D/g,'')||'';
  const candidates=cells.filter(cell=>!matches.some(m=>cell.includes(m[0]))&&!/^\d+[ .-]*$/.test(cell)&&(!document||!cell.replace(/\D/g,'').includes(document))&&!/^\s*(cliente|nome|telefone|celular|endereço|pagina)\s*$/i.test(cell));
  let name=candidates.find(cell=>! /^(rua|r\.|avenida|av\.|travessa|bairro|estrada)\b/i.test(cell))||withoutPhone.replace(/^[\d .-]+/,'').slice(0,200);
  if(document)name=name.replace(document,'').trim();name=name.slice(0,200);
  const address=candidates.filter(cell=>cell!==name).join(' ').slice(0,1000);
  const issues=[];if(name.length<2)issues.push('Confira o nome.');if(!address)issues.push('Endereço não identificado.');if(distinct.length>1)issues.push('Mais de um telefone nesta linha: confira o principal.');
  rows.push({name,phone,document,address,sourceLine:line.slice(0,1500),issues});if(rows.length>1000)throw httpError(400,'A lista tem mais de 1000 clientes. Divida o PDF em arquivos menores para conferir todos os registros.','PDF_TOO_LARGE');
 }
 return rows;
}
export async function extractCustomerPdf(base64){
 const file=await readPdfTable(base64),lines=file.pages.flatMap(p=>p.lines.map(pdfLine));
 const reportRows=customerReportRows(file.pages,normalizePhone),rows=reportRows??rowsFromPdfLines(lines);
 return {fileHash:file.fileHash,pages:file.pages.length,layout:reportRows?'jasley-clientes':'generic',repeatedLines:reportRows?rows.reduce((n,r)=>n+(r.sourceMetadata.occurrences||1)-1,0):0,rows,textPreview:lines.slice(0,20).join('\n'),warning:reportRows?'Relatório por colunas: confira telefones antigos, duplicados e endereços incompletos. Datas são preservadas como origem, sem validar sua veracidade. Consumidor final e telefones duplicados ficam desmarcados.':'Confira cada linha antes de importar. PDFs sem texto precisam de OCR.'};
}
const importCustomerInput=customerInput.omit({email:true,birthDate:true,notes:true}).extend({sourceCode:z.string().regex(/^\d{1,30}$/).optional(),sourceMetadata:z.object({telephone:z.string().max(200),mobile:z.string().max(200),lastOrder:z.string().max(40),birthDate:z.string().max(40),email:z.string().max(254),page:z.number().int().min(1).max(250),occurrences:z.number().int().min(1).max(25000).optional(),pages:z.array(z.number().int().min(1).max(250)).max(250).optional()}).strict().optional()}).refine(r=>!!r.phone||!!r.sourceCode,'Informe telefone válido ou código de origem.');
export async function importCustomers(c,i,body){
 const data=z.object({requestKey:z.uuid(),fileHash:z.string().regex(/^[a-f0-9]{64}$/),mode:z.enum(['skip-existing','update-existing']).default('skip-existing'),rows:z.array(importCustomerInput).min(1).max(8000)}).strict().parse(body),fingerprint=fiscalDraftHash(data);
 if(new Set(data.rows.filter(r=>r.phone).map(r=>r.phone)).size!==data.rows.filter(r=>r.phone).length)throw httpError(400,'Há telefones repetidos na prévia. Selecione um cadastro por telefone.','DUPLICATE_PHONE');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`customer-import:${i.tenantId}:${i.establishmentId}`]);
 const previous=(await c.query('SELECT request_hash,result FROM bansir.customer_imports WHERE request_key=$1',[data.requestKey])).rows[0];if(previous){if(previous.request_hash!==fingerprint)throw httpError(409,'Identificador de importação já utilizado com outros dados.','IDEMPOTENCY_CONFLICT');return previous.result;}
 if(new Set(data.rows.filter(r=>r.sourceCode).map(r=>r.sourceCode)).size!==data.rows.filter(r=>r.sourceCode).length)throw httpError(400,'Há códigos de origem repetidos.','DUPLICATE_SOURCE');
 const result={created:0,updated:0,skipped:0,total:data.rows.length};
 const phones=data.rows.filter(r=>r.phone).map(r=>r.phone),codes=data.rows.filter(r=>r.sourceCode).map(r=>r.sourceCode);
 // Acquire all phone locks in a stable order, then match once; thousands of PDF rows
 // must not require thousands of network round trips while holding the transaction.
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended(key,0)) FROM (SELECT key FROM unnest($1::text[]) AS key ORDER BY key) sorted",[phones.map(phone=>`customer:${i.tenantId}:${i.establishmentId}:${phone}`)]);
 const existing=(await c.query(`SELECT id,phone,source_code,active,bansir.customer_lookup_phone(phone,import_metadata) AS lookup_phone FROM bansir.customers WHERE source_code=ANY($1::text[]) OR (active AND
  bansir.customer_lookup_phone(phone,import_metadata)=ANY($2::text[]))`,[codes,phones])).rows;
 const byCode=new Map(),byPhone=new Map();for(const row of existing){if(row.source_code)byCode.set(row.source_code,row);if(row.active&&row.lookup_phone){const phone=row.lookup_phone;if(!byPhone.has(phone))byPhone.set(phone,[]);byPhone.get(phone).push(row);}}
 const inserts=[],updates=[];
 for(const row of data.rows){
  const matchedCode=byCode.get(row.sourceCode),matchedPhone=byPhone.get(row.phone)||[],ids=[...new Set([...(matchedCode?[matchedCode]:[]),...matchedPhone].map(r=>r.id))];
  if(ids.length>1)throw httpError(409,'Código e telefone correspondem a clientes diferentes ou duplicados. Revise a prévia.','DUPLICATE_PHONE');
  const found=matchedCode||matchedPhone[0];
  if(found?.source_code&&row.sourceCode&&found.source_code!==row.sourceCode)throw httpError(409,'Telefone já pertence a outro código de origem.','DUPLICATE_PHONE');
  const record={name:row.name,phone:row.phone,document:row.document,address:row.address,source_code:row.sourceCode||found?.source_code||'',import_metadata:row.sourceMetadata||{}};
  if(found){if(data.mode==='skip-existing'){result.skipped++;continue;}updates.push({...record,id:found.id});result.updated++;}
  else{inserts.push(record);result.created++;}
 }
 for(let n=0;n<inserts.length;n+=500)await c.query(`INSERT INTO bansir.customers(tenant_id,establishment_id,name,phone,document,address,source_code,import_metadata)
  SELECT $1,$2,r.name,r.phone,r.document,r.address,r.source_code,r.import_metadata FROM jsonb_to_recordset($3::jsonb) AS r(name text,phone text,document text,address text,source_code text,import_metadata jsonb)`,[i.tenantId,i.establishmentId,JSON.stringify(inserts.slice(n,n+500))]);
 for(let n=0;n<updates.length;n+=500)await c.query(`UPDATE bansir.customers c SET name=r.name,phone=r.phone,document=r.document,address=r.address,source_code=r.source_code,import_metadata=r.import_metadata
  FROM jsonb_to_recordset($1::jsonb) AS r(id uuid,name text,phone text,document text,address text,source_code text,import_metadata jsonb) WHERE c.id=r.id`,[JSON.stringify(updates.slice(n,n+500))]);
 await c.query('INSERT INTO bansir.customer_imports(tenant_id,establishment_id,request_key,source_sha256,request_hash,created_by,result) VALUES($1,$2,$3,$4,$5,$6,$7)',[i.tenantId,i.establishmentId,data.requestKey,data.fileHash,fingerprint,i.userId,result]);return result;
}
export function mountCustomers(app,{scoped}){
 app.get('/api/v1/customers',scoped('settings',true,async(c,req)=>{
  const q=z.string().trim().max(200).default('').parse(req.query.q);
  const page=z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.page),pageSize=z.coerce.number().int().min(1).max(1000).default(1000).parse(req.query.pageSize);
  let lookup='';try{lookup=normalizePhone(q);}catch{}
  const where="($1='' OR strpos(lower(name||' '||document||' '||phone||' '||address||' '||source_code||' '||email),lower($1))>0 OR ($2<>'' AND bansir.customer_lookup_phone(phone,import_metadata)=$2))";
  const total=(await c.query(`SELECT count(*)::int AS total FROM bansir.customers WHERE ${where}`,[q,lookup])).rows[0].total;
  return {data:(await c.query(`SELECT id,name,document,phone,address,active,source_code,import_metadata,email,birth_date,notes FROM bansir.customers WHERE ${where} ORDER BY name,id LIMIT $3 OFFSET $4`,[q,lookup,pageSize,page*pageSize])).rows,meta:{total,page,pageSize}};
 }));
 app.post('/api/v1/customers',scoped('settings',false,async(c,req)=>({status:201,data:await createCustomer(c,req.identity,req.body)})));
 app.put('/api/v1/customers/:id',scoped('settings',false,async(c,req)=>{
  const data=customerInput.extend({active:z.boolean().default(true)}).parse(req.body),id=z.uuid().parse(req.params.id);
  if(data.phone)await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`customer:${req.identity.tenantId}:${req.identity.establishmentId}:${data.phone}`]);
  if(data.phone&&data.active){const found=await customersForPhone(c,data.phone);if(found.some(row=>row.id!==id))throw httpError(409,'Telefone já vinculado a outro cliente ativo.','CUSTOMER_EXISTS');}
  const row=(await c.query('UPDATE bansir.customers SET name=$2,phone=$3,document=$4,address=$5,active=$6,email=$7,birth_date=$8,notes=$9 WHERE id=$1 RETURNING id,name,phone,document,address,active',[id,data.name,data.phone,data.document,data.address,data.active,data.email,data.birthDate,data.notes])).rows[0];if(!row)throw httpError(404,'Cliente não encontrado.','NOT_FOUND');return {data:row};
 }));
 app.post('/api/v1/customers/import/pdf',scoped('settings',false,async(c,req)=>({data:await extractCustomerPdf(z.object({base64:z.string().max(7000000)}).strict().parse(req.body).base64)})));
 app.post('/api/v1/customers/import/confirm',scoped('settings',false,async(c,req)=>({status:201,data:await importCustomers(c,req.identity,req.body)})));
 app.get('/api/v1/pdv/deliverers',scoped('sales',true,async c=>({data:(await c.query('SELECT id,name,phone FROM bansir.deliverers WHERE active ORDER BY name')).rows})));
 app.get('/api/v1/deliverers',scoped('sales-manage',true,async c=>({data:(await c.query('SELECT id,name,phone,active FROM bansir.deliverers ORDER BY name')).rows})));
 const deliverer=z.object({name:z.string().trim().min(2).max(200),phone:z.string().max(40).default('').transform(v=>normalizePhone(v,{optional:true})),active:z.boolean().default(true)}).strict();
 app.post('/api/v1/deliverers',scoped('sales-manage',false,async(c,req)=>{const d=deliverer.parse(req.body),i=req.identity;return {status:201,data:(await c.query('INSERT INTO bansir.deliverers(tenant_id,establishment_id,name,phone,active) VALUES($1,$2,$3,$4,$5) RETURNING id,name,phone,active',[i.tenantId,i.establishmentId,d.name,d.phone,d.active])).rows[0]};}));
 app.put('/api/v1/deliverers/:id',scoped('sales-manage',false,async(c,req)=>{const d=deliverer.parse(req.body);const row=(await c.query('UPDATE bansir.deliverers SET name=$2,phone=$3,active=$4 WHERE id=$1 RETURNING id,name,phone,active',[z.uuid().parse(req.params.id),d.name,d.phone,d.active])).rows[0];if(!row)throw httpError(404,'Entregador não encontrado.','NOT_FOUND');return {data:row};}));
}

