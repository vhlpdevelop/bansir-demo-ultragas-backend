import {delegatedSetting} from './settings-permissions.js';
import {disconnectMeta} from './meta-onboarding.js';
import {tenantFeatures} from './features.js';
import {z} from 'zod';
import {enqueue} from './queue.js';
import {httpError} from './database.js';
import {seal,unseal,secretContext} from './secrets.js';
import {normalizePhone} from './phone.js';
export async function queueWhatsapp(c,i,{key,payload}){
 if(!(await tenantFeatures(c)).whatsapp)return false;
 const account=(await c.query('SELECT enabled,phone_number_id,waba_id FROM bansir.meta_accounts')).rows[0];if(!account?.enabled)return false;
 const data={...payload,userId:i.userId,metaPhoneId:account.phone_number_id,metaWabaId:account.waba_id};
 const existing=(await c.query("SELECT payload FROM bansir.jobs WHERE kind='whatsapp' AND dedupe_key=$1",[key])).rows[0];
 if(existing){if(existing.payload.userId!==i.userId||existing.payload.phone!==payload.phone||existing.payload.message!==payload.message)throw httpError(409,'Tentativa já usada com outra mensagem.','IDEMPOTENCY_CONFLICT');return true;}
 await enqueue(c,i,{kind:'whatsapp',key,payload:data,maxAttempts:5});return true;
}
export function mountWhatsapp(app,{scoped,metaConnect}){
 const templates='/api/v1/whatsapp/templates';
 for(const method of ['get','post'])app[method](templates,scoped('settings',method==='get',async(c,req,m)=>{
  if(!delegatedSetting(m,'settings-whatsapp'))throw httpError(403,'Seu perfil não pode gerenciar modelos do WhatsApp.','FORBIDDEN');
  if(!(await tenantFeatures(c)).whatsapp)throw httpError(403,'WhatsApp indisponível no contrato.','FEATURE_DISABLED');
  const a=(await c.query('SELECT waba_id,encrypted_token FROM bansir.meta_accounts WHERE enabled')).rows[0];
  if(!a)throw httpError(409,'Conecte o WhatsApp do estabelecimento.','META_SETUP_REQUIRED');
  const version=process.env.META_GRAPH_VERSION;
  if(!/^v\d+\.\d+$/.test(version||''))throw httpError(503,'A versão da API Meta não está configurada.','META_UNAVAILABLE');
  const url=new URL(`https://graph.facebook.com/${version}/${a.waba_id}/message_templates`);
  let body;
  if(method==='get'){
   const after=z.string().max(4096).optional().parse(req.query.after);
   url.searchParams.set('fields','id,name,status,category,language,components');
   url.searchParams.set('limit','25');
   if(after)url.searchParams.set('after',after);
  }else{
   const d=z.object({name:z.string().regex(/^[a-z0-9_]+$/).max(200),language:z.enum(['pt_BR','en_US','es']),category:z.enum(['UTILITY','MARKETING']),message:z.string().trim().min(1).max(1024),example:z.string().trim().max(200).optional()}).strict().parse(req.body);
   const variables=d.message.match(/\{\{.*?\}\}/g)||[];
   if(variables.some(v=>v!=='{{1}}')||(variables.length&&!d.example))throw httpError(400,'Use apenas {{1}} e informe um exemplo para esse campo.','META_TEMPLATE_VARIABLE');
   body=JSON.stringify({name:d.name,language:d.language,category:d.category,components:[{type:'BODY',text:d.message,...(variables.length?{example:{body_text:[[d.example]]}}:{})}]});
  }
  const token=unseal(a.encrypted_token,secretContext(req.identity,'whatsapp-meta'));
  let response,result;
  try{
   response=await fetch(url,{method:method.toUpperCase(),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(12000),redirect:'error'});
   result=await response.json();
  }catch{throw httpError(502,method==='post'?'A Meta não confirmou o envio. Consulte a lista antes de tentar novamente.':'Não foi possível consultar os modelos na Meta.','META_UNAVAILABLE');}
  if(!response.ok){
   const code=Number(result?.error?.code)||response.status;
   if([10,190,200].includes(code)||response.status===403)throw httpError(403,'A Meta recusou o acesso. Confira whatsapp_business_management e a autorização desta conta.','META_MANAGEMENT_PERMISSION');
   throw httpError(422,`A Meta recusou a operação (código ${code}). Confira os dados do modelo no WhatsApp Manager.`,'META_TEMPLATE_REJECTED');
  }
  return method==='get'?{data:{templates:result.data||[],next:result.paging?.next?result.paging.cursors?.after:null}}:{status:201,data:{id:result.id,status:result.status}};
 }));
 app.get('/api/v1/whatsapp/greeting',scoped('settings',true,async c=>({data:(await c.query('SELECT enabled,message,recipient_filter FROM bansir.meta_greetings')).rows[0]||{enabled:false,message:''}})));
 app.put('/api/v1/whatsapp/greeting',scoped('settings',false,async(c,req,m)=>{if(!delegatedSetting(m,'settings-whatsapp'))throw httpError(403,'Somente administrador pode configurar a saudação.','FORBIDDEN');const d=z.object({enabled:z.boolean(),message:z.string().trim().min(1).max(1024)}).strict().parse(req.body),i=req.identity;await c.query('INSERT INTO bansir.meta_greetings(tenant_id,establishment_id,enabled,message,sender_user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,establishment_id) DO UPDATE SET enabled=EXCLUDED.enabled,message=EXCLUDED.message,sender_user_id=EXCLUDED.sender_user_id,updated_at=now()',[i.tenantId,i.establishmentId,d.enabled,d.message,i.userId]);return {data:d};}));
 app.get('/api/v1/whatsapp/status',scoped('settings',true,async c=>{const account=(await c.query('SELECT phone_number_id,waba_id,display_phone,enabled,template_language,voucher_template,delivery_template FROM bansir.meta_accounts')).rows[0];return {data:{provider:'meta',status:account?.enabled?'CONFIGURED':'NOT_CONFIGURED',account:account||null,webhookConfigured:!!(process.env.META_APP_SECRET&&process.env.META_VERIFY_TOKEN)}};}));
 app.put('/api/v1/whatsapp/meta',scoped('settings',false,async(c,req,m)=>{
  if(!delegatedSetting(m,'settings-whatsapp'))throw httpError(403,'Somente administrador pode configurar a conta Meta.','FORBIDDEN');
  const d=z.object({phoneNumberId:z.string().regex(/^\d{5,30}$/),wabaId:z.string().regex(/^\d{5,30}$/),accessToken:z.string().min(20).max(4096).optional(),displayPhone:z.string().max(40).default(''),language:z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default('pt_BR'),voucherTemplate:z.string().regex(/^[a-z0-9_]*$/).max(200).default(''),deliveryTemplate:z.string().regex(/^[a-z0-9_]*$/).max(200).default('')}).strict().parse(req.body),i=req.identity;
  const old=(await c.query('SELECT * FROM bansir.meta_accounts FOR UPDATE')).rows[0];if(old?.onboarding_id&&!old.enabled)throw httpError(409,'Conclua a ativação pendente.','ACTIVATION_PENDING');if(old?.onboarding_id&&(old.phone_number_id!==d.phoneNumberId||old.waba_id!==d.wabaId||d.accessToken))throw httpError(409,'Use o cadastro incorporado para alterar a conta conectada.','USE_EMBEDDED_SIGNUP');if(!d.accessToken&&(!old||old.phone_number_id!==d.phoneNumberId||old.waba_id!==d.wabaId))throw httpError(400,'Informe o token da conta Meta.','TOKEN_REQUIRED');
  const token=d.accessToken?seal(d.accessToken,secretContext(i,'whatsapp-meta')):old.encrypted_token;
  await c.query(`INSERT INTO bansir.meta_accounts(tenant_id,establishment_id,phone_number_id,waba_id,encrypted_token,display_phone,template_language,voucher_template,delivery_template) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,establishment_id) DO UPDATE SET phone_number_id=EXCLUDED.phone_number_id,waba_id=EXCLUDED.waba_id,encrypted_token=EXCLUDED.encrypted_token,display_phone=EXCLUDED.display_phone,template_language=EXCLUDED.template_language,voucher_template=EXCLUDED.voucher_template,delivery_template=EXCLUDED.delivery_template,enabled=true,updated_at=now()`,[i.tenantId,i.establishmentId,d.phoneNumberId,d.wabaId,token,d.displayPhone,d.language,d.voucherTemplate,d.deliveryTemplate]);return {data:{configured:true,provider:'meta'}};
 }));
 app.post('/api/v1/whatsapp/start',scoped('settings',false,async()=>{throw httpError(409,'Configure WhatsApp Business Platform / Meta. Pareamento Baileys foi removido.','META_SETUP_REQUIRED');}));
 app.post('/api/v1/whatsapp/logout',scoped('settings',false,async(c,req,m)=>{if(!delegatedSetting(m,'settings-whatsapp'))throw httpError(403,'Somente administrador pode desconectar.','FORBIDDEN');await disconnectMeta(c,req.identity,metaConnect);return {data:{disconnected:true}};}));
 app.post('/api/v1/whatsapp/contacts',scoped('settings',false,async(c,req)=>{const d=z.object({phone:z.string().max(40),optIn:z.boolean()}).strict().parse(req.body),i=req.identity,phone=normalizePhone(d.phone);await c.query('INSERT INTO bansir.meta_contacts(tenant_id,establishment_id,phone,opt_in,consent_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,establishment_id,phone) DO UPDATE SET opt_in=EXCLUDED.opt_in,consent_by=EXCLUDED.consent_by,consent_at=now()',[i.tenantId,i.establishmentId,phone,d.optIn,i.userId]);return {data:{phone,optIn:d.optIn}};}));
 app.get('/api/v1/whatsapp/messages',scoped('settings',true,async c=>({data:(await c.query("SELECT message_id,direction,phone,body,status,received_at FROM bansir.meta_messages WHERE message_id NOT LIKE 'attempt:%' AND received_at>=now()-interval '24 hours' ORDER BY received_at DESC LIMIT 50")).rows})));
 app.get('/api/v1/whatsapp/jobs',scoped('settings',true,async c=>({data:(await c.query("SELECT id,state,last_error,created_at FROM bansir.jobs WHERE kind='whatsapp' ORDER BY created_at DESC LIMIT 50")).rows})));
 app.post('/api/v1/whatsapp/messages',scoped('settings',false,async(c,req)=>{const d=z.object({requestKey:z.uuid(),phone:z.string().max(40),message:z.string().trim().min(1).max(1024)}).strict().parse(req.body);const queued=await queueWhatsapp(c,req.identity,{key:'manual:'+d.requestKey,payload:{permission:'settings-whatsapp',action:'send-text',phone:normalizePhone(d.phone),message:d.message}});if(!queued)throw httpError(409,'Configure a conta Meta antes de enviar.','META_SETUP_REQUIRED');return {status:202,data:{queued:true}};}));
}
