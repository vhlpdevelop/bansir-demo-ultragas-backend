import {SecretsManagerClient,GetSecretValueCommand} from '@aws-sdk/client-secrets-manager';

const TTL_MS=5*60*1000;
let cached=null,inflight=null;

export function clearMetaWebhookSecretsCache(){
 cached=null;
 inflight=null;
}

function parseMetaSecret(raw,env){
 let parsed={};
 if(typeof raw==='string'&&raw.trim()){
  try{parsed=JSON.parse(raw);}catch{parsed={};}
 }
 return {
  appSecret:String(parsed.META_APP_SECRET||parsed.appSecret||parsed.app_secret||parsed.metaAppSecret||env.META_APP_SECRET||''),
  verifyToken:String(parsed.META_VERIFY_TOKEN||parsed.verifyToken||parsed.verify_token||parsed.metaVerifyToken||env.META_VERIFY_TOKEN||'')
 };
}

async function defaultFetchSecret(secretId,region){
 const client=new SecretsManagerClient({region:region||'sa-east-1'});
 const response=await client.send(new GetSecretValueCommand({SecretId:secretId}));
 return response.SecretString||'';
}

export async function getMetaWebhookSecrets({env=process.env,fetchSecret=defaultFetchSecret,now=Date.now}={}){
 if(env.META_APP_SECRET&&env.META_VERIFY_TOKEN){
  return {appSecret:String(env.META_APP_SECRET),verifyToken:String(env.META_VERIFY_TOKEN)};
 }
 const secretId=String(env.META_SECRET_ID||env.META_SECRETS_ARN||'').trim();
 if(!secretId){
  return {appSecret:String(env.META_APP_SECRET||''),verifyToken:String(env.META_VERIFY_TOKEN||'')};
 }
 const useDefaultCache=env===process.env&&fetchSecret===defaultFetchSecret;
 if(useDefaultCache&&cached&&cached.secretId===secretId&&cached.expiresAt>now()){
  return cached.value;
 }
 const load=async()=>{
  const raw=await fetchSecret(secretId,env.AWS_REGION);
  const value=parseMetaSecret(raw,env);
  if(useDefaultCache)cached={secretId,value,expiresAt:now()+TTL_MS};
  return value;
 };
 if(!useDefaultCache)return load();
 if(!inflight)inflight=load().finally(()=>{inflight=null;});
 return inflight;
}
