import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {seal,secretContext} from '../src/postgres/secrets.js';
import {processMetaJob} from '../src/postgres/meta-delivery.js';
import {getMetaWebhookSecrets} from '../src/postgres/meta-secrets.js';

const TENANT_ID='11111111-1111-4111-8111-111111111111';
const ESTABLISHMENT_ID='22222222-2222-4222-8222-222222222222';
const USER_ID='33333333-3333-4333-8333-333333333333';

function makeQueue({recent=1,optIn=true,greetingMessage='Olá!'}={}){
 process.env.FISCAL_ENCRYPTION_KEY=process.env.FISCAL_ENCRYPTION_KEY||randomBytes(32).toString('base64');
 const encryptedToken=seal('test-meta-token',secretContext({tenantId:TENANT_ID,establishmentId:ESTABLISHMENT_ID},'whatsapp-meta'));
 const account={phone_number_id:'1234567890',waba_id:'9876543210',encrypted_token:encryptedToken,template_language:'pt_BR',delivery_template:'delivery_tpl',voucher_template:'voucher_tpl'};
 const queries=[];
 return {
  queries,
  async scope(_job,fn){
   const c={
    async query(sql){
     queries.push(sql);
     if(sql.includes('bansir.tenant_features()'))return {rows:[{features:{whatsapp:true,orderLink:true}}],rowCount:1};
     if(sql.includes('bansir.meta_sender_active'))return {rows:[{allowed:true}],rowCount:1};
     if(sql.includes('FROM bansir.meta_accounts'))return {rows:[account],rowCount:1};
     if(sql.includes('FROM bansir.meta_messages WHERE job_id'))return {rows:[],rowCount:0};
     if(sql.includes("direction='in'")&&sql.includes("interval '24 hours'"))return {rows:recent?[{1:1}]:[],rowCount:recent};
     if(sql.includes('FROM bansir.meta_contacts'))return {rows:optIn===undefined?[]:[{opt_in:optIn}],rowCount:optIn===undefined?0:1};
     if(sql.includes('bansir.whatsapp_business_calendar()'))return {rows:[{config:{businessHours:{enabled:false}}}],rowCount:1};
     if(sql.includes('FROM bansir.meta_greetings'))return {rows:[{enabled:true,sender_user_id:USER_ID,message:greetingMessage,recipient_filter:null}],rowCount:1};
     return {rows:[],rowCount:0};
    }
   };
   return fn(c);
  }
 };
}

test('auto-greeting with https link sends interactive cta_url button',async()=>{
 const message='Olá! Faça seu pedido pelo link: https://loja.bansir.com.br/loja/gas-central.';
 const queue=makeQueue({greetingMessage:message});
 const calls=[];
 const transport=async(url,init)=>{
  calls.push({url,body:JSON.parse(init.body)});
  return {ok:true,status:200,async text(){return JSON.stringify({messages:[{id:'wamid.greeting1'}]});}};
 };
 await processMetaJob(queue,{id:1,tenant_id:TENANT_ID,establishment_id:ESTABLISHMENT_ID,payload:{action:'auto-greeting',userId:USER_ID,permission:'settings',metaPhoneId:'1234567890',metaWabaId:'9876543210',phone:'5566999998888',message}},{transport,version:'v22.0'});
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.type,'interactive');
 assert.equal(calls[0].body.interactive.type,'cta_url');
 assert.equal(calls[0].body.interactive.action.parameters.display_text,'Fazer pedido');
 assert.equal(calls[0].body.interactive.action.parameters.url,'https://loja.bansir.com.br/loja/gas-central');
});

test('auto-greeting without link falls back to plain text',async()=>{
 const message='Olá! Em que podemos ajudar hoje?';
 const queue=makeQueue({greetingMessage:message});
 const calls=[];
 const transport=async(url,init)=>{
  calls.push({url,body:JSON.parse(init.body)});
  return {ok:true,status:200,async text(){return JSON.stringify({messages:[{id:'wamid.greeting2'}]});}};
 };
 await processMetaJob(queue,{id:2,tenant_id:TENANT_ID,establishment_id:ESTABLISHMENT_ID,payload:{action:'auto-greeting',userId:USER_ID,permission:'settings',metaPhoneId:'1234567890',metaWabaId:'9876543210',phone:'5566999998888',message}},{transport,version:'v22.0'});
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.type,'text');
 assert.equal(calls[0].body.text.body,message);
});

