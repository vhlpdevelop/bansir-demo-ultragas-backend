import express from 'express';
import {createHmac,timingSafeEqual} from 'node:crypto';
export function validMetaSignature(raw,signature,secret){if(!secret||!Buffer.isBuffer(raw)||!/^sha256=[a-f0-9]{64}$/.test(signature||''))return false;const expected=createHmac('sha256',secret).update(raw).digest();return timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'));}
export function mountMetaWebhook(app,{database}){
 app.get('/api/v1/whatsapp/webhook',(req,res)=>{const token=process.env.META_VERIFY_TOKEN;if(!token)return res.sendStatus(503);if(req.query['hub.mode']!=='subscribe'||req.query['hub.verify_token']!==token||typeof req.query['hub.challenge']!=='string')return res.sendStatus(403);res.type('text/plain').send(req.query['hub.challenge']);});
 app.post('/api/v1/whatsapp/webhook',express.raw({type:'application/json',limit:'500kb'}),async(req,res,next)=>{
  if(!process.env.META_APP_SECRET)return res.sendStatus(503);if(!validMetaSignature(req.body,req.get('x-hub-signature-256'),process.env.META_APP_SECRET))return res.sendStatus(403);
  let body;try{body=JSON.parse(req.body.toString('utf8'));}catch{return res.sendStatus(400);}if(body?.object!=='whatsapp_business_account'||!Array.isArray(body.entry)||body.entry.length>100)return res.sendStatus(400);
  const events=[];
  for(const entry of body.entry)for(const change of Array.isArray(entry?.changes)?entry.changes:[]){if(change?.field!=='messages')continue;const v=change.value,pid=v?.metadata?.phone_number_id;if(typeof pid!=='string')continue;
   for(const m of Array.isArray(v.messages)?v.messages:[]){if(!m||typeof m.id!=='string')return res.sendStatus(400);events.push([pid,String(entry.id),m.id, 'in',String(m.from),String(m.text?.body||'').slice(0,4000),'received',new Date(Number(m.timestamp)*1000)]);}
   for(const s of Array.isArray(v.statuses)?v.statuses:[])if(s&&['sent','delivered','read','failed'].includes(s.status))events.push([pid,String(entry.id),String(s.id),'out',String(s.recipient_id),'',s.status,new Date(Number(s.timestamp)*1000)]);
  }
  if(events.length>1000||events.some(e=>!Number.isFinite(+e[7])||!/^\d{10,15}$/.test(e[4])||e[2].length>300))return res.sendStatus(400);
  let c;try{c=await database.pool.connect();await c.query('BEGIN');for(const e of events)await c.query('SELECT bansir.meta_ingest($1,$2,$3,$4,$5,$6,$7,$8)',e);await c.query('COMMIT');res.sendStatus(200);}catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c?.release();}
 });
}
