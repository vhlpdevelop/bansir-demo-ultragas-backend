import {z} from 'zod';
import {httpError} from './database.js';
import {fiscalDraftHash} from './fiscal.js';
import {updateProduct} from './catalog.js';
import {compute,validate} from './pricing-engine.js';
const admin=m=>['admin','superadmin'].includes(m.role);
const deny=()=>{throw httpError(403,'Seu perfil não permite esta operação.','FORBIDDEN');};
const manage=m=>{if(!admin(m))deny();};
const access=(m,part)=>{if(!admin(m)&&!m.allowed_routes?.some(r=>r==='financial'||r===part))deny();};
const money=z.number().finite().min(0).max(10000000).refine(v=>Math.abs(v*100-Math.round(v*100))<0.00001,'Informe duas casas decimais.');
const text=z.string().trim().max(200),uuid=z.uuid();
const employeeInput=z.object({name:text.min(2),email:z.email().max(200),phone:text.default(''),pixKey:text.default(''),roleTitle:text.min(1),laborType:z.enum(['MOD','MOI']),baseSalary:money,commissionType:z.enum(['percentage','fixed']),commissionValue:money,userId:uuid.nullable().optional(),active:z.boolean().optional()}).strict().refine(d=>d.commissionType!=='percentage'||d.commissionValue<=100,'Comissão percentual não pode superar 100%.');
const entryInput=z.object({requestKey:uuid,title:text.min(2),type:z.enum(['income','expense']),category:text.min(1),amount:money.refine(n=>n>0),paymentMethod:z.enum(['pix','cartao_credito','cartao_debito','dinheiro','transferencia','boleto','vale','outro']),notes:z.string().max(2000).default(''),brandName:text.optional(),sellerName:text.optional(),status:z.enum(['pending','completed']).default('pending'),date:z.iso.datetime({offset:true}).optional(),dueDate:z.iso.date().optional()}).strict();
const viewEntry=r=>({...r,_id:r.id,amount:Number(r.amount_cents)/100,paymentMethod:r.payment_method,sellerName:r.seller_name,dueDate:r.due_date,settledAt:r.settled_at,source:'manual'});
export async function employees(c){
 const rows=(await c.query(`SELECT e.*,coalesce(x.count,0) AS count,coalesce(x.total,0) AS total,coalesce(x.commission,0) AS commission FROM bansir.employees e LEFT JOIN LATERAL(
 SELECT count(*) AS count,sum(s.total_cents) AS total,sum(sc.amount_cents) AS commission FROM bansir.sale_commissions sc JOIN bansir.sales s ON s.id=sc.sale_id
 WHERE sc.employee_id=e.id AND NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE x.sale_id=s.id)
 AND s.total_cents=(SELECT coalesce(sum(p.amount_cents),0) FROM bansir.sale_payments p WHERE p.sale_id=s.id))x ON true ORDER BY e.name`)).rows;
 return rows.map(e=>({_id:e.id,id:e.id,name:e.name,email:e.email,phone:e.phone,pixKey:e.pix_key,roleTitle:e.role_title,laborType:e.labor_type,baseSalary:Number(e.salary_cents)/100,commissionType:e.commission_type,commissionValue:Number(e.commission_value),userId:e.user_id,active:e.active,hiredAt:e.hired_at,totalSalesCount:Number(e.count),totalSalesAmount:Number(e.total)/100,totalCommissionsEarned:Number(e.commission)/100,gamificationPoints:Number(e.count)*10,badges:[],gamificationLevel:'Equipe Bansir'}));
}
export async function financeEntries(c){
 const manual=(await c.query('SELECT * FROM bansir.financial_entries ORDER BY date DESC')).rows.map(viewEntry);
 const payments=(await c.query(`SELECT p.*,s.seller_name FROM bansir.sale_payments p JOIN bansir.sales s ON s.id=p.sale_id`)).rows;
 const cancellations=(await c.query('SELECT * FROM bansir.sale_cancellations')).rows;
 const entries=payments.flatMap(p=>{const row={_id:'payment:'+p.id,title:'Recebimento venda '+p.sale_id.slice(0,8),type:'income',category:'vendas',amount:Number(p.amount_cents)/100,paymentMethod:p.method,date:p.created_at,status:'completed',sellerName:p.seller_name,source:'pdv',saleId:p.sale_id};const cancel=cancellations.find(x=>x.sale_id===p.sale_id);return cancel?[row,{...row,_id:'refund:'+p.id,title:'Estorno '+p.sale_id.slice(0,8),type:'expense',category:'estorno',date:cancel.created_at}]:[row];});
 const pending=(await c.query(`SELECT s.*,s.total_cents-coalesce((SELECT sum(p.amount_cents) FROM bansir.sale_payments p WHERE p.sale_id=s.id),0) AS outstanding FROM bansir.sales s WHERE NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE x.sale_id=s.id)`)).rows.filter(s=>Number(s.outstanding)>0).map(s=>({_id:'sale:'+s.id,title:'Saldo venda '+s.id.slice(0,8),type:'income',category:'vendas',amount:Number(s.outstanding)/100,date:s.created_at,dueDate:s.due_date,status:'pending',sellerName:s.seller_name,source:'pdv',saleId:s.id}));
 return [...manual,...entries,...pending].sort((a,b)=>new Date(b.date)-new Date(a.date));
}
export async function createEntry(c,i,body){
 const d=entryInput.parse(body),hash=fiscalDraftHash(d);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`finance:${i.tenantId}:${i.establishmentId}:${d.requestKey}`]);
 const old=(await c.query('SELECT * FROM bansir.financial_entries WHERE request_key=$1',[d.requestKey])).rows[0];if(old){if(old.request_hash!==hash)throw httpError(409,'Tentativa já usada com outros dados.','IDEMPOTENCY_CONFLICT');return viewEntry(old);}
 const r=(await c.query(`INSERT INTO bansir.financial_entries(tenant_id,establishment_id,request_key,request_hash,title,type,category,amount_cents,status,payment_method,notes,seller_name,date,due_date,settled_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,coalesce($13::timestamptz,now()),$14,CASE WHEN $9='completed' THEN now() ELSE NULL END,$15) RETURNING *`,[i.tenantId,i.establishmentId,d.requestKey,hash,d.title,d.type,d.category,Math.round(d.amount*100),d.status,d.paymentMethod,d.notes,d.sellerName||d.brandName||'',d.date||null,d.dueDate||null,i.userId])).rows[0];return viewEntry(r);
}
const defaults={businessHours:{daysPerWeek:6,openingTime:'08:00',closingTime:'18:00',dailyStoreHours:10,dailyHoursPerPerson:8,workedDaysPerMonth:26,efficiencyFactor:.85,customNp:null},fixedExpenses:[],variableExpenses:[],pricingRules:{taxRate:0,desiredProfitMargin:15,expectedMonthlyRevenue:50000,commissionMode:'auto',manualCommissionRate:0,creditCardTermRate:0}};
async function pricingEmployees(c){return (await employees(c)).map(({name,laborType,baseSalary,commissionType,commissionValue,active})=>({name,laborType,baseSalary,commissionType,commissionValue,active}));}
async function settings(c){return (await c.query('SELECT data FROM bansir.pricing_settings')).rows[0]?.data||structuredClone(defaults);}
export function mountManagement(app,{scoped}){
 app.get('/api/v1/employees/users',scoped('employees',true,async(c,_r,m)=>{manage(m);return {data:(await c.query('SELECT u.id,u.name FROM bansir.users u JOIN bansir.establishment_memberships e ON e.user_id=u.id WHERE e.active AND u.active ORDER BY u.name')).rows};}));
 app.get('/api/v1/employees',scoped('employees',true,async(c,_r,m)=>{manage(m);return {data:await employees(c)};}));
 app.get('/api/v1/employees/vouchers',scoped('employees',true,async(c,_r,m)=>{manage(m);return {data:(await c.query(`SELECT a.*,e.name AS employee_name,v.name AS vehicle_name,u.name AS issued_by_name FROM bansir.employee_advances a JOIN bansir.employees e ON e.id=a.employee_id LEFT JOIN bansir.vehicles v ON v.id=a.vehicle_id JOIN bansir.users u ON u.id=a.issued_by ORDER BY a.date DESC`)).rows.map(a=>({...a,_id:a.id,amount:Number(a.amount_cents)/100,employee:{_id:a.employee_id,name:a.employee_name},vehicle:a.vehicle_id?{_id:a.vehicle_id,name:a.vehicle_name}:null,vehicleKm:a.vehicle_km,issuedByName:a.issued_by_name}))};}));
 app.get('/api/v1/employees/:id',scoped('employees',true,async(c,req,m)=>{manage(m);const employee=(await employees(c)).find(e=>e.id===uuid.parse(req.params.id));if(!employee)throw httpError(404,'Funcionário não encontrado.','NOT_FOUND');return {data:employee};}));
 app.post('/api/v1/employees/vouchers/:id/discount',scoped('employees',false,async(c,req,m)=>{manage(m);const {reference}=z.object({reference:text.min(3)}).strict().parse(req.body),id=uuid.parse(req.params.id),old=(await c.query('SELECT * FROM bansir.employee_advances WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw httpError(404,'Adiantamento não encontrado.','NOT_FOUND');if(old.status==='DESCONTADO'){if(old.payroll_reference!==reference)throw httpError(409,'Desconto já registrado em outra referência.','ALREADY_DISCOUNTED');return {data:old};}if(old.status!=='EMITIDO')throw httpError(409,'Adiantamento indisponível para desconto.','INVALID_ADVANCE_STATUS');return {data:(await c.query("UPDATE bansir.employee_advances SET status='DESCONTADO',payroll_reference=$2,discounted_by=$3,discounted_at=now() WHERE id=$1 RETURNING *",[id,reference,req.identity.userId])).rows[0]};}));
 app.post('/api/v1/employees/vouchers',scoped('employees',false,async(c,req,m)=>{
  manage(m);const d=z.object({requestKey:uuid,employeeId:uuid,amount:money.refine(n=>n>0),justification:text.min(3),notes:z.string().max(2000).default(''),vehicleId:uuid.optional(),vehicleKm:z.number().int().min(0).max(10000000).optional()}).strict().parse(req.body),i=req.identity,hash=fiscalDraftHash(d);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`advance:${i.tenantId}:${i.establishmentId}:${d.requestKey}`]);
  const old=(await c.query('SELECT * FROM bansir.employee_advances WHERE request_key=$1',[d.requestKey])).rows[0];if(old){if(old.request_hash!==hash)throw httpError(409,'Tentativa já utilizada.','IDEMPOTENCY_CONFLICT');return {data:old};}
  const e=(await c.query('SELECT * FROM bansir.employees WHERE id=$1 AND active FOR UPDATE',[d.employeeId])).rows[0];if(!e)throw httpError(404,'Funcionário não encontrado.','NOT_FOUND');
  if(d.vehicleId){const v=(await c.query('SELECT * FROM bansir.vehicles WHERE id=$1 FOR UPDATE',[d.vehicleId])).rows[0];if(!v)throw httpError(404,'Veículo não encontrado.','NOT_FOUND');if(d.vehicleKm===undefined||d.vehicleKm<Number(v.current_km))throw httpError(400,'Informe quilometragem igual ou superior à atual.','INVALID_KM');await c.query('UPDATE bansir.vehicles SET current_km=$2,last_km_update=now() WHERE id=$1',[v.id,d.vehicleKm]);}
  const entry=await createEntry(c,i,{requestKey:d.requestKey,title:'Vale funcionário: '+e.name,type:'expense',category:'adiantamento',amount:d.amount,status:'completed',paymentMethod:'outro',notes:d.justification});
  const row=(await c.query('INSERT INTO bansir.employee_advances(tenant_id,establishment_id,request_key,request_hash,employee_id,entry_id,amount_cents,justification,notes,vehicle_id,vehicle_km,issued_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',[i.tenantId,i.establishmentId,d.requestKey,hash,e.id,entry.id,Math.round(d.amount*100),d.justification,d.notes,d.vehicleId||null,d.vehicleKm??null,i.userId])).rows[0];return {status:201,data:row};
 }));
 for(const method of ['post','put'])app[method]('/api/v1/employees'+(method==='put'?'/:id':''),scoped('employees',false,async(c,req,m)=>{
  manage(m);const d=employeeInput.parse(req.body),i=req.identity;let id=method==='put'?uuid.parse(req.params.id):null;
  if(id&&!(await c.query('SELECT id FROM bansir.employees WHERE id=$1 FOR UPDATE',[id])).rowCount)throw httpError(404,'Funcionário não encontrado.','NOT_FOUND');
  if(d.userId&&!(await c.query('SELECT 1 FROM bansir.establishment_memberships WHERE user_id=$1 AND active',[d.userId])).rowCount)throw httpError(400,'Usuário não pertence a este estabelecimento.','INVALID_USER');
  const args=[d.name,d.email.toLowerCase(),d.phone,d.pixKey,d.roleTitle,d.laborType,Math.round(d.baseSalary*100),d.commissionType,d.commissionValue,d.userId||null,d.active??true];
  if(id)await c.query('UPDATE bansir.employees SET name=$1,email=$2,phone=$3,pix_key=$4,role_title=$5,labor_type=$6,salary_cents=$7,commission_type=$8,commission_value=$9,user_id=$10,active=$11 WHERE id=$12',[...args,id]);
  else id=(await c.query('INSERT INTO bansir.employees(name,email,phone,pix_key,role_title,labor_type,salary_cents,commission_type,commission_value,user_id,active,tenant_id,establishment_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',[...args,i.tenantId,i.establishmentId])).rows[0].id;
  return {status:method==='post'?201:200,data:(await employees(c)).find(e=>e.id===id)};
 }));
 app.delete('/api/v1/employees/:id',scoped('employees',false,async(c,req,m)=>{manage(m);if(!(await c.query('UPDATE bansir.employees SET active=false WHERE id=$1 RETURNING id',[uuid.parse(req.params.id)])).rowCount)throw httpError(404,'Funcionário não encontrado.','NOT_FOUND');return {data:true};}));
 app.get('/api/v1/financial/transactions',scoped('financial',true,async(c,req,m)=>{const type=z.enum(['income','expense']).optional().parse(req.query.type);access(m,type==='expense'?'financial-payables':type==='income'?'financial-receivables':'financial-overview');return {data:(await financeEntries(c)).filter(e=>!type||e.type===type)};}));
 app.post('/api/v1/financial/transactions',scoped('financial',false,async(c,req,m)=>{manage(m);return {status:201,data:await createEntry(c,req.identity,req.body)};}));
 app.patch('/api/v1/financial/transactions/:id/status',scoped('financial',false,async(c,req,m)=>{
  manage(m);const {status}=z.object({status:z.enum(['completed','cancelled'])}).strict().parse(req.body),id=uuid.parse(req.params.id);
  const old=(await c.query('SELECT * FROM bansir.financial_entries WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!old)throw httpError(404,'Lançamento não encontrado. Recebimentos do PDV devem ser tratados no PDV.','NOT_FOUND');
  if((await c.query('SELECT 1 FROM bansir.employee_advances WHERE entry_id=$1',[id])).rowCount)throw httpError(409,'Adiantamento exige conciliação de folha; não altere seu lançamento isoladamente.','ADVANCE_RECONCILIATION_REQUIRED');
  if(old.status==='cancelled'&&status!=='cancelled')throw httpError(409,'Lançamento cancelado não pode ser reaberto.','ENTRY_CANCELLED');
  return {data:viewEntry((await c.query("UPDATE bansir.financial_entries SET status=$2,settled_at=CASE WHEN $2='completed' THEN coalesce(settled_at,now()) ELSE settled_at END WHERE id=$1 RETURNING *",[id,status])).rows[0])};
 }));
 app.get('/api/v1/financial/summary',scoped('financial',true,async(c,_r,m)=>{access(m,'financial-overview');const list=await financeEntries(c),sum=(type,status)=>list.filter(e=>e.type===type&&e.status===status).reduce((n,e)=>n+Math.round(e.amount*100),0)/100;const income=sum('income','completed'),expense=sum('expense','completed');return {data:{kpis:{totalRevenue:income,totalExpenses:expense,netIncome:income-expense,receivable:sum('income','pending'),payable:sum('expense','pending'),totalTransactions:list.length},recentTransactions:list.slice(0,8)}};}));
 app.get('/api/v1/financial/pricing-intelligence',scoped('financial',true,async(c,_r,m)=>{access(m,'financial-intelligence');return {data:compute(await settings(c),await pricingEmployees(c))};}));
 app.put('/api/v1/financial/pricing-intelligence',scoped('financial',false,async(c,req,m)=>{
  manage(m);const current=await settings(c),p=req.body;const next={businessHours:{...current.businessHours,...p.businessHours},pricingRules:{...current.pricingRules,...p.pricingRules},fixedExpenses:p.fixedExpenses??current.fixedExpenses,variableExpenses:p.variableExpenses??current.variableExpenses};
  try{validate(next);}catch(e){throw httpError(400,e.message,'INVALID_PRICING');}const result=compute(next,await pricingEmployees(c));if(!result.indicators.valid)throw httpError(400,result.indicators.errors.join(' '),'INVALID_PRICING');
  await c.query('INSERT INTO bansir.pricing_settings VALUES($1,$2,$3) ON CONFLICT(tenant_id,establishment_id) DO UPDATE SET data=EXCLUDED.data',[req.identity.tenantId,req.identity.establishmentId,next]);return {data:result};
 }));
 app.post('/api/v1/financial/pricing-intelligence/apply-price',scoped('financial',false,async(c,req,m)=>{manage(m);const d=z.object({productId:uuid,newPrice:money.refine(n=>n>0)}).strict().parse(req.body);const result=compute(await settings(c),await pricingEmployees(c));if(!result.indicators.valid)throw httpError(409,'Corrija os parâmetros de preços.','INVALID_PRICING');return {data:await updateProduct(c,req.identity,d.productId,{price:d.newPrice})};}));
}
