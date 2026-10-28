import {z} from 'zod';
import bcrypt from 'bcryptjs';
export function mountAccess(app,{scoped}){
 app.get('/api/v1/dashboard',scoped('dashboard',true,async c=>{
 const metrics=(await c.query(`SELECT count(*)::int AS sales,coalesce(sum(total_cents),0)::text AS revenue FROM bansir.sales s WHERE created_at>=now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE x.sale_id=s.id)`)).rows[0];
 const stock=(await c.query('SELECT count(*)::int AS products,count(*) FILTER(WHERE stock<=5)::int AS low FROM bansir.products WHERE active')).rows[0];
 const latest=(await c.query('SELECT id,customer_name,total_cents,created_at FROM bansir.sales ORDER BY created_at DESC LIMIT 8')).rows;
 const low=(await c.query('SELECT id,name,stock FROM bansir.products WHERE active AND stock<=5 ORDER BY stock,name LIMIT 8')).rows;
 return {data:{sales:metrics.sales,revenue:Number(metrics.revenue)/100,...stock,latest:latest.map(r=>({...r,total:Number(r.total_cents)/100})),lowStock:low}};
 }));
 app.get('/api/v1/access/users',scoped('rbac',true,async c=>({data:(await c.query('SELECT * FROM bansir.rbac_members()')).rows})));
 const save=scoped('rbac',false,async(c,req)=>{
  const d=z.object({name:z.string().trim().min(1).max(200),email:z.email().toLowerCase(),password:z.string().min(8).max(72).optional(),role:z.enum(['admin','gerente_artesao','operador','entregador']),allowedRoutes:z.array(z.enum(['dashboard','sales','sales-manage','sales-collect','sales-discount','products','suppliers','financial','financial-overview','financial-payables','financial-receivables','financial-intelligence','reports','employees','customers','valegas-issue','valegas-redeem','fleet','settings'])).max(30),active:z.boolean()}).strict().parse(req.body);
  const id=req.params.id?z.uuid().parse(req.params.id):null;
  if(!id&&!d.password)throw Object.assign(Error('Informe uma senha temporária com pelo menos 8 caracteres.'),{status:400});
  try{return {data:{id:(await c.query('SELECT bansir.rbac_save($1,$2,$3,$4,$5,$6,$7) AS id',[id,d.email,d.name,id?null:await bcrypt.hash(d.password,12),d.role,d.allowedRoutes,d.active])).rows[0].id}};}catch(e){if(e.code==='42501')throw Object.assign(Error('Este acesso está protegido ou não pertence ao estabelecimento selecionado.'),{status:403});if(e.code==='23505')throw Object.assign(Error('Este e-mail já possui uma conta. Solicite o vínculo à administração do SaaS.'),{status:409});throw e;}
 });app.post('/api/v1/access/users',save);app.put('/api/v1/access/users/:id',save);
}
