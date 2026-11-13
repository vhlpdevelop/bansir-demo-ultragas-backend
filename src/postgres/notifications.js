import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import webpush from 'web-push';
import {configureVapid} from '../config/vapid.js';
import {enqueue} from './queue.js';
import {httpError} from './database.js';

const preferenceCategories = ['sales','stock','smartpos','payables','receivables','agreements','fleet','fiscal-inbound','fiscal-outbound','other'];

export function pushEndpoint(value) {
 try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && (!u.port || u.port==='443') &&
  (['fcm.googleapis.com','web.push.apple.com'].includes(u.hostname) || u.hostname.endsWith('.push.services.mozilla.com'));} catch{return false;}
}
const deviceInput=z.object({deviceId:z.string().min(1).max(200),pushEnabled:z.boolean().optional(),
 subscription:z.object({endpoint:z.string().max(2048).refine(pushEndpoint,'Provedor push não permitido.'),expirationTime:z.number().nullable().optional(),keys:z.object({p256dh:z.string().regex(/^[\w-]{87}={0,2}$/),auth:z.string().regex(/^[\w-]{22}={0,2}$/)}).strict()}).strict().nullable().optional(),
 deviceType:z.enum(['desktop','mobile','tablet']).optional(),deviceName:z.string().max(200).optional(),browser:z.string().max(200).optional(),os:z.string().max(200).optional(),userAgent:z.string().max(1000).optional(),platform:z.string().max(100).optional(),name:z.string().max(200).optional()
}).strip();

