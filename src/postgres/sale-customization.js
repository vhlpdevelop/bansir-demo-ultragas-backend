import {z} from 'zod';
import {requirePermission} from './catalog.js';
import {httpError} from './database.js';
const profile=z.object({cfop:z.string().regex(/^5\d{3}$/),ncm:z.string().regex(/^(\d{8})?$/).optional(),cest:z.string().regex(/^(\d{7})?$/).default(''),taxes:z.object({ICMS:z.record(z.string(),z.unknown()),PIS:z.record(z.string(),z.unknown()),COFINS:z.record(z.string(),z.unknown())}).strict()}).strict();
export const productFiscalInput=z.object({'55':profile.optional(),'65':profile.optional()}).strict().refine(d=>JSON.stringify(d).length<=12000,'Configuração fiscal muito grande.');
export function mountSaleCustomization(app,{scoped}){
 app.get('/api/v1/sales/numbering/config',scoped('settings-store',true,async c=>({data:{nextNumber:Number((await c.query('SELECT last_number FROM bansir.sale_counters')).rows[0]?.last_number??0)+1}})));
 app.put('/api/v1/sales/numbering/config',scoped('settings-store',false,async(c,req)=>{
  const {nextNumber}=z.object({nextNumber:z.number().int().min(1).max(999999999)}).strict().parse(req.body),i=req.identity;
  await c.query('INSERT INTO bansir.sale_counters(tenant_id,establishment_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[i.tenantId,i.establishmentId]);
  await c.query('SELECT last_number FROM bansir.sale_counters FOR UPDATE');
  const last=Number((await c.query('SELECT max(coupon_number) AS last FROM bansir.sales')).rows[0].last||0);
  if(nextNumber<=last)throw httpError(409,'O próximo cupom deve superar todos os números já utilizados.','COUPON_ALREADY_USED');
  await c.query('UPDATE bansir.sale_counters SET last_number=$1',[nextNumber-1]);return {data:{nextNumber}};
 }));
 app.get('/api/v1/products/:id/fiscal-profile',scoped('products',true,async(c,req,member)=>{
  requirePermission(member,'fiscal');const id=z.uuid().parse(req.params.id);
  if(!(await c.query('SELECT id FROM bansir.products WHERE id=$1',[id])).rowCount)throw httpError(404,'Produto não encontrado.','NOT_FOUND');
  return {data:(await c.query('SELECT data FROM bansir.product_fiscal_profiles WHERE product_id=$1',[id])).rows[0]?.data||{}};
 }));
 app.put('/api/v1/products/:id/fiscal-profile',scoped('products',false,async(c,req,member)=>{
  requirePermission(member,'fiscal');const id=z.uuid().parse(req.params.id),data=productFiscalInput.parse(req.body),i=req.identity;
  if(!(await c.query('SELECT id FROM bansir.products WHERE id=$1',[id])).rowCount)throw httpError(404,'Produto não encontrado.','NOT_FOUND');
  await c.query('INSERT INTO bansir.product_fiscal_profiles(tenant_id,establishment_id,product_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,establishment_id,product_id) DO UPDATE SET data=excluded.data',[i.tenantId,i.establishmentId,id,data]);return {data};
 }));
}
