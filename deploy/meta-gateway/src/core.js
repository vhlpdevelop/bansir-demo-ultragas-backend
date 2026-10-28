import {createHmac,timingSafeEqual} from 'node:crypto';
export function signatureOK(raw,signature,secret){if(!secret||!/^sha256=[a-f0-9]{64}$/.test(signature||''))return false;return timingSafeEqual(createHmac('sha256',secret).update(raw).digest(),Buffer.from(signature.slice(7),'hex'));}
export function splitPayload(body){
 if(body?.object!=='whatsapp_business_account'||!Array.isArray(body.entry)||body.entry.length>100)throw new Error('INVALID_EVENT');
 const groups=new Map();let count=0;
 for(const entry of body.entry){if(!/^\d{5,30}$/.test(entry?.id))throw new Error('INVALID_WABA');for(const change of entry.changes||[]){
  if(change?.field!=='messages')continue;const v=change.value,pid=v?.metadata?.phone_number_id;if(!/^\d{5,30}$/.test(pid||''))throw new Error('INVALID_PHONE_ID');
  const key=entry.id+':'+pid;if(!groups.has(key))groups.set(key,{wabaId:entry.id,phoneNumberId:pid,events:[]});const group=groups.get(key);
  for(const [list,direction] of [[v.messages,'in'],[v.statuses,'out']]){if(list!==undefined&&!Array.isArray(list))throw new Error('INVALID_MESSAGES');for(const m of list||[]){
   if(++count>1000)throw new Error('TOO_MANY_EVENTS');
   const status=direction==='in'?'received':m?.status;if(!['received','sent','delivered','read','failed'].includes(status))continue;
   const phone=direction==='in'?m?.from:m?.recipient_id,timestamp=new Date(Number(m?.timestamp)*1000);
   if(typeof m?.id!=='string'||m.id.length>300||!m.id||!/^\d{10,15}$/.test(phone||'')||!Number.isFinite(+timestamp))throw new Error('INVALID_MESSAGE');
   group.events.push({messageId:m.id,direction,phone,text:direction==='in'?String(m.text?.body||'').slice(0,4000):'',status,timestamp:timestamp.toISOString()});
  }}
 }}return [...groups.values()].filter(g=>g.events.length);
}
export function makeIngress({secrets,enqueue,appId}){return async event=>{
 const method=event.requestContext?.http?.method,headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
 const response=(statusCode,body)=>({statusCode,headers:{'content-type':'text/plain','cache-control':'no-store'},body});
 if(!['GET','POST'].includes(method))return response(405,'Method not allowed');
 try{
  const secret=await secrets();if(!secret.appSecret||!secret.verifyToken)return response(503,'Not configured');
  if(method==='GET'){const q=event.queryStringParameters||{};return q['hub.mode']==='subscribe'&&q['hub.verify_token']===secret.verifyToken&&typeof q['hub.challenge']==='string'&&q['hub.challenge'].length<1000?response(200,q['hub.challenge']):response(403,'Forbidden');}
  const raw=Buffer.from(event.body||'',event.isBase64Encoded?'base64':'utf8');if(raw.length>200000)return response(413,'Payload too large');
  if(!signatureOK(raw,headers['x-hub-signature-256'],secret.appSecret))return response(403,'Forbidden');
  let groups;try{groups=splitPayload(JSON.parse(raw.toString('utf8')));}catch{return response(400,'Invalid event');}
  if(groups.length)await enqueue({version:1,appId,groups});
  return response(200,'EVENT_RECEIVED');
 }catch{return response(503,'Temporarily unavailable');}
};}
export function makeRouter({resolve,send,appId}){return async event=>{
 const batchItemFailures=[];
 for(const record of event.Records||[])try{
  const body=JSON.parse(record.body);if(body.version!==1||body.appId!==appId||!Array.isArray(body.groups)||body.groups.length>1000)throw new Error('INVALID_ENVELOPE');
  for(const group of body.groups){const route=await resolve(group.phoneNumberId);if(!route?.enabled||route.wabaId!==group.wabaId||!route.tenantId||!route.establishmentId||!route.cellId)throw new Error('ROUTE_UNAVAILABLE');
   await send(route,{version:1,appId,cellId:route.cellId,tenantId:route.tenantId,establishmentId:route.establishmentId,wabaId:group.wabaId,phoneNumberId:group.phoneNumberId,events:group.events});}
 }catch{batchItemFailures.push({itemIdentifier:record.messageId});}
 return {batchItemFailures};
};}
