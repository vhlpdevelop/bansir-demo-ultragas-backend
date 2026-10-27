import {z} from 'zod';
import {httpError} from './database.js';
import {saleView} from './sales.js';
export function mountCustomerProfile(app,{scoped}){
 app.get('/api/v1/customers/:id/profile',scoped('settings',true,async(c,req)=>{
  const id=z.uuid().parse(req.params.id),q=z.object({salePage:z.coerce.number().int().min(0).max(100000).default(0),orderPage:z.coerce.number().int().min(0).max(100000).default(0)}).parse(req.query),size=20;
  const customer=(await c.query('SELECT id,name,document,phone,address,active,source_code,import_metadata,email,birth_date,notes,created_at FROM bansir.customers WHERE id=$1',[id])).rows[0];
  if(!customer)throw httpError(404,'Cliente não encontrado neste estabelecimento.','NOT_FOUND');
  const summary=(await c.query(`SELECT count(*)::int AS sales_count,count(*) FILTER(WHERE x.sale_id IS NOT NULL)::int AS cancelled_count,
   coalesce(sum(s.total_cents) FILTER(WHERE x.sale_id IS NULL),0) AS total_cents,
   coalesce(sum(p.paid) FILTER(WHERE x.sale_id IS NULL),0) AS paid_cents,
   coalesce(sum(s.total_cents-p.paid) FILTER(WHERE x.sale_id IS NULL),0) AS outstanding_cents,max(s.created_at) AS last_sale_at
   FROM bansir.sales s LEFT JOIN bansir.sale_cancellations x ON x.sale_id=s.id
   LEFT JOIN LATERAL(SELECT coalesce(sum(amount_cents),0) AS paid FROM bansir.sale_payments WHERE sale_id=s.id) p ON true WHERE s.customer_id=$1`,[id])).rows[0];
  for(const k of ['total_cents','paid_cents','outstanding_cents'])summary[k]=Number(summary[k]);
  const ids=(await c.query('SELECT id FROM bansir.sales WHERE customer_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',[id,size,q.salePage*size])).rows;
  const sales=[];for(const row of ids)sales.push(await saleView(c,row.id));
  const where='customer_id=$1 OR sale_id IN(SELECT id FROM bansir.sales WHERE customer_id=$1)';
  const orders=(await c.query(`SELECT id,status,customer_name,phone,delivery_address,fulfillment,zone_id,items,subtotal_cents,shipping_cents,total_cents,sale_id,created_at,rejection_reason FROM bansir.storefront_orders WHERE ${where} ORDER BY created_at DESC,id LIMIT $2 OFFSET $3`,[id,size,q.orderPage*size])).rows;
  const orderCount=(await c.query(`SELECT count(*)::int AS total FROM bansir.storefront_orders WHERE ${where}`,[id])).rows[0].total;
  return {data:{customer,summary,sales,orders:orders.map(r=>({...r,total_cents:Number(r.total_cents),shipping_cents:Number(r.shipping_cents)})),salePage:q.salePage,orderPage:q.orderPage,pageSize:size,orderCount}};
 }));
}
