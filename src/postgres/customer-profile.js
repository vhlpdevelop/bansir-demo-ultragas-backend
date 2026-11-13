import {z} from 'zod';
import {httpError} from './database.js';
import {customerStatementPdf} from './customer-statement-pdf.js';

export async function customerSalesList(c, customerId, { limit = 50, offset = 0 } = {}) {
 const result = await c.query(`
  SELECT 
   s.id,
   s.coupon_number,
   coalesce('#' || s.coupon_number::text, '#' || upper(substring(s.id::text, 1, 8))) AS "saleNumber",
   s.created_at,
   s.seller_name,
   s.customer_name,
   s.customer_phone,
   s.delivery_mode,
   s.delivery_address,
   s.delivery_employee_name,
   s.delivery_employee_phone,
   s.due_date,
   s.subtotal_cents,
   s.discount_cents,
   s.delivery_fee_cents,
   s.total_cents,
   x.created_at AS cancelled_at,
   x.reason AS cancellation_reason,
   coalesce(p_agg.paid_cents, 0) AS paid_cents,
   greatest(0, s.total_cents - coalesce(p_agg.paid_cents, 0)) AS outstanding_cents,
   CASE 
    WHEN x.sale_id IS NOT NULL THEN 'cancelled'
    WHEN coalesce(p_agg.paid_cents, 0) >= s.total_cents THEN 'paid'
    ELSE 'pending'
   END AS status,
   coalesce(items_agg.items, '[]'::jsonb) AS items,
   coalesce(p_agg.payments, '[]'::jsonb) AS payments
  FROM bansir.sales s
  LEFT JOIN bansir.sale_cancellations x ON (x.tenant_id, x.establishment_id, x.sale_id) = (s.tenant_id, s.establishment_id, s.id)
  LEFT JOIN LATERAL (
   SELECT 
    sum(p.amount_cents) AS paid_cents,
    jsonb_agg(jsonb_build_object(
     'id', p.id,
     'method', p.method,
     'amount_cents', p.amount_cents,
     'received_cents', p.received_cents,
     'reference', p.reference,
     'installments', p.installments,
     'created_at', p.created_at
    ) ORDER BY p.created_at) AS payments
   FROM bansir.active_sale_payments p
   WHERE (p.tenant_id, p.establishment_id, p.sale_id) = (s.tenant_id, s.establishment_id, s.id)
  ) p_agg ON true
  LEFT JOIN LATERAL (
   SELECT jsonb_agg(jsonb_build_object(
    'product_id', i.product_id,
    'product_name', i.product_name,
    'quantity', i.quantity,
    'unit_price_cents', i.unit_price_cents,
    'gross_cents', i.gross_cents,
    'discount_cents', i.discount_cents,
    'unit', i.unit
   ) ORDER BY i.position) AS items
   FROM bansir.sale_items i
   WHERE (i.tenant_id, i.establishment_id, i.sale_id) = (s.tenant_id, s.establishment_id, s.id)
  ) items_agg ON true
  WHERE s.customer_id = $1
  ORDER BY s.created_at DESC, s.id
  LIMIT $2 OFFSET $3
 `, [customerId, limit, offset]);

 return result.rows.map(s => ({
  ...s,
  subtotal_cents: Number(s.subtotal_cents),
  discount_cents: Number(s.discount_cents),
  delivery_fee_cents: Number(s.delivery_fee_cents),
  total_cents: Number(s.total_cents),
  paid_cents: Number(s.paid_cents),
  outstanding_cents: Number(s.outstanding_cents),
  items: (s.items || []).map(i => ({
   ...i,
   unit_price_cents: Number(i.unit_price_cents),
   gross_cents: Number(i.gross_cents),
   discount_cents: Number(i.discount_cents)
  })),
  payments: (s.payments || []).map(p => ({
   ...p,
   amount_cents: Number(p.amount_cents),
   received_cents: Number(p.received_cents)
  }))
 }));
}

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
   LEFT JOIN LATERAL(SELECT coalesce(sum(amount_cents),0) AS paid FROM bansir.active_sale_payments WHERE sale_id=s.id) p ON true WHERE s.customer_id=$1`,[id])).rows[0];
  for(const k of ['total_cents','paid_cents','outstanding_cents'])summary[k]=Number(summary[k]);

  // Fast single-pass query with index, replacing the N+1 loop
  const sales=await customerSalesList(c,id,{limit:size,offset:q.salePage*size});

  const where='customer_id=$1 OR sale_id IN(SELECT id FROM bansir.sales WHERE customer_id=$1)';
  const orders=(await c.query(`SELECT id,status,customer_name,phone,delivery_address,fulfillment,zone_id,items,subtotal_cents,shipping_cents,total_cents,sale_id,created_at,rejection_reason FROM bansir.storefront_orders WHERE ${where} ORDER BY created_at DESC,id LIMIT $2 OFFSET $3`,[id,size,q.orderPage*size])).rows;
  const orderCount=(await c.query(`SELECT count(*)::int AS total FROM bansir.storefront_orders WHERE ${where}`,[id])).rows[0].total;
  return {data:{customer,summary,sales,orders:orders.map(r=>({...r,total_cents:Number(r.total_cents),shipping_cents:Number(r.shipping_cents)})),salePage:q.salePage,orderPage:q.orderPage,pageSize:size,orderCount}};
 }));

 app.get('/api/v1/customers/:id/statement-pdf',scoped('settings',true,async(c,req)=>{
  const id=z.uuid().parse(req.params.id);
  const customer=(await c.query('SELECT id,name,document,phone,address,active,source_code,import_metadata,email,birth_date,notes,created_at FROM bansir.customers WHERE id=$1',[id])).rows[0];
  if(!customer)throw httpError(404,'Cliente não encontrado neste estabelecimento.','NOT_FOUND');

  const summary=(await c.query(`SELECT count(*)::int AS sales_count,count(*) FILTER(WHERE x.sale_id IS NOT NULL)::int AS cancelled_count,
   coalesce(sum(s.total_cents) FILTER(WHERE x.sale_id IS NULL),0) AS total_cents,
   coalesce(sum(p.paid) FILTER(WHERE x.sale_id IS NULL),0) AS paid_cents,
   coalesce(sum(s.total_cents-p.paid) FILTER(WHERE x.sale_id IS NULL),0) AS outstanding_cents,max(s.created_at) AS last_sale_at
   FROM bansir.sales s LEFT JOIN bansir.sale_cancellations x ON x.sale_id=s.id
   LEFT JOIN LATERAL(SELECT coalesce(sum(amount_cents),0) AS paid FROM bansir.active_sale_payments WHERE sale_id=s.id) p ON true WHERE s.customer_id=$1`,[id])).rows[0];
  for(const k of ['total_cents','paid_cents','outstanding_cents'])summary[k]=Number(summary[k]);

  // Load complete customer purchases history (up to 1,000 sales)
  const sales=await customerSalesList(c,id,{limit:1000,offset:0});

  const store=(await c.query(`
   SELECT coalesce(s.store_name, e.name) AS store_name, coalesce(s.document_id, e.document_id) AS document_id, s.address, s.merchant_city
   FROM bansir.establishments e
   LEFT JOIN bansir.store_settings s ON s.tenant_id = e.tenant_id
   LIMIT 1
  `)).rows[0]||{};

  const timeZone=(await c.query("SELECT coalesce(config->>'timeZone','America/Cuiaba') AS tz FROM bansir.storefronts LIMIT 1")).rows[0]?.tz||'America/Cuiaba';

  const pdfBuffer=await customerStatementPdf({customer,summary,sales},{store,timeZone});
  const safeName=(customer.name||'cliente').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'-').slice(0,30);
  const today=new Date().toISOString().slice(0,10);

  return {data:{base64:pdfBuffer.toString('base64'),filename:`extrato-${safeName}-${today}.pdf`}};
 }));
}
