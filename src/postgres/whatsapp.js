import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {enqueue} from './queue.js';
import {httpError} from './database.js';

export function mountWhatsapp(app,{scoped}){
 app.get('/api/v1/whatsapp/status',scoped('settings',true,async(c,req)=>{
  const row=(await c.query('SELECT status,qr_code_url,phone FROM bansir.whatsapp_sessions WHERE tenant_id=$1 AND establishment_id=$2',[req.identity.tenantId,req.identity.establishmentId])).rows[0];
  return {data:{status:row?.status||'DISCONNECTED',qrCodeUrl:row?.qr_code_url||null,phone:row?.phone||''}};
 }));
 app.post('/api/v1/whatsapp/start',scoped('settings',false,async(c,req)=>{
  const i=req.identity;
  await c.query(`INSERT INTO bansir.whatsapp_sessions(tenant_id,establishment_id,requested,status)
   VALUES($1,$2,true,'SYNCING') ON CONFLICT(tenant_id,establishment_id)
   DO UPDATE SET requested=true,status=CASE WHEN bansir.whatsapp_sessions.status='CONNECTED' THEN 'CONNECTED' ELSE 'SYNCING' END,updated_at=now()`,[i.tenantId,i.establishmentId]);
  await enqueue(c,i,{kind:'whatsapp',key:`connect:${randomUUID()}`,payload:{action:'sync'}});
  return {data:{started:true}};
 }));
 app.post('/api/v1/whatsapp/logout',scoped('settings',false,async(c,req)=>{
  const i=req.identity;
  await c.query(`INSERT INTO bansir.whatsapp_sessions(tenant_id,establishment_id,requested,status)
   VALUES($1,$2,false,'DISCONNECTED') ON CONFLICT(tenant_id,establishment_id)
   DO UPDATE SET requested=false,status='DISCONNECTED',qr_code_url=NULL,phone='',updated_at=now()`,[i.tenantId,i.establishmentId]);
  await enqueue(c,i,{kind:'whatsapp',key:`logout:${randomUUID()}`,payload:{action:'logout'}});
  return {data:{loggedOut:true}};
 }));
 app.post('/api/v1/whatsapp/messages',scoped('settings',false,async(c,req)=>{
  const body=z.object({phone:z.string().regex(/^\+?[0-9]{10,15}$/),message:z.string().trim().min(1).max(4000)}).strict().parse(req.body),i=req.identity;
  const row=(await c.query('SELECT requested,status FROM bansir.whatsapp_sessions WHERE tenant_id=$1 AND establishment_id=$2',[i.tenantId,i.establishmentId])).rows[0];
  if(!row?.requested)throw httpError(409,'Conecte o WhatsApp deste estabelecimento antes de enviar mensagens.','WHATSAPP_DISCONNECTED');
  const id=await enqueue(c,i,{kind:'whatsapp',key:`message:${randomUUID()}`,payload:{action:'send-text',phone:body.phone,message:body.message}});
  return {status:202,data:{queued:Boolean(id)}};
 }));
}
