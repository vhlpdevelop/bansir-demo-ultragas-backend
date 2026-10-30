import {z} from 'zod';
import {createHash} from 'node:crypto';
import rateLimit from 'express-rate-limit';
import {httpError} from './database.js';
import {manageDeliveries,driveDeliveries,monitorDeliveries,viewDeliveryHistory} from './delivery-permissions.js';
const fail=(message,code='DELIVERY_CONFLICT',status=409)=>{throw httpError(status,message,code);};
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const uuid=z.uuid(),text=z.string().trim().max(1000);
export const deliveryLocation=z.object({latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),accuracy:z.number().finite().min(0).max(100000),capturedAt:z.iso.datetime({offset:true}),confirmed:z.literal(true)}).strict();
const accountSql='CASE WHEN d.employee_id IS NOT NULL THEN e.user_id ELSE d.user_id END';
async function ownDriver(c,i){
 const rows=(await c.query(`SELECT d.id,d.name FROM bansir.deliverers d LEFT JOIN bansir.employees e ON e.id=d.employee_id WHERE d.active AND ${accountSql}=$1`,[i.userId])).rows;
 if(rows.length>1)fail('Seu usuário está ligado a mais de um entregador. Peça a correção ao administrador.','DRIVER_ACCOUNT_AMBIGUOUS');
 return rows[0]||null;
}
function workView(w){if(!w)return null;const {collector_hash,point_hash,session_id,...rest}=w;return rest;}
export function positionState(d,now=Date.now()){
 if(!d.on_duty)return 'ended';if(!d.active)return 'paused';
 if(d.gps_state!=='ok')return d.gps_state||'waiting';
 if(!d.received_at||!d.captured_at)return 'waiting';
 const age=Math.max(now-new Date(d.received_at),now-new Date(d.captured_at));
 if(age>300000)return 'stale';if(age>90000)return 'outdated';if(d.accuracy>100)return 'imprecise';return 'recent';
}
async function drivers(c,positions){
 const rows=(await c.query(`SELECT d.id,d.name,d.phone,d.active AS driver_active,d.employee_id,${accountSql} AS user_id,u.name AS account_name,u.active AS account_active,
  w.on_duty,w.active,w.gps_state,w.latitude,w.longitude,w.accuracy,w.captured_at,w.received_at,w.started_at,
  (SELECT count(*)::int FROM bansir.delivery_tasks t WHERE t.driver_id=d.id AND t.status IN('assigned','en_route')) AS assigned,
  (SELECT count(*)::int FROM bansir.delivery_tasks t WHERE t.driver_id=d.id AND t.status='delivered') AS completed
  FROM bansir.deliverers d LEFT JOIN bansir.employees e ON e.id=d.employee_id LEFT JOIN bansir.delivery_accounts() u ON u.id=${accountSql}
  LEFT JOIN bansir.driver_work w ON w.driver_id=d.id AND w.user_id=${accountSql} ORDER BY d.name`)).rows;
 return rows.map(d=>{const {latitude,longitude,accuracy,captured_at,received_at,...rest}=d;if(!d.driver_active||!d.account_active){rest.active=false;rest.on_duty=false;}return {...rest,position:positions&&d.driver_active&&d.account_active&&latitude!==null&&latitude!==undefined?{latitude,longitude,accuracy,capturedAt:captured_at,receivedAt:received_at}:null,locationState:positions?(d.driver_active&&d.account_active?positionState(d):'ended'):'restricted'};});
}
async function deliveryZone(c){return (await c.query("SELECT coalesce((SELECT config->>'timeZone' FROM bansir.storefronts LIMIT 1),'America/Cuiaba') AS zone")).rows[0].zone;}
const historyDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Data inválida.');
async function tasks(c,{driverId,legacy=false,mode='all',zone='America/Cuiaba',from=null,to=null,status='delivered',offset=0,limit=200}={}){
 const filter=`($1::uuid IS NULL OR t.driver_id=$1) AND($2 OR t.status<>'unverified')
 AND($3='all' OR $3='active' AND t.status IN('assigned','en_route','failed')
 OR $3='today' AND t.status='delivered' AND (t.delivered_at AT TIME ZONE $4)::date=(now() AT TIME ZONE $4)::date
 OR $3='history' AND t.status IN('delivered','failed','cancelled') AND($7='all' OR t.status=$7)
 AND($5::date IS NULL OR(coalesce(t.delivered_at,t.updated_at) AT TIME ZONE $4)::date >= $5)
 AND($6::date IS NULL OR(coalesce(t.delivered_at,t.updated_at) AT TIME ZONE $4)::date <= $6))`;
 const params=[driverId||null,legacy,mode,zone,from,to,status];
 const rows=(await c.query(`SELECT t.*,s.customer_name,s.customer_phone,d.name AS driver_name,
 coalesce((SELECT jsonb_agg(jsonb_build_object('name',product_name,'quantity',quantity) ORDER BY position) FROM bansir.sale_items WHERE sale_id=t.sale_id),'[]') AS items
 FROM bansir.delivery_tasks t JOIN bansir.sales s ON s.id=t.sale_id LEFT JOIN bansir.deliverers d ON d.id=t.driver_id WHERE ${filter}
 ORDER BY CASE WHEN $3='all' AND t.status IN('pending','assigned','en_route','failed') THEN 0 ELSE 1 END,
 CASE WHEN $3 IN('today','history') THEN coalesce(t.delivered_at,t.updated_at) ELSE t.updated_at END DESC,t.sale_id DESC LIMIT $8 OFFSET $9`,[...params,limit,offset])).rows;
 if(mode!=='history')return rows;
 const total=Number((await c.query(`SELECT count(*) FROM bansir.delivery_tasks t WHERE ${filter}`,params)).rows[0].count);
 return {items:rows,total,page:offset/limit+1,pageSize:limit,hasMore:offset+rows.length<total,timeZone:zone};
}
export async function deliverySummary(c,m){
 const stats=(await c.query(`SELECT count(*) FILTER(WHERE status='pending')::int AS pending,count(*) FILTER(WHERE status='assigned')::int AS assigned,
  count(*) FILTER(WHERE status='en_route')::int AS en_route,count(*) FILTER(WHERE status='failed')::int AS failed,
  count(*) FILTER(WHERE status='delivered' AND delivered_at>=now()-interval '24 hours')::int AS delivered_last_24h,
  count(*) FILTER(WHERE status='unverified')::int AS unverified FROM bansir.delivery_tasks`)).rows[0];
 return {stats,canMonitor:!!monitorDeliveries(m),drivers:monitorDeliveries(m)?await drivers(c,true):[],updatedAt:new Date().toISOString()};
}
async function lockedTask(c,id){const row=(await c.query('SELECT * FROM bansir.delivery_tasks WHERE sale_id=$1 FOR UPDATE',[uuid.parse(id)])).rows[0];if(!row)fail('Entrega não encontrada.','NOT_FOUND',404);return row;}
async function prior(c,i,key,payload){
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`delivery:${i.tenantId}:${i.establishmentId}:${key}`]);
 const row=(await c.query('SELECT request_hash FROM bansir.delivery_events WHERE request_key=$1',[key])).rows[0];
 if(row&&row.request_hash!==hash({...payload,userId:i.userId}))fail('Esta tentativa já foi usada com outros dados.','IDEMPOTENCY_CONFLICT');return !!row;
}
const audit=(c,i,key,payload,saleId)=>c.query('INSERT INTO bansir.delivery_events(tenant_id,establishment_id,sale_id,user_id,request_key,request_hash,action,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[i.tenantId,i.establishmentId,saleId,i.userId,key,hash({...payload,userId:i.userId}),payload.action,payload.reason||'']);
export function mountDeliveries(app,{database,route}){
 const own=fn=>route(req=>database.transaction(req.identity,(c,m)=>fn(c,req,m)));
 const manager=fn=>own((c,r,m)=>{if(!manageDeliveries(m))fail('Sem permissão para gerenciar entregas.','FORBIDDEN',403);return fn(c,r,m);});
 const driver=(fn,history=false)=>own(async(c,r,m)=>{if(!(history?viewDeliveryHistory(m):driveDeliveries(m)))fail('Acesso exclusivo ao entregador.','FORBIDDEN',403);const d=await ownDriver(c,r.identity);if(!d)fail('Peça ao administrador para vincular seu usuário a um entregador ativo.','DRIVER_NOT_LINKED',404);return fn(c,r,m,d);});
 app.get('/api/v1/deliveries/snapshot',manager(async(c,r,m)=>({data:{tasks:await tasks(c,{legacy:r.query.legacy==='true'}),drivers:await drivers(c,!!monitorDeliveries(m)),canMonitor:!!monitorDeliveries(m),updatedAt:new Date().toISOString()}})));
 app.get('/api/v1/deliveries/summary',own(async(c,r,m)=>{if(!['admin','superadmin'].includes(m.role)&&!m.allowed_routes?.includes('dashboard'))fail('Sem acesso à dashboard.','FORBIDDEN',403);return {data:await deliverySummary(c,m)};}));
 app.get('/api/v1/deliveries/accounts',manager(async c=>({data:(await c.query('SELECT id,name,email FROM bansir.delivery_accounts() WHERE active ORDER BY name')).rows})));
 app.put('/api/v1/deliveries/drivers/:id/account',manager(async(c,r)=>{
  const {userId}=z.object({userId:uuid.nullable()}).strict().parse(r.body),id=uuid.parse(r.params.id);
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`driver-accounts:${r.identity.tenantId}:${r.identity.establishmentId}`]);
  const d=(await c.query('SELECT * FROM bansir.deliverers WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!d)fail('Entregador não encontrado.','NOT_FOUND',404);
  if(d.employee_id)fail('Altere o usuário deste entregador em Funcionários.','EMPLOYEE_MANAGED');
  if(userId){
   if(!(await c.query(`SELECT 1 FROM bansir.delivery_accounts() WHERE id=$1 AND active`,[userId])).rowCount)fail('Escolha um usuário entregador ativo da unidade.','INVALID_USER',400);
   if((await c.query(`SELECT 1 FROM bansir.deliverers d LEFT JOIN bansir.employees e ON e.id=d.employee_id WHERE d.id<>$1 AND ${accountSql}=$2`,[id,userId])).rowCount)fail('Usuário já vinculado a outro entregador.');
  }
  await c.query('UPDATE bansir.deliverers SET user_id=$2 WHERE id=$1',[id,userId]);
  await c.query("UPDATE bansir.driver_work SET active=false,on_duty=false,collector_hash=NULL,latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL,gps_state='stopped',ended_at=now() WHERE driver_id=$1",[id]);return {data:true};
 }));
 app.get('/api/v1/deliveries/mine',driver(async(c,r,m,d)=>{
  const zone=await deliveryZone(c),completedToday=await tasks(c,{driverId:d.id,mode:'today',zone,limit:10});
  const total=Number((await c.query("SELECT count(*) FROM bansir.delivery_tasks WHERE driver_id=$1 AND status='delivered' AND(delivered_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date",[d.id,zone])).rows[0].count);
  return {data:{driver:d,tasks:await tasks(c,{driverId:d.id,mode:'active'}),completedToday,completedTodayCount:total,timeZone:zone,work:workView((await c.query('SELECT * FROM bansir.driver_work WHERE driver_id=$1 AND user_id=$2',[d.id,r.identity.userId])).rows[0])}};
 }));
 app.get('/api/v1/deliveries/mine/history',driver(async(c,r,m,d)=>{
  const q=z.object({from:historyDate.optional(),to:historyDate.optional(),status:z.enum(['delivered','failed','cancelled','all']).default('delivered'),page:z.coerce.number().int().min(1).max(10000).default(1)}).strict().parse(r.query);
  if(q.from&&q.to&&q.from>q.to)fail('A data inicial deve ser anterior à final.','INVALID_RANGE',400);
  return {data:await tasks(c,{driverId:d.id,mode:'history',zone:await deliveryZone(c),from:q.from,to:q.to,status:q.status,offset:(q.page-1)*20,limit:20})};
 },true));
 app.post('/api/v1/deliveries/work/start',driver(async(c,r,m,d)=>{
  const body=z.object({collector:uuid,transfer:z.boolean().default(false)}).strict().parse(r.body),i=r.identity;
  await c.query('INSERT INTO bansir.driver_work(tenant_id,establishment_id,driver_id,user_id,session_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[i.tenantId,i.establishmentId,d.id,i.userId,i.sessionId]);
  const w=(await c.query('SELECT * FROM bansir.driver_work WHERE driver_id=$1 FOR UPDATE',[d.id])).rows[0];
  if(w.active&&w.user_id===i.userId&&(w.collector_hash!==hash(body.collector)||w.session_id!==i.sessionId)&&!body.transfer)fail('A localização está sendo enviada por outro aparelho. Confirme a transferência.','COLLECTOR_ACTIVE');
  if(w.active&&w.user_id===i.userId&&w.collector_hash===hash(body.collector)&&w.session_id===i.sessionId)return {data:workView(w)};
  const updated=(await c.query(`UPDATE bansir.driver_work SET active=true,on_duty=true,user_id=$2,session_id=$4,collector_hash=$3,started_at=CASE WHEN on_duty AND user_id=$2 THEN started_at ELSE now() END,ended_at=NULL,gps_state='waiting',latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL,sequence=0,point_hash=NULL,updated_at=now() WHERE driver_id=$1 RETURNING *`,[d.id,i.userId,hash(body.collector),i.sessionId])).rows[0];return {data:workView(updated)};
 }));
 const getCollector=async(c,r,d,collector)=>{const w=(await c.query('SELECT * FROM bansir.driver_work WHERE driver_id=$1 FOR UPDATE',[d.id])).rows[0];if(!w?.active||w.user_id!==r.identity.userId||w.session_id!==r.identity.sessionId||w.collector_hash!==hash(collector))fail('Compartilhamento encerrado ou transferido.','COLLECTOR_REVOKED');return w;};
 app.post('/api/v1/deliveries/work/stop',driver(async(c,r,m,d)=>{
  const b=z.object({collector:uuid,end:z.boolean().default(false)}).strict().parse(r.body);
  const w=(await c.query('SELECT * FROM bansir.driver_work WHERE driver_id=$1 FOR UPDATE',[d.id])).rows[0];if(!w)return {data:null};
  if(w.user_id!==r.identity.userId||w.session_id!==r.identity.sessionId||w.collector_hash!==hash(b.collector))fail('Este aparelho não controla o compartilhamento.','COLLECTOR_REVOKED');
  const updated=(await c.query(`UPDATE bansir.driver_work SET active=false,on_duty=CASE WHEN $2 THEN false ELSE on_duty END,gps_state='stopped',latitude=NULL,longitude=NULL,accuracy=NULL,captured_at=NULL,received_at=NULL,point_hash=NULL,sequence=0,ended_at=CASE WHEN $2 THEN now() ELSE ended_at END,updated_at=now() WHERE driver_id=$1 RETURNING *`,[d.id,b.end])).rows[0];return {data:workView(updated)};
 }));
 app.post('/api/v1/deliveries/work/status',driver(async(c,r,m,d)=>{const b=z.object({collector:uuid,state:z.enum(['denied','unavailable','timeout','background'])}).strict().parse(r.body);await getCollector(c,r,d,b.collector);await c.query('UPDATE bansir.driver_work SET gps_state=$2,updated_at=now() WHERE driver_id=$1 AND gps_state IS DISTINCT FROM $2',[d.id,b.state]);return {data:true};}));
 app.post('/api/v1/deliveries/work/position',rateLimit({windowMs:60000,limit:60,keyGenerator:r=>`${r.identity.userId}:${r.identity.establishmentId}`,standardHeaders:'draft-7',legacyHeaders:false}),driver(async(c,r,m,d)=>{
  const b=z.object({collector:uuid,sequence:z.number().int().min(1).max(2147483647),latitude:z.number().finite().min(-90).max(90),longitude:z.number().finite().min(-180).max(180),accuracy:z.number().finite().min(0).max(100000),capturedAt:z.iso.datetime({offset:true})}).strict().parse(r.body);
  const w=await getCollector(c,r,d,b.collector);const fingerprint=hash(b);
  if(b.sequence===w.sequence&&fingerprint===w.point_hash)return {data:{accepted:true,sequence:w.sequence}};
  if(b.sequence<=w.sequence)return {data:{accepted:false,sequence:w.sequence}};
  if(Math.abs(Date.now()-new Date(b.capturedAt).getTime())>120000)fail('Posição antiga ou relógio incorreto. Solicite uma posição recente.','STALE_POSITION',400);
  if(w.captured_at&&new Date(b.capturedAt)<new Date(w.captured_at))return {data:{accepted:false,sequence:w.sequence}};
  await c.query(`UPDATE bansir.driver_work SET latitude=$2,longitude=$3,accuracy=$4,captured_at=$5,received_at=now(),sequence=$6,point_hash=$7,gps_state='ok',updated_at=now() WHERE driver_id=$1`,[d.id,b.latitude,b.longitude,b.accuracy,b.capturedAt,b.sequence,fingerprint]);return {data:{accepted:true,sequence:b.sequence}};
 }));
 app.post('/api/v1/deliveries/tasks/:id/assign',manager(async(c,r)=>{
  const b=z.object({requestKey:uuid,driverId:uuid,version:z.number().int().min(1),reason:text.default('')}).strict().parse(r.body),i=r.identity,payload={...b,action:'assign',saleId:r.params.id};
  const t=await lockedTask(c,r.params.id);if(await prior(c,i,b.requestKey,payload))return {data:true};
  if(t.version!==b.version)fail('Entrega alterada. Atualize antes de distribuir.','STALE_DELIVERY');
  if(['delivered','cancelled'].includes(t.status))fail('Esta entrega já foi encerrada.');
  if(t.status==='en_route'&&b.reason.length<5)fail('Justifique a reatribuição de entrega em rota.','REASON_REQUIRED',400);
  if(!(await c.query('SELECT id FROM bansir.deliverers WHERE id=$1 AND active FOR SHARE',[b.driverId])).rowCount)fail('Entregador inativo ou de outra unidade.','INVALID_DRIVER',400);
  await c.query("UPDATE bansir.delivery_tasks SET driver_id=$2,status='assigned',version=version+1,departed_at=NULL,delivered_at=NULL,updated_at=now() WHERE sale_id=$1",[t.sale_id,b.driverId]);await audit(c,i,b.requestKey,payload,t.sale_id);return {data:true};
 }));
 app.patch('/api/v1/deliveries/tasks/:id/destination',manager(async(c,r)=>{
  const b=z.object({requestKey:uuid,version:z.number().int(),address:text.min(5),location:deliveryLocation.nullable()}).strict().parse(r.body),i=r.identity;
  // Audit stores only a digest, never the destination coordinates as historical payload.
  const payload={...b,action:'destination',saleId:r.params.id};const t=await lockedTask(c,r.params.id);if(await prior(c,i,b.requestKey,payload))return {data:true};
  if(t.version!==b.version)fail('Atualize a entrega antes de alterar.','STALE_DELIVERY');if(['delivered','cancelled'].includes(t.status))fail('Entrega encerrada.');
  await c.query('UPDATE bansir.delivery_tasks SET address=$2,latitude=$3,longitude=$4,accuracy=$5,destination_source=$6,version=version+1,updated_at=now() WHERE sale_id=$1',[t.sale_id,b.address,b.location?.latitude??null,b.location?.longitude??null,b.location?.accuracy??null,b.location?'confirmed':'address']);await audit(c,i,b.requestKey,payload,t.sale_id);return {data:true};
 }));
 app.post('/api/v1/deliveries/tasks/:id/actions',own(async(c,r,m)=>{
  const b=z.object({requestKey:uuid,version:z.number().int().min(1),action:z.enum(['depart','complete','failed']),reason:text.default('')}).strict().parse(r.body),i=r.identity;
  const t=await lockedTask(c,r.params.id);const d=driveDeliveries(m)?await ownDriver(c,i):null;
  if(!manageDeliveries(m)&&(!d||d.id!==t.driver_id))fail('Entrega não encontrada.','NOT_FOUND',404);
  const payload={...b,saleId:t.sale_id};if(await prior(c,i,b.requestKey,payload))return {data:true};
  if(t.version!==b.version)fail('Entrega alterada. Atualize antes de confirmar.','STALE_DELIVERY');
  const target={depart:'en_route',complete:'delivered',failed:'failed'}[b.action];
  if(b.action==='depart'&&!['assigned','failed'].includes(t.status)||b.action!=='depart'&&t.status!=='en_route')fail('Transição de entrega inválida.');
  if(!t.driver_id)fail('Selecione um entregador primeiro.');if(b.action==='failed'&&b.reason.length<5)fail('Informe o motivo da tentativa sem sucesso.','REASON_REQUIRED',400);
  await c.query(`UPDATE bansir.delivery_tasks SET status=$2,departed_at=CASE WHEN $2='en_route' THEN now() ELSE departed_at END,delivered_at=CASE WHEN $2='delivered' THEN now() ELSE delivered_at END,version=version+1,updated_at=now() WHERE sale_id=$1`,[t.sale_id,target]);
  await audit(c,i,b.requestKey,payload,t.sale_id);return {data:true};
 }));
}
