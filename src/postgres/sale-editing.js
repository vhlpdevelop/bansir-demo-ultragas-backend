import {z} from 'zod';
import {httpError} from './database.js';
import {requirePermission} from './catalog.js';
import {customerFiscalInput} from './customer-fiscal.js';
import {productFiscalInput} from './product-fiscal-profile.js';
import {fiscalDraftHash} from './fiscal.js';
import {assertNoFiscalReservation,fiscalSaleLock} from './fiscal-issuance.js';
import {assertNoSmartpos} from './smartpos-state.js';
import {routeUnitLock} from './delivery-route-state.js';
const manager=m=>['admin','superadmin'].includes(m.role)||m.allowed_routes?.includes('sales-manage');
const customer=z.object({name:z.string().trim().min(1).max(200),document:z.string().regex(/^(\d{11}|\d{14})?$/),phone:z.string().regex(/^\d{0,14}$/),address:z.string().trim().max(1000),email:z.union([z.literal(''),z.email()]).default(''),notes:z.string().max(5000).default(''),fiscal:customerFiscalInput.default({})}).strict();
const editInput=z.object({requestKey:z.uuid(),revision:z.number().int().nonnegative(),reason:z.string().trim().min(5).max(500),customer,deliveryAddress:z.string().trim().max(1000),itemProfiles:z.array(z.object({position:z.number().int().positive(),ncm:z.string().regex(/^(\d{8})?$/),fiscalProfile:productFiscalInput}).strict()).max(100).optional()}).strict();
const projection=s=>({customer:s.customer_details,deliveryAddress:s.delivery_address,itemProfiles:s.items.map(i=>({position:i.position,ncm:i.ncm,fiscalProfile:i.fiscal_profile}))});
export function mountSaleEditing(app,{scoped,saleView,ownedSale}){
 const route=fn=>scoped('sales',true,async(c,r,m)=>{if(!manager(m))throw httpError(403,'Editar vendas exige permissão de gestão de vendas.','FORBIDDEN');return fn(c,r,m);});
 app.get('/api/v1/sales/:id/edit',route(async(c,r,m)=>{
  await ownedSale(c,r.identity,m,r.params.id);const sale=await saleView(c,r.params.id);
  const history=(await c.query('SELECT r.revision,r.reason,r.created_at,u.name AS user_name FROM bansir.sale_revisions r JOIN bansir.users u ON u.id=r.user_id WHERE r.sale_id=$1 ORDER BY r.revision DESC LIMIT 30',[sale.id])).rows;
  return {data:{sale,history}};
 }));
 app.patch('/api/v1/sales/:id/edit',route(async(c,r,m)=>{
  const b=editInput.parse(r.body),i=r.identity,id=z.uuid().parse(r.params.id),fingerprint=fiscalDraftHash({saleId:id,userId:i.userId,...b});
  await routeUnitLock(c,i);await fiscalSaleLock(c,i,id);await ownedSale(c,i,m,id);
  const prior=(await c.query('SELECT request_hash FROM bansir.sale_revisions WHERE request_key=$1',[b.requestKey])).rows[0];
  if(prior){if(prior.request_hash!==fingerprint)throw httpError(409,'Tentativa de edição já utilizada com outros dados.','IDEMPOTENCY_CONFLICT');return {data:await saleView(c,id)};}
  const sale=await saleView(c,id);
  if(sale.revision!==b.revision)throw httpError(409,'Esta venda foi alterada. Atualize antes de editar novamente.','STALE_SALE');
  if(sale.cancelled_at||sale.document_id)throw httpError(409,'Venda cancelada ou com documento fiscal vinculado. Utilize o fluxo fiscal de correção/cancelamento.','SALE_EDIT_LOCKED');
  await assertNoFiscalReservation(c,id,true);await assertNoSmartpos(c,{saleId:id});
  if(b.deliveryAddress!==sale.delivery_address&&(await c.query("SELECT 1 FROM bansir.delivery_tasks WHERE sale_id=$1 AND status IN('assigned','en_route','delivered') UNION ALL SELECT 1 FROM bansir.storefront_orders WHERE sale_id=$1 LIMIT 1",[id])).rowCount)throw httpError(409,'O destino está vinculado a um pedido ou entrega. Revise a entrega antes de alterar o endereço operacional. O endereço fiscal pode ser corrigido separadamente.','SALE_DELIVERY_LOCKED');
  const before=projection(sale);
  if(b.itemProfiles){requirePermission(m,'fiscal');if(b.itemProfiles.length!==sale.items.length||new Set(b.itemProfiles.map(p=>p.position)).size!==sale.items.length||b.itemProfiles.some(p=>!sale.items.some(i=>i.position===p.position)))throw httpError(400,'Informe os mesmos itens da venda para revisar a tributação.','SALE_ITEMS_MISMATCH');
   for(const p of b.itemProfiles)await c.query('UPDATE bansir.sale_items SET ncm=$3,fiscal_profile=$4 WHERE sale_id=$1 AND position=$2',[id,p.position,p.ncm,p.fiscalProfile]);
  }
  if(fiscalDraftHash(before.customer?.fiscal||{})!==fiscalDraftHash(b.customer.fiscal))requirePermission(m,'fiscal');
  await c.query('UPDATE bansir.sales SET customer_name=$2,customer_document=$3,customer_phone=$4,customer_snapshot=$5,delivery_address=$6,revision=revision+1 WHERE id=$1',[id,b.customer.name,b.customer.document,b.customer.phone,b.customer,b.deliveryAddress]);
  const updated=await saleView(c,id);
  await c.query('INSERT INTO bansir.sale_revisions(tenant_id,establishment_id,sale_id,revision,request_key,request_hash,user_id,reason,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[i.tenantId,i.establishmentId,id,updated.revision,b.requestKey,fingerprint,i.userId,b.reason,before,projection(updated)]);
  return {data:updated};
 }));
}