// Producers call this in the SAME transaction as their business event (outbox).
// Recipient is always explicit and scoped. Never broadcast to all tenants.
export async function enqueueNotification(client,identity,{key,title,body,deviceId,metadata={}}) {
 const id=randomUUID();
 const job=await enqueue(client,identity,{kind:'notification',key,payload:{notificationId:id,userId:identity.userId,title,body,...(deviceId?{deviceId}:{})}});
 if(job)await client.query('INSERT INTO bansir.notifications(tenant_id,establishment_id,id,user_id,title,body,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[identity.tenantId,identity.establishmentId,id,identity.userId,title,body,metadata]);
 return job;
}
export function mountNotifications(app,{scoped,route,database}) {
 const vapid=configureVapid(webpush,process.env);
 app.get('/api/v1/notifications/vapid-public-key',route(async req=>{await database.transaction(req.identity,async()=>{});return {data:{publicKey:vapid.publicKey},meta:{publicKey:vapid.publicKey}};}));
 const own=fn=>route(async req=>database.transaction(req.identity,client=>fn(client,req)));
 app.get('/api/v1/notifications',own(async c=>({data:(await c.query(`
  SELECT id AS _id,title,body,created_at AS date,read_at IS NOT NULL AS read,metadata,bansir.notification_category(title) AS category
  FROM bansir.notifications
  WHERE NOT (bansir.notification_category(title)=ANY(coalesce((SELECT disabled FROM bansir.notification_preferences),'{}'::text[])))
  ORDER BY created_at DESC LIMIT 100`)).rows})));
 app.get('/api/v1/notifications/preferences',own(async c=>({data:(await c.query('SELECT disabled FROM bansir.notification_preferences')).rows[0]||{disabled:[]}})));
 app.put('/api/v1/notifications/preferences',own(async(c,req)=>{
  const {disabled}=z.object({disabled:z.array(z.enum(preferenceCategories)).max(preferenceCategories.length)}).strict().parse(req.body);
  const {tenantId,establishmentId,userId}=req.identity;
  const {rows:[data]}=await c.query(`INSERT INTO bansir.notification_preferences (tenant_id,establishment_id,user_id,disabled)
   VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,establishment_id,user_id)
   DO UPDATE SET disabled=excluded.disabled RETURNING disabled`,[tenantId,establishmentId,userId,[...new Set(disabled)]]);
  return {data};
 }));
 app.delete('/api/v1/notifications',own(async(c,req)=>{
  const result=await c.query('DELETE FROM bansir.notifications WHERE user_id=$1 AND tenant_id=$2 AND establishment_id=$3',[req.identity.userId,req.identity.tenantId,req.identity.establishmentId]);
  return {data:{deleted:result.rowCount}};
 }));
 app.get('/api/v1/notifications/devices',own(async c=>({data:(await c.query('SELECT details,device_id AS "deviceId",enabled AS "pushEnabled",updated_at AS "lastActive" FROM bansir.push_devices')).rows.map(d=>({...d,...d.details}))})));
 app.post('/api/v1/notifications/devices/register',own(async(c,req)=>{
  const data=deviceInput.parse(req.body),i=req.identity;
  if(data.pushEnabled && (!vapid.configured || !data.subscription))throw httpError(409,'Push não configurado ou assinatura ausente.','PUSH_NOT_READY');
  if(data.subscription)await c.query(`INSERT INTO bansir.push_devices(tenant_id,establishment_id,user_id,device_id,subscription,enabled) VALUES($1,$2,$3,$4,$5,$6)
   ON CONFLICT(tenant_id,establishment_id,user_id,device_id) DO UPDATE SET subscription=EXCLUDED.subscription,enabled=EXCLUDED.enabled,updated_at=now()`,[i.tenantId,i.establishmentId,i.userId,data.deviceId,data.subscription,!!data.pushEnabled]);
  else if(data.pushEnabled===false)await c.query('UPDATE bansir.push_devices SET enabled=false,updated_at=now() WHERE device_id=$1',[data.deviceId]);
  await c.query('UPDATE bansir.push_devices SET details=$2 WHERE device_id=$1',[data.deviceId,{deviceName:data.deviceName||data.name||'Navegador',deviceType:data.deviceType||'desktop',browser:data.browser||'',os:data.os||''}]);
  return {data:{deviceId:data.deviceId}};
 }));
 app.patch('/api/v1/notifications/devices/:deviceId/toggle',own(async(c,req)=>{
  const {pushEnabled}=z.object({pushEnabled:z.boolean()}).strict().parse(req.body);
  await c.query('UPDATE bansir.push_devices SET enabled=$2,updated_at=now() WHERE device_id=$1',[req.params.deviceId,pushEnabled]);return {data:true};
 }));
 app.delete('/api/v1/notifications/devices/:deviceId',own(async(c,req)=>{await c.query('DELETE FROM bansir.push_devices WHERE device_id=$1',[req.params.deviceId]);return {data:true};}));
 app.post('/api/v1/notifications/test-push',own(async(c,req)=>{
  if(!vapid.configured)throw httpError(409,'Configure as chaves VAPID.','PUSH_NOT_READY');
  const {deviceId}=z.object({deviceId:z.string().min(1).max(200)}).strict().parse(req.body);
  if(!(await c.query('SELECT device_id FROM bansir.push_devices WHERE device_id=$1 AND enabled',[deviceId])).rowCount)throw httpError(409,'Ative as notificações neste navegador primeiro.','DEVICE_NOT_ENABLED');
  const jobId=await enqueueNotification(c,req.identity,{key:randomUUID(),title:'Ultragas',body:'As notificações deste estabelecimento estão ativas.',deviceId});
  return {status:202,data:{jobId}};
 }));
 app.delete('/api/v1/notifications/:id',own(async(c,req)=>{await c.query('DELETE FROM bansir.notifications WHERE id=$1',[z.uuid().parse(req.params.id)]);return {data:true};}));
 app.patch('/api/v1/notifications/read-all',own(async c=>{await c.query('UPDATE bansir.notifications SET read_at=now() WHERE read_at IS NULL');return {data:true};}));
 app.patch('/api/v1/notifications/:id/read',own(async(c,req)=>{await c.query('UPDATE bansir.notifications SET read_at=now() WHERE id=$1',[z.uuid().parse(req.params.id)]);return {data:true};}));
 app.get('/api/v1/workers/jobs',scoped('settings',true,async c=>({data:(await c.query('SELECT id,kind,state,attempts,max_attempts,last_error,created_at,completed_at FROM bansir.jobs ORDER BY created_at DESC LIMIT 100')).rows})));
}

export async function deliverNotification(queue,job,{send=webpush.sendNotification.bind(webpush),pushEnabled=true}={}) {
 if(!pushEnabled)return;
 const devices=await queue.scope(job,async c=>{
  const active=(await c.query('SELECT bansir.push_recipient_active($1,$2,$3) AS active',[job.tenant_id,job.establishment_id,job.payload.userId])).rows[0].active;
  if(!active)return [];
  const {rows:[notification]}=await c.query('SELECT title FROM bansir.notifications WHERE id=$1 AND user_id=$2',[job.payload.notificationId,job.payload.userId]);
  if(!notification)return [];
  if(!job.payload.deviceId&&(await c.query(`SELECT 1 FROM bansir.notification_preferences
   WHERE user_id=$1 AND bansir.notification_category($2)=ANY(disabled)`,[job.payload.userId,notification.title])).rowCount)return [];
  if(job.payload.category==='fleet'&&!(await c.query('SELECT bansir.fleet_recipient_allowed($1,$2,$3) AS allowed',[job.tenant_id,job.establishment_id,job.payload.userId])).rows[0].allowed)return [];
  if(job.payload.category==='fiscal'&&!(await c.query('SELECT bansir.fiscal_recipient_allowed($1,$2,$3) AS allowed',[job.tenant_id,job.establishment_id,job.payload.userId])).rows[0].allowed)return [];
  if(job.payload.category==='financial'&&!(await c.query('SELECT bansir.financial_recipient_allowed($1,$2,$3,$4) AS allowed',[job.tenant_id,job.establishment_id,job.payload.userId,job.payload.financialPart])).rows[0].allowed)return [];
  if(job.payload.category==='agreement'&&(!(await c.query('SELECT bansir.agreement_recipient_allowed($1,$2,$3) AS allowed',[job.tenant_id,job.establishment_id,job.payload.userId])).rows[0].allowed||!(await c.query('SELECT bansir.agreement_alert_needed($1,$2,$3,$4,$5) AS needed',[job.tenant_id,job.establishment_id,job.payload.agreementId,job.payload.periodEnd,job.payload.event])).rows[0].needed))return [];
  return (await c.query('SELECT * FROM bansir.push_devices WHERE user_id=$1 AND enabled AND ($2::text IS NULL OR device_id=$2)',[job.payload.userId,job.payload.deviceId||null])).rows;
 });
 let transient=false;
 for(const d of devices){
  if(!pushEndpoint(d.subscription.endpoint))continue;
  try {await send(d.subscription,JSON.stringify({title:'Ultragas',body:'Você tem uma atualização no estabelecimento. Abra o app para consultar.',data:{notifId:job.payload.notificationId,tenantId:job.tenant_id,establishmentId:job.establishment_id}}),{TTL:3600,timeout:10000});}
  catch(e){if([404,410].includes(e.statusCode))await queue.scope(job,c=>c.query('UPDATE bansir.push_devices SET enabled=false WHERE user_id=$1 AND device_id=$2 AND subscription->>\'endpoint\'=$3',[d.user_id,d.device_id,d.subscription.endpoint]));
   else if(!e.statusCode || e.statusCode===429 || e.statusCode>=500)transient=true;
   else throw Object.assign(new Error('PUSH_REJECTED'),{terminal:true});}
 }
 if(transient)throw new Error('PUSH_RETRY');
}
