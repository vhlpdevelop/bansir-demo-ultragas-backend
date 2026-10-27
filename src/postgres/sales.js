import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {httpError} from './database.js';
import {requirePermission,stockMovement} from './catalog.js';
import {enqueueNotification} from './notifications.js';
import {createFiscalDocument,fiscalDraftHash} from './fiscal.js';
import {pixCode} from './pix.js';
import {createCustomer} from './customers.js';

const cents=z.number().int().min(0).max(1000000000),text=z.string().trim().max(200),uuid=z.uuid();
const hash=fiscalDraftHash;
const fail=(message,code='INVALID_SALE',status=409)=>{throw httpError(status,message,code);};
const manages=member=>['admin','superadmin'].includes(member.role)||member.allowed_routes?.includes('sales-manage');
const viewsAll=member=>manages(member)||member.allowed_routes?.includes('sales-collect');
const discounts=member=>manages(member)||member.allowed_routes?.includes('sales-discount');
const externalPayment=z.object({method:z.enum(['cash','pix','credit_card','debit_card']),confirmed:z.literal(true),reference:text.default(''),receivedCents:cents.optional()}).strict();
const paymentSchema=z.union([externalPayment,z.object({method:z.literal('pending'),term:z.enum(['delivery','pickup','credit']),dueDate:z.iso.date().optional()}).strict()]);
const saleInput=z.object({requestKey:uuid,items:z.array(z.object({productId:uuid,quantity:z.number().int().min(1).max(1000000),expectedUnitPriceCents:cents.refine(n=>n>0),unitPriceCents:cents.refine(n=>n>0).optional()}).strict()).min(1).max(100),discountCents:cents.default(0),deliveryFeeCents:cents.default(0),customerId:uuid.optional(),customerName:text.default(''),customerDocument:z.string().regex(/^(\d{11}|\d{14})?$/).default(''),customerPhone:z.string().regex(/^\d{0,14}$/).default(''),deliveryEmployeeId:uuid.optional(),deliveryMode:z.enum(['pickup','delivery']).default('pickup'),deliveryAddress:z.string().trim().max(1000).default(''),payment:paymentSchema}).strict();
const lock=(c,key)=>c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`bansir-pdv:${key}`]);
const unitKey=i=>`${i.tenantId}:${i.establishmentId}`;
async function lockCash(c,i){await lock(c,`${unitKey(i)}:cash:${i.userId}`);return (await c.query('SELECT * FROM bansir.cash_sessions WHERE user_id=$1 AND closed_at IS NULL',[i.userId])).rows[0];}
async function openCash(c,i){const row=await lockCash(c,i);if(!row)fail('Abra seu caixa neste estabelecimento antes de continuar.','CASH_CLOSED');return row;}
async function ownedSale(c,i,member,id){const row=(await c.query('SELECT * FROM bansir.sales WHERE id=$1',[uuid.parse(id)])).rows[0];if(!row || (row.created_by!==i.userId&&!viewsAll(member)))fail('Venda não encontrada.','NOT_FOUND',404);return row;}
async function cashBalance(c,cash){const {rows:[totals]}=await c.query(`SELECT coalesce(sum(CASE WHEN kind IN('refund','withdrawal') THEN -amount_cents ELSE amount_cents END),0) AS delta FROM bansir.cash_movements WHERE cash_session_id=$1`,[cash.id]);return Number(cash.opening_cents)+Number(totals.delta);}
async function cashView(c,cash){if(!cash)return null;const totals=(await c.query(`SELECT p.method,sum(p.amount_cents)::bigint AS cents FROM bansir.sale_payments p WHERE p.cash_session_id=$1 GROUP BY p.method`,[cash.id])).rows;
 return {...cash,opening_cents:Number(cash.opening_cents),expected_cents:cash.closed_at?Number(cash.expected_cents):await cashBalance(c,cash),counted_cents:cash.counted_cents===null?null:Number(cash.counted_cents),difference_cents:cash.difference_cents===null?null:Number(cash.difference_cents),paymentTotals:Object.fromEntries(totals.map(t=>[t.method,Number(t.cents)]))};}
