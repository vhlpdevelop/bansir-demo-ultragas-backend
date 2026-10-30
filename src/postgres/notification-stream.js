import {tenantFeatures} from './features.js';
import {requirePermission} from './catalog.js';
import {manageDeliveries,driveDeliveries,monitorDeliveries,viewDeliveryHistory} from './delivery-permissions.js';
import pg from 'pg';
import {httpError} from './database.js';

// One dedicated LISTEN connection per API process, never one DB connection per tab.
export function mountNotificationStream(app,{database}){
 const permissions=(identity)=>database.transaction(identity,async(c,m)=>{const f=await tenantFeatures(c);let orders=false;try{requirePermission(m,'sales',true);orders=!!f.orderLink;}catch(e){if(e.status!==403)throw e;}return {orders,delivery:!!(f.deliveries&&(manageDeliveries(m)||driveDeliveries(m)||viewDeliveryHistory(m)||monitorDeliveries(m)||m.allowed_routes?.includes('dashboard')))};});
 const peers=new Set();let listener,starting,closed=false;
 const disconnect=()=>{const old=listener;listener=null;for(const p of [...peers])p.end();old?.end().catch(()=>{});};
 const ensureListener=async()=>{
  if(closed)throw httpError(503,'Canal de avisos indisponível.','STREAM_UNAVAILABLE');
  if(listener)return;
  if(!starting)starting=(async()=>{
   const client=new pg.Client({...database.pool.options,application_name:'bansir-notification-listener',connectionTimeoutMillis:5000,keepAlive:true});
   client.on('error',()=>{if(listener===client)disconnect();});
   client.on('end',()=>{if(listener===client)disconnect();});
   client.on('notification',message=>{
    let event;try{event=JSON.parse(message.payload);}catch{return;}
    if(!event||typeof event!=='object')return;
    for(const p of peers){
     if(event.sessionId===p.identity.sessionId){p.end();continue;}
     if(event.delivery&&p.deliveryEnabled&&event.tenantId===p.identity.tenantId&&event.establishmentId===p.identity.establishmentId)p.changed('delivery');
     if(event.orders&&p.ordersEnabled&&event.tenantId===p.identity.tenantId&&event.establishmentId===p.identity.establishmentId)p.changed('orders');
     if(event.userId===p.identity.userId&&event.tenantId===p.identity.tenantId&&event.establishmentId===p.identity.establishmentId)p.changed();
    }
   });
   try{await client.connect();await client.query('LISTEN bansir_notification_events');if(closed){await client.end();throw new Error('STREAM_CLOSED');}listener=client;}
   catch(error){await client.end().catch(()=>{});throw error;}
  })().finally(()=>{starting=null;});
  await starting;
 };
 database.onClose(async()=>{closed=true;disconnect();await starting?.catch(()=>{});});
 app.locals.notificationStream={close:()=>{closed=true;disconnect();}};
 app.get('/api/v1/notifications/stream',async(req,res,next)=>{
  try{
   const identity=req.identity;
   const permitted=await permissions(identity),deliveryEnabled=permitted.delivery,ordersEnabled=permitted.orders;
   if(peers.size>=500||[...peers].filter(p=>p.identity.userId===identity.userId).length>=12){res.set('Retry-After','60');throw httpError(429,'Limite de conexões de avisos.','STREAM_LIMIT');}
   await ensureListener();
   if(peers.size>=500||[...peers].filter(p=>p.identity.userId===identity.userId).length>=12){res.set('Retry-After','60');throw httpError(429,'Limite de conexões de avisos.','STREAM_LIMIT');}
   if(req.destroyed)return;
   res.status(200).set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'});
   res.setTimeout(0);res.flushHeaders();
   let ended=false,busy=false;
   const write=value=>{if(!ended&&!res.write(value))end();};
   const end=()=>{if(ended)return;ended=true;clearInterval(heartbeat);clearTimeout(deadline);peers.delete(peer);res.end();};
   const pending=new Set();
   const peer={identity,end,deliveryEnabled,ordersEnabled,async changed(kind='changed'){
    if(ended)return;pending.add(kind);if(busy)return;busy=true;
    try{while(pending.size&&!ended){const kinds=[...pending];pending.clear();const permitted=await permissions(identity);
     for(const event of kinds)if((event!=='delivery'||permitted.delivery)&&(event!=='orders'||permitted.orders))write(`event: ${event}\ndata: {}\n\n`);
    }}catch{end();}finally{busy=false;}
   }};
   const heartbeat=setInterval(()=>write(': heartbeat\n\n'),20000);
   const deadline=setTimeout(end,Math.max(1,Math.min(300000,identity.accessExpiresAt-Date.now())));
   res.on('close',end);peers.add(peer);
   // Always resync on connection/reconnection: NOTIFY is only a wakeup signal.
   write('event: ready\ndata: {}\n\n');
  }catch(error){if(!res.headersSent)next(error);else res.end();}
 });
}
