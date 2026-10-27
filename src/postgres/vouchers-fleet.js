import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {httpError} from './database.js';
import {createCustomer} from './customers.js';
import {registerSale,saleView} from './sales.js';
import {fiscalDraftHash} from './fiscal.js';
import {queueWhatsapp} from './whatsapp.js';
import {normalizePhone} from './phone.js';

const admin=m=>['admin','superadmin'].includes(m?.role);
const canIssue=m=>admin(m)||m?.allowed_routes?.some(r=>['valegas','valegas-issue'].includes(r));
const canRedeem=m=>admin(m)||m?.role==='entregador'||m?.allowed_routes?.some(r=>['valegas','valegas-redeem'].includes(r));
const money=z.number().finite().min(0).max(10000000).refine(v=>Math.abs(v*100-Math.round(v*100))<0.00001,'Use duas casas decimais.');
const uuid=z.uuid();
const itemsInput=z.array(z.object({product:uuid,productName:z.string().trim().min(1).max(200),quantity:z.number().int().min(1).max(1000),price:money}).strict()).min(1).max(100);
const vehicleInput=z.object({code:z.string().trim().min(1).max(40),name:z.string().trim().min(1).max(200),plate:z.string().trim().max(20).default(''),brand:z.string().trim().max(100).default(''),year:z.coerce.number().int().min(1900).max(2200).nullable().optional(),type:z.enum(['CARRO','CAMINHÃO','MOTO','OUTROS']).default('CAMINHÃO'),status:z.enum(['ATIVO','MANUTENÇÃO','VENDIDO']).default('ATIVO'),purchaseValue:money.default(0),notes:z.string().max(2000).default(''),currentKm:z.coerce.number().int().min(0).max(10000000).default(0),lastKmUpdate:z.coerce.date().nullable().optional(),maintenanceRules:z.array(z.object({name:z.string().trim().min(1).max(100),intervalKm:z.coerce.number().int().min(1).max(10000000),lastServiceKm:z.coerce.number().int().min(0).max(10000000)}).strict()).max(100).default([])}).strict();
const endpoint=(database,fn)=>async(req,res,next)=>{try{const result=await database.transaction(req.identity,(c,m)=>fn(c,req,m));res.status(result.status||200).json({success:true,data:result.data});}catch(error){next(error);}};
const forbidden=()=>{throw httpError(403,'Seu perfil não tem permissão para este recurso.','FORBIDDEN');};
const voucherView=row=>({...row,_id:row.id,totalAmount:Number(row.total_cents)/100,customerName:row.customer_name,customerPhone:row.customer_phone,issuedByName:row.issued_by_name,redeemedByName:row.redeemed_by_name,source:row.sale_id?'PDV':'LEGADO',saleId:row.sale_id,issuedBy:row.issued_by,redeemedBy:row.redeemed_by,issuedAt:row.issued_at,redeemedAt:row.redeemed_at});
const vehicleView=row=>({...row,_id:row.id,purchaseValue:Number(row.purchase_cents)/100,currentKm:Number(row.current_km),lastKmUpdate:row.last_km_update,maintenanceRules:row.maintenance_rules});

