import {createHmac} from 'node:crypto';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function makeConnect({appId,cellId,queueUrl,version,secrets,reserve,activate,disable,transport=fetch}){
 return async input=>{try{
  if(!uuid(input?.tenantId)||!uuid(input.establishmentId)||!uuid(input.attemptId))throw Error('INVALID_CONTEXT');
  const context={tenantId:input.tenantId,establishmentId:input.establishmentId,connectionId:input.attemptId,cellId};
  if(['activate','disconnect'].includes(input.action)){
   if(!/^\d{5,30}$/.test(input.phoneNumberId||''))throw Error('INVALID_PHONE');
   await (input.action==='activate'?activate:disable)(input.phoneNumberId,context);return {ok:true};
  }
  if(input.action!=='exchange'||typeof input.code!=='string'||input.code.length<10||input.code.length>4096)throw Error('INVALID_CODE');
  if(!/^v\d+\.\d+$/.test(version))throw Error('INVALID_VERSION');
  const {appSecret}=await secrets();if(!appSecret)throw Error('MISSING_APP_SECRET');
  async function graph(path,{token,params={},method='GET'}={}){
   const u=new URL(`https://graph.facebook.com/${version}/${path}`);
   if(token&&!path.startsWith('debug_token'))params.appsecret_proof=createHmac('sha256',appSecret).update(token).digest('hex');
   for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
   const r=await transport(u,{method,headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(8000),redirect:'error'});
   if(!r.ok)throw Error('META_REQUEST_REJECTED');const b=await r.json();if(b?.error)throw Error('META_REQUEST_REJECTED');return b;
  }
  const auth=await graph('oauth/access_token',{params:{client_id:appId,client_secret:appSecret,code:input.code}}),token=auth.access_token;
  if(typeof token!=='string'||token.length<20)throw Error('INVALID_TOKEN');
  const {data:debug}=await graph('debug_token',{token:appId+'|'+appSecret,params:{input_token:token}});
  if(!debug?.is_valid||String(debug.app_id)!==appId||debug.expires_at&&debug.expires_at*1000<Date.now())throw Error('INVALID_TOKEN');
  if(!['whatsapp_business_management','whatsapp_business_messaging'].every(s=>debug.scopes?.includes(s)))throw Error('MISSING_PERMISSIONS');
  const wabas=[...new Set((debug.granular_scopes||[]).filter(s=>['whatsapp_business_management','whatsapp_business_messaging','business_management'].includes(s.scope)).flatMap(s=>s.target_ids||[]).map(String))].filter(id=>/^\d{5,30}$/.test(id));
  const waba=input.wabaId|| (wabas.length===1?wabas[0]:null);if(!waba||!wabas.includes(waba))throw Error('SELECT_AUTHORIZED_WABA');
  const phones=await graph(waba+'/phone_numbers',{token,params:{fields:'id,display_phone_number,verified_name',limit:'100'}});
  const phone=(phones.data||[]).find(p=>input.phoneNumberId?p.id===input.phoneNumberId:phones.data.length===1);if(!phone)throw Error('SELECT_AUTHORIZED_PHONE');
  const subscription=await graph(waba+'/subscribed_apps',{token,method:'POST'});if(subscription.success!==true)throw Error('SUBSCRIPTION_FAILED');
  await reserve(phone.id,{...context,wabaId:waba,queueUrl,enabled:false});
  return {ok:true,token,wabaId:waba,phoneNumberId:phone.id,displayPhone:phone.display_phone_number||'',expiresAt:debug.expires_at||null};
 }catch(e){return {ok:false,code:['MISSING_PERMISSIONS','SELECT_AUTHORIZED_WABA','SELECT_AUTHORIZED_PHONE'].includes(e.message)?e.message:'META_CONNECTION_FAILED'};}};
}
