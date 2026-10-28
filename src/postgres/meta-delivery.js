import {unseal,secretContext} from './secrets.js';
import {normalizePhone} from './phone.js';
const terminal=code=>Object.assign(new Error(code),{terminal:true});
export async function processMetaJob(queue,job,{transport=fetch,version=process.env.META_GRAPH_VERSION}={}){
 if(!/^v\d{1,3}\.\d+$/.test(version||''))throw terminal('META_VERSION_REQUIRED');
 const snapshot=await queue.scope(job,async c=>{
  const allowed=(await c.query('SELECT bansir.meta_sender_active($1,$2,$3,$4) AS allowed',[job.tenant_id,job.establishment_id,job.payload.userId||null,job.payload.permission||null])).rows[0].allowed;
  if(!allowed)throw terminal('META_SENDER_REVOKED');
  const a=(await c.query('SELECT * FROM bansir.meta_accounts WHERE enabled')).rows[0];if(!a)throw terminal('META_NOT_CONFIGURED');
  if(job.payload.metaPhoneId!==a.phone_number_id||job.payload.metaWabaId!==a.waba_id)throw terminal('META_ACCOUNT_CHANGED');
  const existing=(await c.query("SELECT message_id,status FROM bansir.meta_messages WHERE job_id=$1 ORDER BY (message_id LIKE 'wamid.%') DESC LIMIT 1",[job.id])).rows[0];if(existing?.message_id.startsWith('wamid.'))return {existing:true};if(existing?.status==='submitting')throw terminal('META_SEND_UNCERTAIN');
  const phone=normalizePhone(job.payload.phone),recent=(await c.query("SELECT 1 FROM bansir.meta_messages WHERE direction='in' AND phone=$1 AND received_at>now()-interval '24 hours' LIMIT 1",[phone])).rowCount;
  const optIn=(await c.query('SELECT opt_in FROM bansir.meta_contacts WHERE phone=$1',[phone])).rows[0]?.opt_in;
  if(job.payload.action==='auto-greeting'){
   const cfg=(await c.query('SELECT * FROM bansir.meta_greetings WHERE enabled')).rows[0];
   if(!cfg||cfg.sender_user_id!==job.payload.userId||cfg.message!==job.payload.message||(cfg.recipient_filter&&cfg.recipient_filter!==phone)||optIn===false)throw terminal('META_GREETING_DISABLED');
   if(!recent)throw terminal('META_GREETING_WINDOW_EXPIRED');
  }
  const message=String(job.payload.message||'');if(!message||message.length>4000)throw terminal('META_INVALID_MESSAGE');
  let content;
  if(recent)content={type:'text',text:{body:message,preview_url:false}};
  else{if(!optIn)throw terminal('META_OPT_IN_REQUIRED');const name=job.payload.action==='send-voucher'?a.voucher_template:a.delivery_template;if(!name)throw terminal('META_TEMPLATE_REQUIRED');if(message.length>1024)throw terminal('META_TEMPLATE_TEXT_TOO_LONG');content={type:'template',template:{name,language:{code:a.template_language},components:[{type:'body',parameters:[{type:'text',text:message}]}]}};}
  await c.query("INSERT INTO bansir.meta_messages(tenant_id,establishment_id,message_id,direction,phone,status,job_id) VALUES($1,$2,$3,'out',$4,'submitting',$5) ON CONFLICT(tenant_id,establishment_id,message_id) DO UPDATE SET status='submitting'",[job.tenant_id,job.establishment_id,'attempt:'+job.id,phone,job.id]);
  return {account:a,phone,message,body:{messaging_product:'whatsapp',recipient_type:'individual',to:phone,...content},token:unseal(a.encrypted_token,secretContext({tenantId:job.tenant_id,establishmentId:job.establishment_id},'whatsapp-meta'))};
 });
 if(snapshot.existing)return;
 let response;
 try{response=await transport(`https://graph.facebook.com/${version}/${snapshot.account.phone_number_id}/messages`,{method:'POST',headers:{Authorization:'Bearer '+snapshot.token,'Content-Type':'application/json'},body:JSON.stringify(snapshot.body),signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw terminal('META_SEND_UNCERTAIN');}
 if(response.status===429){await queue.scope(job,c=>c.query("UPDATE bansir.meta_messages SET status='retry_allowed' WHERE message_id=$1",['attempt:'+job.id]));throw new Error('META_RATE_LIMIT');}if(response.status>=500)throw terminal('META_SEND_UNCERTAIN');if(!response.ok)throw terminal('META_SEND_REJECTED');
 let text;try{text=await response.text();}catch{throw terminal('META_SEND_UNCERTAIN');}if(text.length>64000)throw terminal('META_SEND_UNCERTAIN');let data;try{data=JSON.parse(text);}catch{throw terminal('META_SEND_UNCERTAIN');}const id=data?.messages?.[0]?.id;if(typeof id!=='string'||!id.startsWith('wamid.')||id.length>300)throw terminal('META_SEND_UNCERTAIN');
 await queue.scope(job,c=>c.query("INSERT INTO bansir.meta_messages(tenant_id,establishment_id,message_id,direction,phone,status,job_id,body) VALUES($1,$2,$3,'out',$4,'accepted',$5,$6) ON CONFLICT(tenant_id,establishment_id,message_id) DO UPDATE SET job_id=EXCLUDED.job_id,body=EXCLUDED.body",[job.tenant_id,job.establishment_id,id,snapshot.phone,job.id,snapshot.message]));
}
