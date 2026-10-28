import {z} from 'zod';
export async function dashboard(c,query,member){
 const zone=z.string().max(100).parse(query.timezone||'America/Sao_Paulo');
 try{new Intl.DateTimeFormat('pt-BR',{timeZone:zone});}catch{throw Object.assign(Error('Fuso horário inválido.'),{status:400});}
 const sales=(await c.query(`WITH valid AS (SELECT s.* FROM bansir.sales s WHERE NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE x.sale_id=s.id))
 SELECT count(*) FILTER(WHERE created_at>=now()-interval '30 days')::int AS sales,
 coalesce(sum(total_cents) FILTER(WHERE created_at>=now()-interval '30 days'),0)::text AS revenue,
 coalesce(sum(total_cents) FILTER(WHERE created_at>=now()-interval '60 days' AND created_at<now()-interval '30 days'),0)::text AS previous,
 count(*) FILTER(WHERE (created_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date)::int AS today_count,
 coalesce(sum(total_cents) FILTER(WHERE (created_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date),0)::text AS today_revenue,
 coalesce(sum(greatest(total_cents-(SELECT coalesce(sum(p.amount_cents),0) FROM bansir.sale_payments p WHERE p.sale_id=valid.id),0)),0)::text AS outstanding FROM valid`,[zone])).rows[0];
 const stock=(await c.query('SELECT count(*)::int AS products,count(*) FILTER(WHERE stock<=5)::int AS low,count(*) FILTER(WHERE stock=0)::int AS empty FROM bansir.products WHERE active')).rows[0];
 const latest=(await c.query(`SELECT s.id,s.customer_name,s.total_cents,s.created_at,EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE x.sale_id=s.id) AS cancelled FROM bansir.sales s ORDER BY created_at DESC LIMIT 8`)).rows;
 const lowStock=(await c.query('SELECT id,name,stock FROM bansir.products WHERE active AND stock<=5 ORDER BY stock,name LIMIT 8')).rows;
 const topProducts=(await c.query(`SELECT i.product_name AS name,sum(i.quantity)::int AS units FROM bansir.sale_items i JOIN bansir.sales s ON s.id=i.sale_id WHERE s.created_at>=now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE x.sale_id=s.id) GROUP BY i.product_name ORDER BY units DESC,name LIMIT 5`)).rows;
 const daily=(await c.query(`WITH days AS (SELECT (now() AT TIME ZONE $1)::date-n AS day FROM generate_series(6,0,-1) n)
 SELECT to_char(d.day,'YYYY-MM-DD') AS day,coalesce(sum(s.total_cents),0)::text AS cents,count(s.id)::int AS count FROM days d LEFT JOIN bansir.sales s ON (s.created_at AT TIME ZONE $1)::date=d.day AND NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE x.sale_id=s.id) GROUP BY d.day ORDER BY d.day`,[zone])).rows.map(r=>({day:r.day,revenue:Number(r.cents)/100,count:r.count}));
 const vouchers=(await c.query(`SELECT count(*) FILTER(WHERE v.status='ACTIVE' AND v.sale_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE x.sale_id=v.sale_id) AND s.total_cents=(SELECT coalesce(sum(p.amount_cents),0) FROM bansir.sale_payments p WHERE p.sale_id=v.sale_id))::int AS active,count(*) FILTER(WHERE v.status='REDEEMED' AND (v.redeemed_at AT TIME ZONE $1)::date=(now() AT TIME ZONE $1)::date)::int AS redeemed_today FROM bansir.vouchers v LEFT JOIN bansir.sales s ON s.id=v.sale_id`,[zone])).rows[0];
 const revenue=Number(sales.revenue)/100,previous=Number(sales.previous)/100;
 return {sales:sales.sales,revenue,previousRevenue:previous,variation:previous>0?Math.round((revenue-previous)/previous*1000)/10:null,ticket:sales.sales?revenue/sales.sales:0,today:{sales:sales.today_count,revenue:Number(sales.today_revenue)/100},outstanding:Number(sales.outstanding)/100,...stock,latest:latest.map(r=>({...r,total:Number(r.total_cents)/100})),lowStock,topProducts,daily,vouchers,timezone:zone,updatedAt:new Date().toISOString()};
}
