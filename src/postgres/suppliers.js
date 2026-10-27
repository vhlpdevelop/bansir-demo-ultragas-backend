import {z} from 'zod';
import {httpError} from './database.js';
const text=z.string().trim().max(200),address=z.object({street:text.default(''),number:text.default(''),complement:text.default(''),neighborhood:text.default(''),city:text.default(''),state:z.string().max(2).default(''),zipCode:z.string().max(12).default('')}).strict();
const input=z.object({name:text.min(2),tradeName:text.default(''),document:z.string().max(25).transform(v=>v.replace(/\D/g,'')).refine(v=>[11,14].includes(v.length),'Informe CPF ou CNPJ completo.'),stateRegistration:text.default(''),email:z.union([z.email(),z.literal('')]).default(''),phone:text.default(''),contactPerson:text.default(''),category:text.default('Outros'),address:address.default({}),bankDetails:z.object({bank:text.default(''),agency:text.default(''),account:text.default(''),pixKey:text.default(''),pixType:text.default('cnpj')}).strict().default({}),notes:z.string().max(3000).default(''),active:z.boolean().default(true)}).strict();
const view=r=>({...r.data,id:r.id,_id:r.id,active:r.active,createdAt:r.created_at});
export function mountSuppliers(app,{scoped}){
 app.get('/api/v1/suppliers',scoped('suppliers',true,async(c,req)=>{
  const q=z.string().max(200).default('').parse(req.query.search),category=z.string().max(200).default('').parse(req.query.category);
  return {data:(await c.query("SELECT * FROM bansir.suppliers WHERE ($1='' OR strpos(lower(concat(data->>'name',' ',data->>'tradeName',' ',data->>'document')),lower($1))>0) AND($2='' OR $2='all' OR data->>'category'=$2) ORDER BY created_at DESC LIMIT 1000",[q,category])).rows.map(view)};
 }));
 app.post('/api/v1/suppliers',scoped('suppliers',false,async(c,req)=>{const {active,...data}=input.parse(req.body),i=req.identity;return {status:201,data:view((await c.query('INSERT INTO bansir.suppliers(tenant_id,establishment_id,data,active) VALUES($1,$2,$3,$4) RETURNING *',[i.tenantId,i.establishmentId,data,active])).rows[0])};}));
 app.get('/api/v1/suppliers/:id',scoped('suppliers',true,async(c,req)=>{const row=(await c.query('SELECT * FROM bansir.suppliers WHERE id=$1',[z.uuid().parse(req.params.id)])).rows[0];if(!row)throw httpError(404,'Fornecedor não encontrado.','NOT_FOUND');return {data:view(row)};}));
 app.put('/api/v1/suppliers/:id',scoped('suppliers',false,async(c,req)=>{
  const id=z.uuid().parse(req.params.id),before=(await c.query('SELECT * FROM bansir.suppliers WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!before)throw httpError(404,'Fornecedor não encontrado.','NOT_FOUND');
  const patch=input.partial().parse(req.body),{active,...data}=input.parse({...before.data,active:before.active,...patch});return {data:view((await c.query('UPDATE bansir.suppliers SET data=$2,active=$3,updated_at=now() WHERE id=$1 RETURNING *',[id,data,active])).rows[0])};
 }));
 app.delete('/api/v1/suppliers/:id',scoped('suppliers',false,async(c,req)=>{const result=await c.query('UPDATE bansir.suppliers SET active=false,updated_at=now() WHERE id=$1 RETURNING id',[z.uuid().parse(req.params.id)]);if(!result.rowCount)throw httpError(404,'Fornecedor não encontrado.','NOT_FOUND');return {data:true};}));
}
