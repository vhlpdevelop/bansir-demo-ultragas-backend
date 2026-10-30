import {dashboard,terminalCashSnapshot} from './dashboard.js';
import {z} from 'zod';
import bcrypt from 'bcryptjs';
export function mountAccess(app,{scoped}){
 app.get('/api/v1/dashboard/terminal-cash',scoped('dashboard',true,async c=>({data:await terminalCashSnapshot(c)})));
 app.get('/api/v1/dashboard',scoped('dashboard',true,async(c,req,m)=>({data:await dashboard(c,req.query,m)})));
 app.get('/api/v1/access/users',scoped('rbac',true,async c=>({data:(await c.query('SELECT * FROM bansir.rbac_members()')).rows})));
 const save=scoped('rbac',false,async(c,req)=>{
  const d=z.object({name:z.string().trim().min(1).max(200),email:z.email().toLowerCase(),password:z.string().min(8).max(72).optional(),role:z.enum(['admin','gerente_artesao','operador','entregador']),allowedRoutes:z.array(z.enum(['dashboard','deliveries-manage','my-deliveries','delivery-monitor','sales','sales-manage','sales-collect','sales-discount','products','suppliers','financial','financial-overview','financial-payables','financial-receivables','financial-intelligence','reports','employees','customers','valegas-issue','valegas-redeem','fleet','settings'])).max(30),active:z.boolean()}).strict().parse(req.body);
  const id=req.params.id?z.uuid().parse(req.params.id):null;
  if(!id&&!d.password)throw Object.assign(Error('Informe uma senha temporária com pelo menos 8 caracteres.'),{status:400});
  try{return {data:{id:(await c.query('SELECT bansir.rbac_save($1,$2,$3,$4,$5,$6,$7) AS id',[id,d.email,d.name,id?null:await bcrypt.hash(d.password,12),d.role,d.allowedRoutes,d.active])).rows[0].id}};}catch(e){if(e.code==='42501')throw Object.assign(Error('Este acesso está protegido ou não pertence ao estabelecimento selecionado.'),{status:403});if(e.code==='23505')throw Object.assign(Error('Este e-mail já possui uma conta. Solicite o vínculo à administração do SaaS.'),{status:409});throw e;}
 });app.post('/api/v1/access/users',save);app.put('/api/v1/access/users/:id',save);
}