export async function saleView(c,id){
 const s=(await c.query(`SELECT s.*,x.reason AS cancellation_reason,x.created_at AS cancelled_at,f.document_id,d.status AS fiscal_status,d.protocol,d.access_key,d.rejection_code
 FROM bansir.sales s LEFT JOIN bansir.sale_cancellations x ON (x.tenant_id,x.establishment_id,x.sale_id)=(s.tenant_id,s.establishment_id,s.id)
 LEFT JOIN bansir.sale_fiscal_links f ON (f.tenant_id,f.establishment_id,f.sale_id)=(s.tenant_id,s.establishment_id,s.id)
 LEFT JOIN bansir.fiscal_documents d ON (d.tenant_id,d.establishment_id,d.id)=(f.tenant_id,f.establishment_id,f.document_id) WHERE s.id=$1`,[id])).rows[0];
 if(!s)return null;
 for(const key of ['subtotal_cents','discount_cents','delivery_fee_cents','total_cents'])s[key]=Number(s[key]);
 s.items=(await c.query('SELECT tenant_id,establishment_id,sale_id,product_id,position,product_name,barcode,unit,ncm,quantity,unit_price_cents,gross_cents,discount_cents FROM bansir.sale_items WHERE sale_id=$1 ORDER BY position',[id])).rows.map(row=>({...row,unit_price_cents:Number(row.unit_price_cents),gross_cents:Number(row.gross_cents),discount_cents:Number(row.discount_cents)}));
 s.payments=(await c.query('SELECT id,method,amount_cents,received_cents,reference,created_at FROM bansir.sale_payments WHERE sale_id=$1 ORDER BY created_at',[id])).rows.map(row=>({...row,amount_cents:Number(row.amount_cents),received_cents:Number(row.received_cents)}));
 s.paid_cents=s.payments.reduce((sum,p)=>sum+p.amount_cents,0);s.outstanding_cents=s.cancelled_at?0:s.total_cents-s.paid_cents;
 s.status=s.cancelled_at?'cancelled':s.outstanding_cents?'pending':'paid';s.invoiceIssued=s.fiscal_status==='authorized';s.saleNumber=`V-${s.id.slice(0,8).toUpperCase()}`;return s;
}
function checkPayment(p,amount){
 if(p.method!=='cash' && p.reference.length<3)fail('Informe a referência conferida do PIX ou NSU/autorização da maquininha.','PAYMENT_REFERENCE_REQUIRED',400);
 const received=p.method==='cash'?(p.receivedCents??0):amount;
 if(received<amount)fail('Valor recebido em dinheiro é menor que o valor a pagar.','INSUFFICIENT_CASH',400);
 if(p.method!=='cash' && p.receivedCents!==undefined && p.receivedCents!==amount)fail('Troco é permitido somente em dinheiro.','INVALID_CHANGE',400);
 return received;
}
async function recordPayment(c,i,sale,cash,input){
 const paymentHash=hash({...input,userId:i.userId});
 const previous=(await c.query('SELECT sale_id,request_hash FROM bansir.sale_payments WHERE request_key=$1',[input.requestKey])).rows[0];
 if(previous){if(previous.request_hash!==paymentHash||previous.sale_id!==sale.id)fail('Identificador de pagamento já utilizado.','IDEMPOTENCY_CONFLICT');return;}
 const view=await saleView(c,sale.id);if(view.cancelled_at)fail('Venda cancelada.','SALE_CANCELLED');
 if(input.amountCents>view.outstanding_cents)fail('Pagamento supera o saldo pendente.','PAYMENT_EXCEEDS_BALANCE');
 const received=checkPayment(input,input.amountCents);
 const {rows:[payment]}=await c.query(`INSERT INTO bansir.sale_payments(tenant_id,establishment_id,sale_id,cash_session_id,request_key,request_hash,paid_by,method,amount_cents,received_cents,reference)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[i.tenantId,i.establishmentId,sale.id,cash.id,input.requestKey,paymentHash,i.userId,input.method,input.amountCents,received,input.reference]);
 if(input.method==='cash')await c.query(`INSERT INTO bansir.cash_movements(tenant_id,establishment_id,cash_session_id,request_key,request_hash,payment_id,kind,amount_cents,reason)
 VALUES($1,$2,$3,$4,$5,$6,'sale',$7,'Recebimento de venda')`,[i.tenantId,i.establishmentId,cash.id,randomUUID(),paymentHash,payment.id,input.amountCents]);
}
export async function registerSale(c,i,member,body){
 const input=saleInput.parse(body),requestHash=hash({input,userId:i.userId});
 await lock(c,`${unitKey(i)}:request:${input.requestKey}`);
 const previous=(await c.query('SELECT id,request_hash FROM bansir.sales WHERE request_key=$1',[input.requestKey])).rows[0];
 if(previous){if(previous.request_hash!==requestHash)fail('Identificador de venda já utilizado com outro conteúdo.','IDEMPOTENCY_CONFLICT');return saleView(c,previous.id);}
 const cash=await openCash(c,i);
 if(new Set(input.items.map(item=>item.productId)).size!==input.items.length)fail('Agrupe quantidades do mesmo produto.','DUPLICATE_PRODUCT',400);
 if((input.discountCents>0||input.items.some(item=>item.unitPriceCents!==undefined&&item.unitPriceCents!==item.expectedUnitPriceCents))&&!discounts(member))fail('Seu perfil não pode aplicar descontos ou alterar preços.','DISCOUNT_FORBIDDEN',403);
 let customer={name:input.customerName,document:input.customerDocument,phone:input.customerPhone,address:input.deliveryAddress};
 if(input.customerId){customer=(await c.query('SELECT * FROM bansir.customers WHERE id=$1 AND active',[input.customerId])).rows[0];if(!customer)fail('Cliente não encontrado neste estabelecimento.','CUSTOMER_NOT_FOUND',404);}
 const deliverer=input.deliveryEmployeeId?(await c.query('SELECT id,name,phone FROM bansir.deliverers WHERE id=$1 AND active',[input.deliveryEmployeeId])).rows[0]:null;
 if(input.deliveryEmployeeId&&!deliverer)fail('Entregador não encontrado neste estabelecimento.','DELIVERER_NOT_FOUND',404);
 const address=input.deliveryAddress||customer.address;
 if(input.deliveryMode==='delivery'&&(!address||!customer.name||!customer.phone))fail('Entrega exige nome, telefone e endereço do cliente.','DELIVERY_CUSTOMER_REQUIRED',400);
 if(input.deliveryMode==='pickup'&&input.deliveryFeeCents)fail('Taxa de entrega exige modalidade entrega.','INVALID_DELIVERY_FEE',400);
 if(input.payment.method==='pending'){
  if(!customer.name||!customer.phone)fail('Venda a receber exige cliente identificado e telefone.','CUSTOMER_REQUIRED',400);
  if(input.payment.term==='delivery'&&input.deliveryMode!=='delivery')fail('Cobrança na entrega exige entrega.','INVALID_PAYMENT_TERM',400);
  if(input.payment.term==='pickup'&&input.deliveryMode!=='pickup')fail('Cobrança na retirada exige retirada no balcão.','INVALID_PAYMENT_TERM',400);
  if(input.payment.term==='credit'&&!input.payment.dueDate)fail('Informe vencimento da venda a prazo.','DUE_DATE_REQUIRED',400);
 }
 const products=(await c.query('SELECT * FROM bansir.products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[input.items.map(item=>item.productId)])).rows;
 const items=input.items.map((item,index)=>{const p=products.find(p=>p.id===item.productId);if(!p||!p.active||p.stock<item.quantity)fail('Produto indisponível ou estoque insuficiente.','STOCK_UNAVAILABLE');if(Number(p.price_cents)!==item.expectedUnitPriceCents)fail('O preço mudou. Atualize o produto antes de vender.','PRICE_CHANGED');const unitPrice=item.unitPriceCents??Number(p.price_cents);return {...item,product:p,position:index+1,unitPrice,gross:unitPrice*item.quantity};});
 const subtotal=items.reduce((sum,item)=>sum+item.gross,0),total=subtotal-input.discountCents+input.deliveryFeeCents;
 if(!Number.isSafeInteger(subtotal)||subtotal>1000000000||total>1000000000||input.discountCents>=subtotal)fail('Total ou desconto inválido.','INVALID_TOTAL',400);
 let remaining=input.discountCents;for(const item of items){item.discount=Number(BigInt(input.discountCents)*BigInt(item.gross)/BigInt(subtotal));remaining-=item.discount;}
 for(const item of items){if(!remaining)break;item.discount++;remaining--;}
 if(input.payment.method!=='pending')checkPayment(input.payment,total);
 const {rows:[actor]}=await c.query('SELECT name FROM bansir.users WHERE id=$1',[i.userId]);
 const {rows:[sale]}=await c.query(`INSERT INTO bansir.sales(tenant_id,establishment_id,request_key,request_hash,cash_session_id,created_by,seller_name,customer_id,customer_name,customer_document,customer_phone,subtotal_cents,discount_cents,delivery_fee_cents,total_cents,delivery_mode,delivery_address,payment_term,due_date,delivery_employee_id,delivery_employee_name,delivery_employee_phone)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,[i.tenantId,i.establishmentId,input.requestKey,requestHash,cash.id,i.userId,actor.name,input.customerId||null,customer.name,customer.document,customer.phone,subtotal,input.discountCents,input.deliveryFeeCents,total,input.deliveryMode,address,input.payment.method==='pending'?input.payment.term:'immediate',input.payment.dueDate||null,deliverer?.id||null,deliverer?.name||'',deliverer?.phone||'']);
 for(const item of items){
  await c.query(`INSERT INTO bansir.sale_items(tenant_id,establishment_id,sale_id,product_id,position,product_name,barcode,unit,ncm,quantity,unit_price_cents,gross_cents,discount_cents,unit_cost_cents)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[i.tenantId,i.establishmentId,sale.id,item.productId,item.position,item.product.name,item.product.barcode,item.product.unit,item.product.ncm,item.quantity,item.unitPrice,item.gross,item.discount,item.product.cost_cents]);
  await c.query('UPDATE bansir.products SET stock=stock-$2,updated_at=now() WHERE id=$1',[item.productId,item.quantity]);
  await stockMovement(c,i,item.product,item.quantity,'out',`Venda ${sale.id}`);
  if(item.product.stock-item.quantity<=5)await enqueueNotification(c,i,{key:`stock-sale:${sale.id}:${item.productId}`,title:'Estoque baixo',body:`${item.product.name}: ${item.product.stock-item.quantity} unidades.`});
 }
 if(input.payment.method!=='pending')await recordPayment(c,i,sale,cash,{...input.payment,requestKey:input.requestKey,amountCents:total});
 await enqueueNotification(c,i,{key:`sale:${sale.id}`,title:'Venda registrada',body:`Venda ${sale.id.slice(0,8)} registrada com estoque e recebíveis.`});
 return saleView(c,sale.id);
}

export function mountSales(app,{scoped}){
 app.get('/api/v1/pdv/cash',scoped('sales',true,async(c,req)=>({data:await cashView(c,await lockCash(c,req.identity))})));
 app.post('/api/v1/pdv/cash/open',scoped('sales',false,async(c,req)=>{
  const {openingCents}=z.object({openingCents:cents}).strict().parse(req.body),i=req.identity;
  const current=await lockCash(c,i);if(current){if(Number(current.opening_cents)!==openingCents)fail('Já existe caixa aberto com outro valor inicial.','CASH_ALREADY_OPEN');return {data:await cashView(c,current)};}
  const {rows:[cash]}=await c.query('INSERT INTO bansir.cash_sessions(tenant_id,establishment_id,user_id,opening_cents) VALUES($1,$2,$3,$4) RETURNING *',[i.tenantId,i.establishmentId,i.userId,openingCents]);return {status:201,data:await cashView(c,cash)};
 }));
 app.get('/api/v1/pdv/cash/history',scoped('sales',true,async(c,req)=>({data:await Promise.all((await c.query('SELECT * FROM bansir.cash_sessions WHERE user_id=$1 ORDER BY opened_at DESC LIMIT 30',[req.identity.userId])).rows.map(cash=>cashView(c,cash)))})));
 app.post('/api/v1/pdv/cash/:id/close',scoped('sales',false,async(c,req)=>{
  const input=z.object({countedCents:cents,note:z.string().trim().max(1000).default('')}).strict().parse(req.body),i=req.identity;
  await lockCash(c,i);const cash=(await c.query('SELECT * FROM bansir.cash_sessions WHERE id=$1 AND user_id=$2',[uuid.parse(req.params.id),i.userId])).rows[0];if(!cash)fail('Caixa não encontrado.','NOT_FOUND',404);
  if(cash.closed_at){if(Number(cash.counted_cents)!==input.countedCents||cash.closing_note!==input.note)fail('Caixa já fechado com outra conferência.','CASH_ALREADY_CLOSED');return {data:await cashView(c,cash)};}
  const expected=await cashBalance(c,cash),difference=input.countedCents-expected;
  if(difference&&!input.note)fail('Informe o motivo da diferença de caixa.','CASH_DIFFERENCE_NOTE',400);
  const closed=(await c.query('UPDATE bansir.cash_sessions SET closed_at=now(),counted_cents=$2,expected_cents=$3,difference_cents=$4,closing_note=$5 WHERE id=$1 RETURNING *',[cash.id,input.countedCents,expected,difference,input.note])).rows[0];return {data:await cashView(c,closed)};
 }));
 app.post('/api/v1/pdv/cash/movements',scoped('sales',false,async(c,req,member)=>{
  if(!manages(member)&&!member.allowed_routes?.includes('cash-adjust'))fail('Seu perfil não pode fazer sangria ou suprimento.','FORBIDDEN',403);
  const input=z.object({requestKey:uuid,kind:z.enum(['deposit','withdrawal']),amountCents:cents.refine(n=>n>0),reason:z.string().trim().min(3).max(1000)}).strict().parse(req.body),i=req.identity,cash=await openCash(c,i),fingerprint=hash({...input,userId:i.userId});
  const previous=(await c.query('SELECT request_hash FROM bansir.cash_movements WHERE request_key=$1',[input.requestKey])).rows[0];if(previous){if(previous.request_hash!==fingerprint)fail('Identificador já utilizado.','IDEMPOTENCY_CONFLICT');return {data:await cashView(c,cash)};}
  if(input.kind==='withdrawal'&&input.amountCents>await cashBalance(c,cash))fail('Saldo físico insuficiente para sangria.','INSUFFICIENT_CASH');
  await c.query('INSERT INTO bansir.cash_movements(tenant_id,establishment_id,cash_session_id,request_key,request_hash,kind,amount_cents,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[i.tenantId,i.establishmentId,cash.id,input.requestKey,fingerprint,input.kind,input.amountCents,input.reason]);return {status:201,data:await cashView(c,cash)};
 }));
 app.get('/api/v1/sales',scoped('sales',true,async(c,req,member)=>{
  const q=z.object({page:z.coerce.number().int().min(0).max(10000).default(0),pageSize:z.coerce.number().int().min(1).max(100).default(30),status:z.enum(['all','pending']).default('all')}).parse(req.query);
  const ids=(await c.query(`SELECT s.id FROM bansir.sales s WHERE ($1::boolean OR s.created_by=$2) AND ($5='all' OR
   (NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE x.sale_id=s.id) AND s.total_cents>(SELECT coalesce(sum(p.amount_cents),0) FROM bansir.sale_payments p WHERE p.sale_id=s.id)))
   ORDER BY s.created_at DESC,s.id LIMIT $3 OFFSET $4`,[viewsAll(member),req.identity.userId,q.pageSize,q.page*q.pageSize,q.status])).rows;
  return {data:await Promise.all(ids.map(row=>saleView(c,row.id)))};
 }));
 app.post('/api/v1/sales',scoped('sales',false,async(c,req,member)=>({status:201,data:await registerSale(c,req.identity,member,req.body)})));
 app.get('/api/v1/sales/:id',scoped('sales',true,async(c,req,member)=>{await ownedSale(c,req.identity,member,req.params.id);return {data:await saleView(c,req.params.id)};}));
 app.post('/api/v1/sales/:id/payments',scoped('sales',false,async(c,req,member)=>{
  const input=externalPayment.extend({requestKey:uuid,amountCents:cents.refine(n=>n>0)}).parse(req.body),i=req.identity;
  // Idempotent retries still return their receipt after the original cash was closed.
  await lock(c,`${unitKey(i)}:payment:${input.requestKey}`);await lockCash(c,i);await lock(c,`${unitKey(i)}:sale:${uuid.parse(req.params.id)}`);
  const sale=await ownedSale(c,i,member,req.params.id),previous=(await c.query('SELECT sale_id,request_hash FROM bansir.sale_payments WHERE request_key=$1',[input.requestKey])).rows[0];
  if(previous){if(previous.sale_id!==sale.id||previous.request_hash!==hash({...input,userId:i.userId}))fail('Identificador já utilizado.','IDEMPOTENCY_CONFLICT');return {data:await saleView(c,sale.id)};}
  const cash=await openCash(c,i);await recordPayment(c,i,sale,cash,input);return {status:201,data:await saleView(c,sale.id)};
 }));
 app.post('/api/v1/sales/:id/cancel',scoped('sales',false,async(c,req,member)=>{
  if(!manages(member))fail('Cancelamento exige permissão de gestão de vendas.','FORBIDDEN',403);
  const input=z.object({reason:z.string().trim().min(5).max(1000),refundConfirmed:z.literal(true),refundReference:text.default('')}).strict().parse(req.body),i=req.identity;
  const cash=await lockCash(c,i);await lock(c,`${unitKey(i)}:sale:${uuid.parse(req.params.id)}`);await ownedSale(c,i,member,req.params.id);const sale=await saleView(c,req.params.id);
  if(sale.cancelled_at)return {data:sale};if(sale.document_id)fail('Venda com documento fiscal exige o fluxo fiscal de cancelamento.','FISCAL_CANCELLATION_REQUIRED');
  if(!cash)fail('Abra seu caixa para registrar o cancelamento.','CASH_CLOSED');
  if(sale.payments.some(p=>p.method!=='cash')&&input.refundReference.length<3)fail('Informe a referência do estorno externo já realizado.','REFUND_REFERENCE_REQUIRED',400);
  const cashRefund=sale.payments.filter(p=>p.method==='cash').reduce((sum,p)=>sum+p.amount_cents,0);if(cashRefund>await cashBalance(c,cash))fail('Saldo de caixa insuficiente para devolver o dinheiro.','INSUFFICIENT_CASH');
  await c.query('INSERT INTO bansir.sale_cancellations(tenant_id,establishment_id,sale_id,user_id,reason,refund_reference) VALUES($1,$2,$3,$4,$5,$6)',[i.tenantId,i.establishmentId,sale.id,i.userId,input.reason,input.refundReference]);
  await c.query("UPDATE bansir.storefront_orders SET status='cancelled',updated_at=now() WHERE sale_id=$1 AND status='accepted'",[sale.id]);
  const items=[...sale.items].sort((a,b)=>a.product_id.localeCompare(b.product_id));
  for(const item of items){const p=(await c.query('UPDATE bansir.products SET stock=stock+$2,updated_at=now() WHERE id=$1 RETURNING *',[item.product_id,item.quantity])).rows[0];await stockMovement(c,i,p,item.quantity,'in',`Cancelamento ${sale.id}: ${input.reason}`);}
  for(const p of sale.payments.filter(p=>p.method==='cash'))await c.query(`INSERT INTO bansir.cash_movements(tenant_id,establishment_id,cash_session_id,request_key,request_hash,payment_id,kind,amount_cents,reason) VALUES($1,$2,$3,$4,$5,$6,'refund',$7,$8)`,[i.tenantId,i.establishmentId,cash.id,randomUUID(),hash(input),p.id,p.amount_cents,input.reason]);
  return {data:await saleView(c,sale.id)};
 }));
 app.post('/api/v1/sales/:id/pix',scoped('sales',true,async(c,req,member)=>{
  await ownedSale(c,req.identity,member,req.params.id);const sale=await saleView(c,req.params.id);if(sale.status!=='pending')fail('Esta venda não tem saldo a receber.','NO_OUTSTANDING_BALANCE');
  const settings=(await c.query('SELECT * FROM bansir.store_settings')).rows[0];const brCode=pixCode({key:settings?.pix_key||'',name:settings?.store_name||'',city:settings?.merchant_city||'',amountCents:sale.outstanding_cents,txid:sale.id});return {data:{brCode,amountCents:sale.outstanding_cents,manualConfirmationRequired:true}};
 }));
 app.get('/api/v1/customers/search',scoped('sales',true,async(c,req)=>{
  const q=z.string().trim().min(2).max(200).parse(req.query.q);return {data:(await c.query(`SELECT id,name,document,phone,address FROM bansir.customers WHERE active AND strpos(lower(name||' '||phone||' '||document),lower($1))>0 ORDER BY name LIMIT 20`,[q])).rows};
 }));
 app.post('/api/v1/customers',scoped('sales',false,async(c,req)=>({status:201,data:await createCustomer(c,req.identity,req.body)})));
 mountSaleFiscal(app,{scoped});
}

function mountSaleFiscal(app,{scoped}){
 app.get('/api/v1/sales/:id/fiscal-draft',scoped('sales',true,async(c,req,member)=>{
  requirePermission(member,'fiscal');await ownedSale(c,req.identity,member,req.params.id);const sale=await saleView(c,req.params.id);
  if(sale.status!=='paid')fail('A venda precisa estar paga antes da emissão fiscal.','SALE_NOT_PAID');
  return {data:saleFiscalDraft(sale)};
 }));
 app.post('/api/v1/sales/:id/fiscal',scoped('sales',false,async(c,req,member)=>{
  requirePermission(member,'fiscal');const i=req.identity;await lock(c,`${unitKey(i)}:sale:${uuid.parse(req.params.id)}`);await ownedSale(c,i,member,req.params.id);const sale=await saleView(c,req.params.id);
  if(sale.status!=='paid')fail('Somente venda paga e ativa pode emitir NFC-e.','SALE_NOT_PAID');
  const body=z.object({requestKey:uuid,draft:z.record(z.string(),z.unknown())}).strict().parse(req.body);
  if(sale.document_id){const doc=(await c.query('SELECT request_key,payload FROM bansir.fiscal_documents WHERE id=$1',[sale.document_id])).rows[0];if(doc.request_key!==body.requestKey||hash(body.draft)!==doc.payload.draftHash)fail('Esta venda já possui documento fiscal.','SALE_ALREADY_INVOICED');return {data:{id:sale.document_id,status:sale.fiscal_status}};}
  const expected=saleFiscalDraft(sale),draft=body.draft;
  if(!Array.isArray(draft.det)||draft.det.length!==expected.det.length)fail('Itens fiscais diferentes da venda.','FISCAL_SALE_MISMATCH',400);
  for(let n=0;n<expected.det.length;n++){const p=draft.det[n]?.prod,e=expected.det[n].prod;if(!p||p.cProd!==e.cProd||p.xProd!==e.xProd||p.qCom!==e.qCom||p.vUnCom!==e.vUnCom||p.vProd!==e.vProd||Number(p.vDesc||0)!==Number(e.vDesc||0)||Number(p.vFrete||0)!==Number(e.vFrete||0)||p.uCom!==e.uCom)fail('Valores ou produtos fiscais diferem da venda.','FISCAL_SALE_MISMATCH',400);}
  for(const key of ['vProd','vDesc','vFrete','vNF'])if(Number(draft.total?.ICMSTot?.[key]||0)!==Number(expected.total.ICMSTot[key]))fail('Totais fiscais diferem da venda.','FISCAL_SALE_MISMATCH',400);
  if(hash(draft.pag)!==hash(expected.pag)||hash(draft.dest||null)!==hash(expected.dest||null))fail('Pagamento ou destinatário fiscal diferem da venda.','FISCAL_SALE_MISMATCH',400);
  const doc=await createFiscalDocument(c,i,body);await c.query('INSERT INTO bansir.sale_fiscal_links(tenant_id,establishment_id,sale_id,document_id) VALUES($1,$2,$3,$4)',[i.tenantId,i.establishmentId,sale.id,doc.id]);return {status:202,data:doc};
 }));
}
export function saleFiscalDraft(sale){
 const method={cash:'01',pix:'17',credit_card:'03',debit_card:'04'};
 return {det:sale.items.map((item,index)=>({nItem:index+1,prod:{cProd:item.product_id,cEAN:'SEM GTIN',xProd:item.product_name,NCM:item.ncm,CFOP:'',uCom:item.unit||'UN',qCom:item.quantity,vUnCom:item.unit_price_cents/100,vProd:item.gross_cents/100,cEANTrib:'SEM GTIN',uTrib:item.unit||'UN',qTrib:item.quantity,vUnTrib:item.unit_price_cents/100,indTot:1,...(item.discount_cents?{vDesc:item.discount_cents/100}:{}),...(index===0&&sale.delivery_fee_cents?{vFrete:sale.delivery_fee_cents/100}:{})},imposto:{ICMS:{},PIS:{},COFINS:{}}})),
 total:{ICMSTot:{vBC:0,vICMS:0,vICMSDeson:0,vFCP:0,vBCST:0,vST:0,vFCPST:0,vFCPSTRet:0,vProd:sale.subtotal_cents/100,vFrete:sale.delivery_fee_cents/100,vSeg:0,vDesc:sale.discount_cents/100,vII:0,vIPI:0,vIPIDevol:0,vPIS:0,vCOFINS:0,vOutro:0,vNF:sale.total_cents/100}},
 pag:{detPag:sale.payments.map(p=>({indPag:0,tPag:method[p.method],vPag:p.amount_cents/100,...(['credit_card','debit_card'].includes(p.method)?{card:{tpIntegra:2,cAut:p.reference}}:{})}))},transp:{modFrete:9},...(sale.customer_document?{dest:{CNPJCPF:sale.customer_document,xNome:sale.customer_name||'CONSUMIDOR',indIEDest:9}}:{})};
}