export function mountVouchersFleet(app,{database}){
 app.get('/api/v1/vouchers',endpoint(database,async(c,req,m)=>{
  if(!canIssue(m)&&!canRedeem(m))forbidden();const status=z.enum(['ACTIVE','REDEEMED','CANCELLED']).optional().parse(req.query.status);
  const rows=(await c.query('SELECT * FROM bansir.vouchers WHERE tenant_id=$1 AND establishment_id=$2 AND ($3::text IS NULL OR status=$3) ORDER BY issued_at DESC LIMIT 100',[req.identity.tenantId,req.identity.establishmentId,status||null])).rows;
  return {data:rows.map(voucherView)};
 }));
 app.post('/api/v1/vouchers',endpoint(database,async(c,req,m)=>{
  if(!canIssue(m))forbidden();const input=z.object({requestKey:z.uuid(),payment:z.record(z.string(),z.unknown()),customerName:z.string().trim().min(2).max(200),customerPhone:z.string().trim().min(10).max(30),items:itemsInput,totalAmount:money}).strict().parse(req.body),i=req.identity;
  const requestHash=fiscalDraftHash(input);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`voucher:${i.tenantId}:${i.establishmentId}:${input.requestKey}`]);
  const existing=(await c.query('SELECT * FROM bansir.vouchers WHERE request_key=$1',[input.requestKey])).rows[0];
  if(existing){if(existing.request_hash!==requestHash)throw httpError(409,'Tentativa já usada com outro conteúdo.','IDEMPOTENCY_CONFLICT');return {data:voucherView(existing)};}
  if((await c.query('SELECT id FROM bansir.sales WHERE request_key=$1',[input.requestKey])).rowCount)throw httpError(409,'Tentativa já utilizada em outra venda.','IDEMPOTENCY_CONFLICT');
  if(input.payment.method==='pending')throw httpError(400,'O vale precisa ser pago na emissão.','PAYMENT_REQUIRED');
  const phone=normalizePhone(input.customerPhone);
  const ids=input.items.map(item=>item.product),products=(await c.query('SELECT id,name,price_cents,active FROM bansir.products WHERE id=ANY($1::uuid[])',[ids])).rows;
  const snapshots=input.items.map(item=>{const product=products.find(row=>row.id===item.product),price=Math.round(item.price*100);if(!product?.active)throw httpError(409,'Um dos produtos do vale não está disponível.','PRODUCT_UNAVAILABLE');if(price!==Number(product.price_cents))throw httpError(409,'O preço de um produto mudou. Atualize o vale antes de emitir.','PRICE_CHANGED');return {product:item.product,productName:product.name,quantity:item.quantity,price:item.price};});
  const cents=snapshots.reduce((sum,item)=>sum+Math.round(item.price*100)*item.quantity,0);if(cents!==Math.round(input.totalAmount*100))throw httpError(400,'O total do vale não confere com os itens.','INVALID_TOTAL');
  const customer=await createCustomer(c,i,{name:input.customerName,phone:input.customerPhone},{useExisting:true});
  const sale=await registerSale(c,i,m,{requestKey:input.requestKey,customerId:customer.id,items:snapshots.map(item=>({productId:item.product,quantity:item.quantity,expectedUnitPriceCents:Math.round(item.price*100)})),payment:input.payment},{voucherReservation:true});
  const {rows:[actor]}=await c.query('SELECT name FROM bansir.users WHERE id=$1',[i.userId]);let row;
  for(let tries=0;tries<3;tries++){const code=`VGL-${randomBytes(5).toString('hex').toUpperCase()}`;try{row=(await c.query(`INSERT INTO bansir.vouchers(tenant_id,establishment_id,code,customer_name,customer_phone,items,total_cents,issued_by,issued_by_name,request_key,request_hash,sale_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(tenant_id,establishment_id,code) DO NOTHING RETURNING *`,[i.tenantId,i.establishmentId,code,input.customerName,phone,JSON.stringify(snapshots),cents,i.userId,actor?.name||'Equipe',input.requestKey,requestHash,sale.id])).rows[0];if(row)break;}catch(error){if(error.code!=='23505'||tries===2)throw error;}}
  if(!row)throw httpError(409,'Não foi possível gerar o código. Repita a tentativa.','CODE_UNAVAILABLE');
  const message=`🔥 Seu Vale Gás Digital foi emitido!\nOlá ${row.customer_name}.\nCódigo: ${row.code}\nItens: ${snapshots.map(item=>`${item.quantity}x ${item.productName}`).join(', ')}\nTotal: R$ ${(cents/100).toFixed(2)}\nApresente o código para resgatar.`;
  const whatsappQueued=await queueWhatsapp(c,i,{key:`voucher:${row.id}`,payload:{permission:'valegas',action:'send-voucher',phone,message,code:row.code}});
  return {status:201,data:{...voucherView(row),whatsappQueued:!!whatsappQueued}};
 }));
 app.get('/api/v1/vouchers/:code',endpoint(database,async(c,req,m)=>{
  if(!canIssue(m)&&!canRedeem(m))forbidden();const row=(await c.query('SELECT * FROM bansir.vouchers WHERE tenant_id=$1 AND establishment_id=$2 AND code=$3',[req.identity.tenantId,req.identity.establishmentId,String(req.params.code).toUpperCase()])).rows[0];
  if(!row)throw httpError(404,'Vale Gás não encontrado.','NOT_FOUND');return {data:voucherView(row)};
 }));
 app.post('/api/v1/vouchers/:code/redeem',endpoint(database,async(c,req,m)=>{
  if(!canRedeem(m))forbidden();const i=req.identity,code=String(req.params.code).toUpperCase();
  const voucher=(await c.query('SELECT * FROM bansir.vouchers WHERE code=$1 FOR UPDATE',[code])).rows[0];
  if(!voucher)throw httpError(404,'Vale não encontrado.','NOT_FOUND');
  if(voucher.status==='REDEEMED')return {data:voucherView(voucher)};
  if(!voucher.sale_id)throw httpError(409,'Vale antigo sem pagamento vinculado. Necessária conciliação antes de entregar.','VOUCHER_RECONCILIATION_REQUIRED');
  const sale=await saleView(c,voucher.sale_id);if(voucher.status!=='ACTIVE'||sale?.status!=='paid')throw httpError(409,'Vale cancelado ou sem pagamento confirmado.','VOUCHER_NOT_ACTIVE');
  const {rows:[actor]}=await c.query('SELECT name FROM bansir.users WHERE id=$1',[i.userId]);const row=(await c.query(`UPDATE bansir.vouchers SET status='REDEEMED',redeemed_by=$4,redeemed_by_name=$5,redeemed_at=now()
   WHERE tenant_id=$1 AND establishment_id=$2 AND code=$3 AND status='ACTIVE' RETURNING *`,[i.tenantId,i.establishmentId,code,i.userId,actor?.name||''])).rows[0];
  if(!row){const existing=(await c.query('SELECT status FROM bansir.vouchers WHERE tenant_id=$1 AND establishment_id=$2 AND code=$3',[i.tenantId,i.establishmentId,code])).rows[0];if(!existing)throw httpError(404,'Vale Gás não encontrado.','NOT_FOUND');throw httpError(409,`Este vale já foi ${existing.status==='REDEEMED'?'resgatado':'cancelado'}.`,'VOUCHER_NOT_ACTIVE');}
  return {data:voucherView(row)};
 }));
 app.get('/api/v1/fleet/vehicles',endpoint(database,async(c,req,m)=>{
  if(!admin(m))forbidden();const rows=(await c.query('SELECT * FROM bansir.vehicles WHERE tenant_id=$1 AND establishment_id=$2 ORDER BY created_at DESC',[req.identity.tenantId,req.identity.establishmentId])).rows;return {data:rows.map(vehicleView)};
 }));
 app.post('/api/v1/fleet/vehicles',endpoint(database,async(c,req,m)=>{
  if(!admin(m))forbidden();const d=vehicleInput.parse(req.body),i=req.identity;const row=(await c.query(`INSERT INTO bansir.vehicles(tenant_id,establishment_id,code,name,plate,brand,year,type,status,purchase_cents,notes,current_km,last_km_update,maintenance_rules)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[i.tenantId,i.establishmentId,d.code,d.name,d.plate.toUpperCase(),d.brand,d.year??null,d.type,d.status,Math.round(d.purchaseValue*100),d.notes,d.currentKm,d.lastKmUpdate||null,JSON.stringify(d.maintenanceRules)])).rows[0];return {status:201,data:vehicleView(row)};
 }));
 app.put('/api/v1/fleet/vehicles/:id',endpoint(database,async(c,req,m)=>{
  if(!admin(m))forbidden();const d=vehicleInput.parse(req.body),i=req.identity,id=uuid.parse(req.params.id);const row=(await c.query(`UPDATE bansir.vehicles SET code=$3,name=$4,plate=$5,brand=$6,year=$7,type=$8,status=$9,purchase_cents=$10,notes=$11,current_km=$12,last_km_update=$13,maintenance_rules=$14,updated_at=now()
   WHERE tenant_id=$1 AND establishment_id=$2 AND id=$15 RETURNING *`,[i.tenantId,i.establishmentId,d.code,d.name,d.plate.toUpperCase(),d.brand,d.year??null,d.type,d.status,Math.round(d.purchaseValue*100),d.notes,d.currentKm,d.lastKmUpdate||null,JSON.stringify(d.maintenanceRules),id])).rows[0];if(!row)throw httpError(404,'Veículo não encontrado.','NOT_FOUND');return {data:vehicleView(row)};
 }));
 app.delete('/api/v1/fleet/vehicles/:id',endpoint(database,async(c,req,m)=>{
  if(!admin(m))forbidden();const result=await c.query('DELETE FROM bansir.vehicles WHERE tenant_id=$1 AND establishment_id=$2 AND id=$3 RETURNING id',[req.identity.tenantId,req.identity.establishmentId,uuid.parse(req.params.id)]);if(!result.rowCount)throw httpError(404,'Veículo não encontrado.','NOT_FOUND');return {data:true};
 }));
}
