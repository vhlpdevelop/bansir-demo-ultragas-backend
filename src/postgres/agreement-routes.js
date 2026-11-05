import PDFDocument from 'pdfkit';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {httpError} from './database.js';
import {requireFeature,tenantFeatures} from './features.js';
import {fiscalDraftHash} from './fiscal.js';
import {assertNoFiscalReservation,fiscalSaleLock} from './fiscal-issuance.js';
import {openCash,recordPayment,saleView} from './sales.js';
import {agreementPermission,agreementLock,agreementToday,nextAgreementTerms,customerAgreement,agreementBalancesSql,attachAgreement,checkAgreementCredit} from './agreements.js';
const uuid=z.uuid(),cents=z.number().int().min(0).max(1000000000),date=z.iso.date();
const config=z.object({requestKey:uuid,name:z.string().trim().min(2).max(120),payerCustomerId:uuid,contact:z.string().trim().max(200).default(''),cutDay:z.number().int().min(1).max(31),dueDay:z.number().int().min(1).max(31),limitCents:cents.nullable().default(null),blockOverdue:z.boolean().default(true),active:z.boolean().default(true),version:z.number().int().min(1).optional()}).strict();
const fail=(message,code='AGREEMENT_CONFLICT',status=409)=>{throw httpError(status,message,code);};
const hash=(i,b)=>fiscalDraftHash({...b,userId:i.userId});
async function group(c,id){const a=(await c.query('SELECT a.*,p.name AS payer_name,p.document AS payer_document FROM bansir.agreements a JOIN bansir.customers p ON(p.tenant_id,p.establishment_id,p.id)=(a.tenant_id,a.establishment_id,a.payer_customer_id) WHERE a.id=$1',[uuid.parse(id)])).rows[0];if(!a)fail('Convênio não encontrado.','NOT_FOUND',404);return a;}
async function audit(c,i,id,key,action,b,fingerprint=hash(i,b)){await c.query('INSERT INTO bansir.agreement_audit(tenant_id,establishment_id,agreement_id,user_id,request_key,request_hash,action,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[i.tenantId,i.establishmentId,id,i.userId,key,fingerprint,action,b]);}
async function prior(c,i,b){const r=(await c.query('SELECT agreement_id,request_hash FROM bansir.agreement_audit WHERE request_key=$1',[b.requestKey])).rows[0];if(r&&r.request_hash!==hash(i,b))fail('Tentativa já utilizada com outros dados.','IDEMPOTENCY_CONFLICT');return r;}
async function statement(c,id,period){
 const a=await group(c,id);const result=await c.query(`${agreementBalancesSql} WHERE l.agreement_id=$1 AND($2::date IS NULL OR l.period_end=$2) ORDER BY l.due_date,s.created_at,s.id LIMIT 1001`,[id,period||null]);
 if(result.rows.length>1000)fail('Selecione um período para consultar até 1.000 vendas.','AGREEMENT_STATEMENT_LIMIT');
 const sales=result.rows.map(r=>({...r,total_cents:Number(r.total_cents),paid_cents:Number(r.paid_cents),outstanding_cents:Number(r.outstanding_cents)}));
 const cycles=(await c.query('SELECT period_end::text,closed_at,closed_by,snapshot FROM bansir.agreement_cycles WHERE agreement_id=$1 ORDER BY period_end DESC LIMIT 100',[id])).rows;
 const receipts=(await c.query('SELECT r.*,u.name AS received_by_name,cs.terminal_name FROM bansir.agreement_receipts r JOIN bansir.users u ON u.id=r.received_by JOIN bansir.cash_sessions cs ON cs.id=r.cash_session_id WHERE r.agreement_id=$1 ORDER BY r.created_at DESC LIMIT 100',[id])).rows;
 return {agreement:a,sales,cycles,receipts,outstandingCents:sales.reduce((n,s)=>n+s.outstanding_cents,0),today:await agreementToday(c)};
}
export function mountAgreements(app,{scoped}){
 const route=(action,fn)=>scoped('agreements',true,async(c,r,m)=>{agreementPermission(m,action);return fn(c,r,m);});
 app.get('/api/v1/agreements/customer/:id',scoped('sales',true,async(c,r,m)=>{
  if(!(await tenantFeatures(c)).agreements)return {data:null};
  const a=await customerAgreement(c,uuid.parse(r.params.id));if(!a)return {data:null};agreementPermission(m,'use');
  return {data:{id:a.id,name:a.name,active:a.active,...await nextAgreementTerms(c,a,await agreementToday(c))}};
 }));
 app.get('/api/v1/agreements/customers',route('view',async(c,r)=>{const q=z.string().trim().min(2).max(100).parse(r.query.q);return {data:(await c.query("SELECT id,name,document,phone FROM bansir.customers WHERE active AND(name ILIKE '%'||$1||'%' OR document ILIKE '%'||$1||'%' OR phone ILIKE '%'||$1||'%') ORDER BY name LIMIT 30",[q])).rows};}));
 app.put('/api/v1/agreements/customer/:id/membership',route('manage',async(c,r)=>{
  await requireFeature(c,'agreements');const b=z.object({requestKey:uuid,agreementId:uuid.nullable(),expectedAgreementId:uuid.nullable()}).strict().parse(r.body),i=r.identity,id=uuid.parse(r.params.id);
  await agreementLock(c,i);const payload={...b,customerId:id,action:'pdv-membership'};if(await prior(c,i,payload))return {data:true};
  if(!(await c.query('SELECT 1 FROM bansir.customers WHERE id=$1 AND active',[id])).rowCount)fail('Cliente não encontrado.','CUSTOMER_NOT_FOUND',404);
  const current=await customerAgreement(c,id);if((current?.id||null)!==b.expectedAgreementId)fail('O vínculo deste cliente mudou. Atualize antes de continuar.','STALE_AGREEMENT');
  const destination=b.agreementId?await group(c,b.agreementId):null;if(destination&&!destination.active)fail('Escolha um convênio ativo.','AGREEMENT_SUSPENDED');
  if(current?.id!==destination?.id){
   if(current)await c.query('UPDATE bansir.agreement_members SET active=false,updated_at=now() WHERE agreement_id=$1 AND customer_id=$2',[current.id,id]);
   if(destination)await c.query('INSERT INTO bansir.agreement_members(tenant_id,establishment_id,agreement_id,customer_id,active) VALUES($1,$2,$3,$4,true) ON CONFLICT(tenant_id,establishment_id,agreement_id,customer_id) DO UPDATE SET active=true,updated_at=now()',[i.tenantId,i.establishmentId,destination.id,id]);
  }
  const auditId=destination?.id||current?.id;if(auditId)await audit(c,i,auditId,b.requestKey,'pdv-membership',payload);return {data:true};
 }));
 app.get('/api/v1/agreements',route('view',async c=>({data:(await c.query(`SELECT a.*,p.name AS payer_name,
  (SELECT count(*)::int FROM bansir.agreement_members m WHERE m.agreement_id=a.id AND m.active) AS participants,
  (SELECT coalesce(sum(b.outstanding_cents),0) FROM (${agreementBalancesSql})b WHERE b.agreement_id=a.id) AS outstanding_cents
  FROM bansir.agreements a JOIN bansir.customers p ON p.id=a.payer_customer_id ORDER BY a.name LIMIT 500`)).rows,meta:{enabled:(await tenantFeatures(c)).agreements===true}})));
 for(const method of ['post','put'])app[method]('/api/v1/agreements'+(method==='put'?'/:id':''),route('manage',async(c,r)=>{
  await requireFeature(c,'agreements');const b=config.parse(r.body),i=r.identity;await agreementLock(c,i);const payload={...b,action:method,agreementId:method==='put'?uuid.parse(r.params.id):null};const old=await prior(c,i,payload);if(old)return {data:await group(c,old.agreement_id)};
  if(!(await c.query('SELECT id FROM bansir.customers WHERE id=$1 AND active',[b.payerCustomerId])).rowCount)fail('Escolha a empresa pagadora cadastrada neste estabelecimento.','CUSTOMER_NOT_FOUND',404);
  let a;if(method==='post')a=(await c.query(`INSERT INTO bansir.agreements(tenant_id,establishment_id,request_key,request_hash,name,payer_customer_id,contact,cut_day,due_day,limit_cents,block_overdue,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[i.tenantId,i.establishmentId,b.requestKey,hash(i,b),b.name,b.payerCustomerId,b.contact,b.cutDay,b.dueDay,b.limitCents,b.blockOverdue,b.active])).rows[0];
  else {a=await group(c,r.params.id);if(b.payerCustomerId!==a.payer_customer_id&&(await c.query('SELECT 1 FROM bansir.sale_agreements WHERE agreement_id=$1 LIMIT 1',[a.id])).rowCount)fail('Este convênio já possui compras. Crie outro convênio para trocar a empresa pagadora.','AGREEMENT_PAYER_LOCKED');if(b.version!==a.version)fail('Convênio alterado. Atualize antes de salvar.','STALE_AGREEMENT');a=(await c.query('UPDATE bansir.agreements SET name=$2,payer_customer_id=$3,contact=$4,cut_day=$5,due_day=$6,limit_cents=$7,block_overdue=$8,active=$9,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[a.id,b.name,b.payerCustomerId,b.contact,b.cutDay,b.dueDay,b.limitCents,b.blockOverdue,b.active])).rows[0];}
  await audit(c,i,a.id,b.requestKey,method==='post'?'create':'update',payload);return {status:method==='post'?201:200,data:a};
 }));
 app.get('/api/v1/agreements/:id/members',route('view',async(c,r)=>{await group(c,r.params.id);return {data:(await c.query('SELECT m.*,c.name,c.phone FROM bansir.agreement_members m JOIN bansir.customers c ON c.id=m.customer_id WHERE m.agreement_id=$1 ORDER BY c.name',[r.params.id])).rows};}));
 app.get('/api/v1/agreements/:id/members/:customerId/coupons',route('manage',async(c,r)=>{
  const ids=[uuid.parse(r.params.id),uuid.parse(r.params.customerId)];
  const remaining=(await c.query('SELECT count(*)::int AS count FROM bansir.agreement_members WHERE agreement_id=$1 AND customer_id<>$2 AND active',ids)).rows[0].count;
  return {meta:{meta:{lastParticipant:remaining===0}},data:(await c.query(`SELECT b.sale_id,b.coupon_number,b.outstanding_cents,
   b.paid_cents=0 AND b.cancelled_at IS NULL AND cy.agreement_id IS NULL AS editable
   FROM (${agreementBalancesSql} WHERE l.agreement_id=$1 AND l.customer_id=$2)b
   LEFT JOIN bansir.agreement_cycles cy ON cy.agreement_id=b.agreement_id AND cy.period_end=b.period_end::date
   ORDER BY b.created_at DESC`,ids)).rows};
 }));
 app.post('/api/v1/agreements/:id/members/:customerId/reassign',route('manage',async(c,r)=>{
  await requireFeature(c,'agreements');
  const b=z.object({requestKey:uuid,destinationId:uuid.nullable(),saleIds:z.array(uuid).max(500),confirmArchive:z.boolean().default(false)}).strict().parse(r.body);
  const i=r.identity,id=uuid.parse(r.params.customerId),source=uuid.parse(r.params.id);
  const payload={...b,source,customerId:id,action:'reassign-member'};
  await agreementLock(c,i);
  if(await prior(c,i,payload))return {data:true};
  if((await customerAgreement(c,id))?.id!==source)fail('O vínculo mudou. Atualize a lista.');
  const lastParticipant=!(await c.query('SELECT 1 FROM bansir.agreement_members WHERE agreement_id=$1 AND customer_id<>$2 AND active LIMIT 1',[source,id])).rowCount;
  if(lastParticipant!==b.confirmArchive)fail('A lista de participantes mudou. Reabra a operação para confirmar o estado atual.');
  const destination=b.destinationId?await group(c,b.destinationId):null;
  if(destination&&(!destination.active||destination.id===source))fail('Escolha outro convênio ativo.');
  await c.query('UPDATE bansir.agreement_members SET active=false,updated_at=now() WHERE agreement_id=$1 AND customer_id=$2',[source,id]);
  if(destination)await c.query('INSERT INTO bansir.agreement_members(tenant_id,establishment_id,agreement_id,customer_id,active) VALUES($1,$2,$3,$4,true) ON CONFLICT(tenant_id,establishment_id,agreement_id,customer_id) DO UPDATE SET active=true,updated_at=now()',[i.tenantId,i.establishmentId,destination.id,id]);
  const target=destination?await customerAgreement(c,id):null;
  if(target){target.today=await agreementToday(c);Object.assign(target,await nextAgreementTerms(c,target,target.today));}
  const moved=[];
  for(const saleId of [...new Set(b.saleIds)].sort()){
   await fiscalSaleLock(c,i,saleId);
   const row=(await c.query(`${agreementBalancesSql} WHERE l.agreement_id=$1 AND l.customer_id=$2 AND l.sale_id=$3`,[source,id,saleId])).rows[0];
   if(!row||row.cancelled_at||Number(row.paid_cents)!==0||(await c.query('SELECT 1 FROM bansir.agreement_cycles WHERE agreement_id=$1 AND period_end=$2',[source,row.period_end])).rowCount)fail('Um cupom selecionado não pode mais ser alterado.');
   if((await saleView(c,saleId)).document_id)fail('O cupom possui documento fiscal vinculado.');
   await assertNoFiscalReservation(c,saleId,true);
   await checkAgreementCredit(c,target,Number(row.total_cents));
   await c.query('DELETE FROM bansir.sale_agreements WHERE sale_id=$1',[saleId]);
   if(target){
    await attachAgreement(c,i,{id:saleId,total_cents:row.total_cents},target);
    await c.query('UPDATE bansir.sales SET due_date=$2 WHERE id=$1',[saleId,target.dueDate]);
   }
   moved.push({saleId,snapshot:row.snapshot,dueDate:row.due_date});
  }
  if(lastParticipant)await c.query('UPDATE bansir.agreements SET active=false,version=version+1,updated_at=now() WHERE id=$1',[source]);
  await audit(c,i,source,b.requestKey,'reassign-member',{...payload,moved},hash(i,payload));
  return {data:true};
 }));
 app.put('/api/v1/agreements/:id/members/:customerId',route('manage',async(c,r)=>{
  await requireFeature(c,'agreements');const b=z.object({requestKey:uuid,active:z.boolean(),limitCents:cents.nullable().default(null)}).strict().parse(r.body),i=r.identity;
  await agreementLock(c,i);const a=await group(c,r.params.id),id=uuid.parse(r.params.customerId),payload={...b,agreementId:a.id,customerId:id};if(await prior(c,i,payload))return {data:true};
  if(!(await c.query('SELECT id FROM bansir.customers WHERE id=$1 AND active',[id])).rowCount)fail('Cliente não encontrado.','CUSTOMER_NOT_FOUND',404);
  if(b.active&&(await c.query('SELECT 1 FROM bansir.agreement_members WHERE customer_id=$1 AND active AND agreement_id<>$2',[id,a.id])).rowCount)fail('Desative o vínculo anterior antes de trocar o cliente de convênio.','AGREEMENT_MEMBER_EXISTS');
  await c.query('INSERT INTO bansir.agreement_members(tenant_id,establishment_id,agreement_id,customer_id,active,limit_cents) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,establishment_id,agreement_id,customer_id) DO UPDATE SET active=excluded.active,limit_cents=excluded.limit_cents,updated_at=now()',[i.tenantId,i.establishmentId,a.id,id,b.active,b.limitCents]);
  await audit(c,i,a.id,b.requestKey,'member',payload);return {data:true};
 }));
 app.get('/api/v1/agreements/:id/periods',route('view',async(c,r)=>{await group(c,r.params.id);return {data:(await c.query('SELECT DISTINCT period_end::text FROM bansir.sale_agreements WHERE agreement_id=$1 ORDER BY period_end DESC LIMIT 120',[r.params.id])).rows};}));
 app.get('/api/v1/agreements/:id/statement',route('view',async(c,r)=>({data:await statement(c,uuid.parse(r.params.id),date.optional().parse(r.query.period))})));
 app.get('/api/v1/agreements/:id/statement-pdf',route('view',async(c,r)=>{
  const data=await statement(c,uuid.parse(r.params.id),date.optional().parse(r.query.period));const doc=new PDFDocument({size:'A4',margin:36}),chunks=[];
  const output=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const money=n=>(Number(n)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  doc.fontSize(17).text('Demonstrativo de convênio').moveDown().fontSize(11).text(data.agreement.name).text('Responsável pelo pagamento: '+data.agreement.payer_name).text('Período: '+(r.query.period||'Todos')).text('Saldo a receber: '+money(data.outstandingCents)).moveDown();
  for(const sale of data.sales){if(doc.y>710)doc.addPage();doc.fontSize(10).text('Cupom '+sale.coupon_number+' | '+sale.customer_name+' | Vencimento '+sale.due_date).text('Total '+money(sale.total_cents)+' | Saldo '+money(sale.outstanding_cents)+(sale.cancelled_at?' | CANCELADA':''));for(const item of sale.items||[])doc.fontSize(9).text('  '+item.quantity+' x '+item.name);doc.moveDown(.5);}
  doc.fontSize(9).text('Demonstrativo de cobrança. Sem valor fiscal. Os documentos fiscais das vendas são emitidos separadamente.');doc.end();const pdf=await output;
  return {data:{base64:pdf.toString('base64'),filename:'extrato-convenio.pdf'}};
 }));
 app.post('/api/v1/agreements/:id/close',route('close',async(c,r)=>{
  const b=z.object({requestKey:uuid,periodEnd:date}).strict().parse(r.body),i=r.identity;await agreementLock(c,i);const a=await group(c,r.params.id),payload={...b,agreementId:a.id};
  if(await prior(c,i,payload))return {data:await statement(c,a.id,b.periodEnd)};
  const existing=(await c.query('SELECT 1 FROM bansir.agreement_cycles WHERE agreement_id=$1 AND period_end=$2',[a.id,b.periodEnd])).rowCount;
  if(existing)return {data:await statement(c,a.id,b.periodEnd)};
  if(b.periodEnd>await agreementToday(c))fail('O período ainda não chegou ao dia de fechamento.','AGREEMENT_PERIOD_OPEN');
  const data=await statement(c,a.id,b.periodEnd);if(!data.sales.length)fail('Não há vendas neste período.','AGREEMENT_EMPTY');
  await c.query('INSERT INTO bansir.agreement_cycles(tenant_id,establishment_id,agreement_id,period_end,request_key,request_hash,snapshot,closed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[i.tenantId,i.establishmentId,a.id,b.periodEnd,b.requestKey,hash(i,payload),{sales:data.sales.map(s=>({saleId:s.sale_id,totalCents:s.total_cents,outstandingCents:s.outstanding_cents})),outstandingCents:data.outstandingCents},i.userId]);
  await audit(c,i,a.id,b.requestKey,'close',payload);return {data:await statement(c,a.id,b.periodEnd)};
 }));
 app.post('/api/v1/agreements/:id/receipts',route('collect',async(c,r)=>{
  const b=z.object({requestKey:uuid,confirmed:z.literal(true),method:z.enum(['cash','pix','credit_card','debit_card']),receivedCents:cents.optional(),reference:z.string().trim().max(160).default(''),installments:z.number().int().min(1).max(24).optional(),allocations:z.array(z.object({saleId:uuid,amountCents:cents.positive()}).strict()).min(1).max(500)}).strict().parse(r.body),i=r.identity;
  if(new Set(b.allocations.map(x=>x.saleId)).size!==b.allocations.length)fail('Venda repetida na distribuição.','INVALID_ALLOCATION',400);
  await agreementLock(c,i);const a=await group(c,r.params.id),payload={...b,agreementId:a.id},fingerprint=hash(i,payload);
  const old=(await c.query('SELECT * FROM bansir.agreement_receipts WHERE request_key=$1',[b.requestKey])).rows[0];if(old){if(old.request_hash!==fingerprint)fail('Tentativa já utilizada com outros dados.','IDEMPOTENCY_CONFLICT');return {data:old};}
  const amount=b.allocations.reduce((n,x)=>n+x.amountCents,0);if(amount>1000000000)fail('Valor acima do limite permitido.','INVALID_PAYMENT',400);
  if(b.method==='cash'&&(b.receivedCents??0)<amount)fail('Valor em dinheiro insuficiente.','INSUFFICIENT_CASH',400);
  if(b.method!=='cash'&&b.receivedCents!==undefined&&b.receivedCents!==amount)fail('Troco somente em dinheiro.','INVALID_CHANGE',400);
  const cash=await openCash(c,i);const receipt=(await c.query('INSERT INTO bansir.agreement_receipts(tenant_id,establishment_id,agreement_id,request_key,request_hash,amount_cents,method,received_by,cash_session_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[i.tenantId,i.establishmentId,a.id,b.requestKey,fingerprint,amount,b.method,i.userId,cash.id])).rows[0];
  let first=true;
  for(const allocation of [...b.allocations].sort((x,y)=>x.saleId.localeCompare(y.saleId))){
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`bansir-pdv:${i.tenantId}:${i.establishmentId}:sale:${allocation.saleId}`]);
   if(!(await c.query('SELECT 1 FROM bansir.sale_agreements WHERE sale_id=$1 AND agreement_id=$2',[allocation.saleId,a.id])).rowCount)fail('Venda não pertence a este convênio.','INVALID_ALLOCATION',404);
   const sale=await saleView(c,allocation.saleId);const payment={requestKey:randomUUID(),method:b.method,confirmed:true,amountCents:allocation.amountCents,reference:`Convênio ${receipt.id} ${b.reference}`.trim().slice(0,200),...(b.installments?{installments:b.installments}:{}),...(b.method==='cash'?{receivedCents:allocation.amountCents+(first?(b.receivedCents-amount):0)}:{})};
   const paymentId=await recordPayment(c,i,sale,cash,payment);first=false;
   await c.query('INSERT INTO bansir.agreement_allocations(tenant_id,establishment_id,receipt_id,payment_id) VALUES($1,$2,$3,$4)',[i.tenantId,i.establishmentId,receipt.id,paymentId]);
  }
  await audit(c,i,a.id,b.requestKey,'receive',{...payload,receiptId:receipt.id});return {status:201,data:receipt};
 }));
}
