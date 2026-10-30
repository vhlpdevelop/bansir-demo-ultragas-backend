import {z} from 'zod';
import rateLimit from 'express-rate-limit';
import {httpError} from './database.js';
import {requireFeature} from './features.js';
import {manageDeliveries,monitorDeliveries,driveDeliveries} from './delivery-permissions.js';
import {activeTasks,storePoint} from './delivery-route-state.js';
import {driverPlan,recommend,point} from './delivery-planner.js';
const allowed=(m,kind)=>manageDeliveries(m)||(kind==='order'&&m.allowed_routes?.includes('sales'));
export function mountDeliveryRouting(app,{database,route,drivers,ownDriver,router}){
 const limit=rateLimit({windowMs:60000,limit:12,keyGenerator:r=>`${r.identity.tenantId}:${r.identity.establishmentId}`,standardHeaders:'draft-7',legacyHeaders:false});
 const check=async(i,kind)=>database.transaction(i,async(c,m)=>{await requireFeature(c,'deliveries');if(kind==='map'?!monitorDeliveries(m):!allowed(m,kind))throw httpError(403,'Sem permissão para esta operação de entregas.','FORBIDDEN');});
 for(const [kind,path] of [['task','tasks'],['order','orders']])app.get(`/api/v1/deliveries/${path}/:id/recommendations`,limit,route(async req=>{
  const i=req.identity,id=z.uuid().parse(req.params.id),scope=i.tenantId+':'+i.establishmentId;
  const snapshot=await database.transaction(i,async(c,m)=>{
   if(!allowed(m,kind))throw httpError(403,'Sem permissão para sugerir entregadores.','FORBIDDEN');
   let target;
   if(kind==='task'){target=(await c.query('SELECT * FROM bansir.delivery_tasks WHERE sale_id=$1',[id])).rows[0];if(target&&['delivered','cancelled'].includes(target.status))throw httpError(409,'Esta entrega foi encerrada.','DELIVERY_CLOSED');}
   else{const o=(await c.query('SELECT id,status,fulfillment,delivery_location FROM bansir.storefront_orders WHERE id=$1',[id])).rows[0];if(o){if(o.status!=='new'||o.fulfillment!=='delivery')throw httpError(409,'A sugestão se aplica a pedidos de entrega aguardando aceite.','ORDER_CLOSED');target={...o.delivery_location};}}
   if(!target)throw httpError(404,'Pedido não encontrado nesta unidade.','NOT_FOUND');
   const all=(await activeTasks(c)).filter(t=>kind!=='task'||t.sale_id!==id),store=await storePoint(c),rows=await drivers(c,!!monitorDeliveries(m));
   return {plans:rows.map(d=>driverPlan(d,all,store,{allowPosition:!!monitorDeliveries(m)})),target,usesLivePositions:!!monitorDeliveries(m)};
  });
  const data=await recommend(snapshot.plans,snapshot.target,router,scope);await check(i,kind);
  return {data:{...data,usesLivePositions:snapshot.usesLivePositions,targetId:id,targetVersion:snapshot.target.version??null}};
 }));
 const mine=async i=>database.transaction(i,async(c,m)=>{
  await requireFeature(c,'deliveries');if(!driveDeliveries(m))throw httpError(403,'Sem permissão para operar entregas.','FORBIDDEN');
  const d=await ownDriver(c,i);if(!d)throw httpError(404,'Vincule sua conta a um entregador.','DRIVER_NOT_LINKED');
  const row=(await c.query('SELECT d.map_color,d.map_color_index,w.* FROM bansir.deliverers d LEFT JOIN bansir.driver_work w ON w.driver_id=d.id AND w.user_id=$2 WHERE d.id=$1',[d.id,i.userId])).rows[0];
  const position=row.active&&row.on_duty&&row.latitude!=null?{latitude:row.latitude,longitude:row.longitude,accuracy:row.accuracy,capturedAt:row.captured_at,receivedAt:row.received_at}:null;
  const store=await storePoint(c),plan=driverPlan({...row,id:d.id,name:d.name,driver_active:true,account_active:true,position},await activeTasks(c,d.id),store);return {store,plan};
 });
 app.get('/api/v1/deliveries/mine/map',route(async req=>{
  const i=req.identity,scope=i.tenantId+':'+i.establishmentId,initial=await mine(i),geometry=await router.geometry(initial.plan,scope),{store,plan}=await mine(i);
  const valid=initial.plan.driverId===plan.driverId&&initial.plan.revision===plan.revision&&initial.plan.originSource===plan.originSource;
  return {data:{store,routes:[{driverId:plan.driverId,name:plan.name,color:plan.color,onDuty:plan.onDuty,sharing:plan.sharing,position:plan.position,incompleteStops:plan.incompleteStops,stops:plan.stops.map((t,n)=>({saleId:t.sale_id,status:t.status,address:t.address,point:point(t),order:t.route_order||n+1})),geometry:valid&&geometry||{model:'approximate',coordinates:plan.origin?[plan.origin,...plan.stops.map(point).filter(Boolean)].map(p=>[p.longitude,p.latitude]):[]}}],updatedAt:new Date().toISOString(),activeStops:plan.stops.length}};
 }));
 app.get('/api/v1/deliveries/map',route(async req=>{
  const i=req.identity,scope=i.tenantId+':'+i.establishmentId;
  const snapshot=await database.transaction(i,async(c,m)=>{if(!monitorDeliveries(m))throw httpError(403,'Monitorar o mapa exige direito de localização e dashboard.','FORBIDDEN');const store=await storePoint(c),tasks=await activeTasks(c),rows=await drivers(c,true);return {store,plans:rows.map(d=>driverPlan(d,tasks,store)),taskCount:tasks.length};});
  const geometries=new Map(),started=Date.now();let next=0;const build=async()=>{for(;;){const index=next++;if(index>=snapshot.plans.length)return;const plan=snapshot.plans[index],geometry=Date.now()-started<20000?await router.geometry(plan,scope):null;geometries.set(plan.driverId,{revision:plan.revision,originSource:plan.originSource,geometry});}};await Promise.all([build(),build()]);
  // Re-read after external I/O so a paused driver or revoked contract does not leak the old point.
  const current=await database.transaction(i,async(c,m)=>{await requireFeature(c,'deliveries');if(!monitorDeliveries(m))throw httpError(403,'Sem permissão para monitorar entregas.','FORBIDDEN');const store=await storePoint(c),tasks=await activeTasks(c),rows=await drivers(c,true);return {store,plans:rows.map(d=>driverPlan(d,tasks,store)),taskCount:tasks.length};});
  const routes=current.plans.map(plan=>{const cached=geometries.get(plan.driverId),geometry=cached?.revision===plan.revision&&cached.originSource===plan.originSource?cached.geometry:null;return {driverId:plan.driverId,name:plan.name,color:plan.color,onDuty:plan.onDuty,sharing:plan.sharing,position:plan.position,positionState:plan.positionState,origin:plan.origin,originSource:plan.originSource,incompleteStops:plan.incompleteStops,stops:plan.stops.map((t,n)=>({saleId:t.sale_id,status:t.status,address:t.address,point:point(t),order:t.route_order||n+1})),geometry:geometry||{model:'approximate',coordinates:plan.origin?[plan.origin,...plan.stops.map(point).filter(Boolean)].map(p=>[p.longitude,p.latitude]):[],calculatedAt:new Date().toISOString()}};});
  return {data:{store:current.store,routes,provider:router.info(),updatedAt:new Date().toISOString(),activeStops:current.taskCount}};
 }));
}