test('storefront-status sends text inside 24h window and skips outside or opted-out',async()=>{
 const calls=[];
 const transport=async(url,init)=>{
  calls.push({url,body:JSON.parse(init.body)});
  return {ok:true,status:200,async text(){return JSON.stringify({messages:[{id:'wamid.status1'}]});}};
 };
 await processMetaJob(makeQueue({recent:1,optIn:true}),{id:3,tenant_id:TENANT_ID,establishment_id:ESTABLISHMENT_ID,payload:{action:'storefront-status',userId:USER_ID,permission:'sales',metaPhoneId:'1234567890',metaWabaId:'9876543210',phone:'5566999998888',message:'Seu pedido saiu para entrega!'}},{transport,version:'v22.0'});
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.type,'text');
 assert.equal(calls[0].body.text.body,'Seu pedido saiu para entrega!');

 const skippedOutside=await processMetaJob(makeQueue({recent:0,optIn:true}),{id:4,tenant_id:TENANT_ID,establishment_id:ESTABLISHMENT_ID,payload:{action:'storefront-status',userId:USER_ID,permission:'sales',metaPhoneId:'1234567890',metaWabaId:'9876543210',phone:'5566999998888',message:'Seu pedido saiu para entrega!'}},{transport,version:'v22.0'});
 assert.deepEqual(skippedOutside,{skipped:true});

 const skippedOptOut=await processMetaJob(makeQueue({recent:1,optIn:false}),{id:5,tenant_id:TENANT_ID,establishment_id:ESTABLISHMENT_ID,payload:{action:'storefront-status',userId:USER_ID,permission:'sales',metaPhoneId:'1234567890',metaWabaId:'9876543210',phone:'5566999998888',message:'Seu pedido saiu para entrega!'}},{transport,version:'v22.0'});
 assert.deepEqual(skippedOptOut,{skipped:true});
 assert.equal(calls.length,1);
});

test('migration 084 defines storefront whatsapp helper and deliveries sender permission',async()=>{
 const sql=await fs.readFile(new URL('../migrations/postgres/084_storefront_whatsapp_status.sql',import.meta.url),'utf8');
 assert.match(sql,/enqueue_storefront_whatsapp/i);
 assert.match(sql,/SECURITY DEFINER/i);
 assert.match(sql,/GRANT EXECUTE[\s\S]*TO bansir_storefront/i);
 assert.match(sql,/'deliveries'/);
});

test('getMetaWebhookSecrets reads from AWS Secrets Manager when META_SECRET_ID is set',async()=>{
 const fromCamel=await getMetaWebhookSecrets({
  env:{META_SECRET_ID:'bansir/meta',AWS_REGION:'sa-east-1'},
  fetchSecret:async(secretId,region)=>{
   assert.equal(secretId,'bansir/meta');
   assert.equal(region,'sa-east-1');
   return JSON.stringify({appSecret:'sec_123',verifyToken:'ver_456'});
  }
 });
 assert.deepEqual(fromCamel,{appSecret:'sec_123',verifyToken:'ver_456'});

 const fromEnvKeys=await getMetaWebhookSecrets({
  env:{META_SECRET_ID:'bansir/meta'},
  fetchSecret:async()=>JSON.stringify({META_APP_SECRET:'sec_abc',META_VERIFY_TOKEN:'ver_xyz'})
 });
 assert.deepEqual(fromEnvKeys,{appSecret:'sec_abc',verifyToken:'ver_xyz'});

 const direct=await getMetaWebhookSecrets({
  env:{META_APP_SECRET:'env_sec',META_VERIFY_TOKEN:'env_ver',META_SECRET_ID:'bansir/meta'},
  fetchSecret:async()=>{throw new Error('should not be called');}
 });
 assert.deepEqual(direct,{appSecret:'env_sec',verifyToken:'env_ver'});
});

