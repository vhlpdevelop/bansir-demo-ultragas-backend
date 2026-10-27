import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createECDH} from 'node:crypto';
import pg from 'pg';
import forge from 'node-forge';
import webpush from 'web-push';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {provisionTenant,assignPlan,createEstablishment} from '../src/postgres/provision.js';
import {createAuth} from '../src/postgres/auth.js';
import {createQueue,enqueue} from '../src/postgres/queue.js';
import {deliverNotification,enqueueNotification} from '../src/postgres/notifications.js';
import {processFiscal,runWizard} from '../src/postgres/fiscal.worker.js';
import {issuedTimestamp,accessKey} from '../src/postgres/fiscal.js';
import {unseal,secretContext} from '../src/postgres/secrets.js';

function certificate(password){const keys=forge.pki.rsa.generateKeyPair(2048),cert=forge.pki.createCertificate();cert.publicKey=keys.publicKey;cert.serialNumber='01';cert.validity.notBefore=new Date(Date.now()-60000);cert.validity.notAfter=new Date(Date.now()+86400000*30);cert.setSubject([{name:'commonName',value:'TEST ONLY:11222333000181'}]);cert.setIssuer(cert.subject.attributes);cert.sign(keys.privateKey,forge.md.sha256.create());return forge.util.encode64(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey,[cert],password,{algorithm:'3des'})).getBytes());}
test('Durable workers: unit isolation, certificate encryption, leases and fiscal reconciliation',{skip:!process.env.TEST_WORKER_URL,timeout:90000},async t=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 process.env.FISCAL_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const vapid=webpush.generateVAPIDKeys();Object.assign(process.env,{VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,FISCAL_PRODUCTION_ENABLED:'true'});
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();
 const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL});const queue=createQueue(process.env.TEST_WORKER_URL);
 let server;
 try{
  await queue.ready();
  const password=randomBytes(20).toString('hex'),secret=randomBytes(48).toString('hex');
  const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'workers-test',name:'Workers A',adminName:'Admin',email:'workers@test.invalid',password});
  await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,code:'worker-two',name:'Test',maxEstablishments:2});
  const {rows:[u]}=await admin.query("SELECT id FROM bansir.users WHERE email='workers@test.invalid'");
  const unit2=await createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,name:'Workers B',documentId:'',memberships:[{userId:u.id,role:'operador',allowedRoutes:['sales']}]});
  const identity={tenantId:tenant.id,establishmentId:tenant.establishmentId,userId:u.id};
  const auth=createAuth(db,{jwtSecret:secret});const selection=await auth.login({email:'workers@test.invalid',password});
  const session=await auth.select({selectionToken:selection.selectionToken,tenantId:tenant.id,establishmentId:tenant.establishmentId});
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test'}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const send=async(path,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method,headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const config={cnpj:'11222333000181',legalName:'Test Ltda',tradeName:'Test',ie:'123456789',crt:1,environment:1,series:1,nextNumber:1,cscId:'1',cscToken:'test-csc-token-only-123456',address:{street:'Rua Teste',number:'10',district:'Centro',city:'Cuiaba',cityCode:'5103403',uf:'MT',cep:'78000000',phone:'65999999999'}};
  await t.test('issuer timestamp and access key use the same local month; real SDK rejects an invalid certificate before request',async()=>{
   const issuedAt=issuedTimestamp('America/Cuiaba',new Date('2026-11-01T02:00:00Z'));assert.equal(issuedAt,'2026-10-31T22:00:00-04:00');
   assert.equal(accessKey({uf:'MT',cnpj:config.cnpj,series:1,number:1,issuedAt,code:'00000001'}).slice(2,6),'2610');
   await assert.rejects(runWizard({action:'consult',model:'65',key:'1'.repeat(44),settings:config,certificate:{base64:Buffer.from('INVALID TEST CERT').toString('base64'),password:'test'},csc:config.cscToken}),/WIZARD_SETUP_FAILED/);
   for(const action of ['distribute','science'])await assert.rejects(runWizard({action,model:'55',payload:{ufCode:51,ultNSU:'000000000000000'},settings:config,certificate:{base64:Buffer.from('INVALID TEST CERT').toString('base64'),password:'test'},csc:''}),/WIZARD_SETUP_FAILED/);
  });
  await t.test('certificate required first; valid A1 saved encrypted and metadata only returned',async()=>{
   assert.equal((await send('/fiscal/settings','PUT',config)).status,409);
   assert.equal((await send('/fiscal/certificate','POST',{base64:'invalid',password:'bad'})).status,400);
   const pass='test-pfx-password',base64=certificate(pass);
   assert.equal((await send('/fiscal/certificate','POST',{base64,password:'wrong'})).status,400);
   const uploaded=await send('/fiscal/certificate','POST',{base64,password:pass});assert.equal(uploaded.status,201,JSON.stringify(uploaded.body));
   const stored=(await admin.query('SELECT * FROM bansir.fiscal_certificates WHERE tenant_id=$1',[tenant.id])).rows[0];
   assert.ok(!stored.encrypted_bundle.includes(pass));assert.ok(!stored.encrypted_bundle.includes(base64));
   assert.equal(unseal(stored.encrypted_bundle,secretContext(identity,'certificate')).password,pass);
   assert.throws(()=>unseal(stored.encrypted_bundle,`${tenant.id}/${randomUUID()}/certificate`));
   assert.equal((await send('/fiscal/settings','PUT',config)).status,200);
   const result=await send('/fiscal/settings');assert.equal(result.body.data.settings.cnpj,config.cnpj);assert.ok(!JSON.stringify(result.body).includes(config.cscToken));assert.ok(!JSON.stringify(result.body).includes(pass));
   const selection2=await auth.login({email:'workers@test.invalid',password});const other=await auth.select({selectionToken:selection2.selectionToken,tenantId:tenant.id,establishmentId:unit2.establishmentId});
   const res=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/fiscal/settings`,{headers:{Authorization:`Bearer ${other.token}`}});assert.equal(res.status,403);
   assert.equal((await db.transaction({...identity,establishmentId:unit2.establishmentId},c=>c.query('SELECT * FROM bansir.fiscal_certificates'))).rowCount,0);
  });
  await t.test('outbox rolls back with business event; duplicate keys, concurrent claims and stale leases fenced',async()=>{
   const key=randomUUID();await assert.rejects(db.transaction(identity,async c=>{await enqueueNotification(c,identity,{key,title:'Test',body:'Private'});throw new Error('rollback');}));
   assert.equal((await admin.query('SELECT id FROM bansir.jobs WHERE dedupe_key=$1',[key])).rowCount,0);
   await db.transaction(identity,async c=>{await enqueue(c,identity,{kind:'notification',key,payload:{userId:u.id}});assert.equal(await enqueue(c,identity,{kind:'notification',key,payload:{userId:u.id}}),undefined);});
   // Other integration tests may have notification jobs; select this fixture explicitly by first draining claims.
   let job;for(let n=0;n<30;n++){const current=await queue.claim('notification');if(!current)break;if(current.tenant_id===tenant.id){job=current;break;}await queue.finish(current,'done');}
   assert.ok(job);assert.equal((await queue.pool.query('SELECT id FROM bansir.jobs')).rowCount,0);
   const parallel=await Promise.all([queue.claim('notification'),queue.claim('notification')]);assert.ok(parallel.every(j=>!j||j.id!==job.id));for(const j of parallel)if(j)await queue.finish(j,'done');
   await admin.query("UPDATE bansir.jobs SET leased_until=now()-interval '1 second' WHERE id=$1",[job.id]);
   const reclaimed=await queue.claim('notification');assert.equal(reclaimed.id,job.id);assert.notEqual(reclaimed.lease_token,job.lease_token);
   assert.equal(await queue.finish(job,'done'),false);await assert.rejects(queue.scope(job,async()=>{}),/LEASE_LOST/);assert.equal(await queue.finish(reclaimed,'done'),true);
  });
  await t.test('push expires devices, retries transient failures and rechecks membership',async()=>{
   const ecdh=createECDH('prime256v1');ecdh.generateKeys();
   const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-only',keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
   assert.equal((await send('/notifications/devices/register','POST',{deviceId:'test',pushEnabled:true,subscription})).status,200);
   assert.equal((await send('/notifications/devices/register','POST',{deviceId:'attack',pushEnabled:true,subscription:{...subscription,endpoint:'https://127.0.0.1/private'}})).status,400);
   const id=await db.transaction(identity,c=>enqueueNotification(c,identity,{key:randomUUID(),title:'Private',body:'Sensitive'}));
   let job;do{job=await queue.claim('notification');if(job&&job.id!==id)await queue.finish(job,'done');}while(job&&job.id!==id);
   assert.ok(job);await assert.rejects(deliverNotification(queue,job,{send:async()=>{throw {statusCode:503};}}),/PUSH_RETRY/);
   await deliverNotification(queue,job,{send:async(s,payload)=>{assert.ok(!payload.includes('Sensitive'));throw {statusCode:410};}});
   assert.equal((await admin.query('SELECT enabled FROM bansir.push_devices WHERE tenant_id=$1',[tenant.id])).rows[0].enabled,false);
   await admin.query('UPDATE bansir.establishment_memberships SET active=false WHERE tenant_id=$1 AND establishment_id=$2',[tenant.id,tenant.establishmentId]);
   let calls=0;await deliverNotification(queue,job,{send:async()=>calls++});assert.equal(calls,0);
   await admin.query('UPDATE bansir.establishment_memberships SET active=true WHERE tenant_id=$1 AND establishment_id=$2',[tenant.id,tenant.establishmentId]);await queue.finish(job,'done');
  });
  const draft={det:[{prod:{cProd:'TEST',xProd:'Test gas',NCM:'27111910',CFOP:'5656',qCom:1,vUnCom:100,vProd:100,cEAN:'SEM GTIN',uCom:'UN',cEANTrib:'SEM GTIN',uTrib:'UN',qTrib:1,vUnTrib:100,indTot:1},imposto:{ICMS:{testOnly:true},PIS:{testOnly:true},COFINS:{testOnly:true}}}],total:{ICMSTot:{vNF:100,vProd:100}},pag:{detPag:[{tPag:'01',vPag:100}]}};
  await t.test('fiscal idempotency, production environment, uncertain sends consult only; S3 retry never re-emits',async()=>{
   const requestKey=randomUUID();const created=await send('/fiscal/documents','POST',{requestKey,draft});assert.equal(created.status,202,JSON.stringify(created.body));const docId=created.body.data.id;
   assert.equal((await send('/fiscal/documents','POST',{requestKey,draft})).body.data.id,docId);
   assert.equal((await send('/fiscal/documents','POST',{requestKey,draft:{...draft,transp:{modFrete:9}}})).status,409);
   let job=await queue.claim('fiscal');assert.equal(job.payload.documentId,docId);
   let emissions=0,consultations=0;
   await assert.rejects(processFiscal(queue,job,{wizard:async m=>{assert.equal(m.settings.environment,1);assert.equal(m.settings.address.uf,'MT');assert.equal(m.action,'emit');emissions++;throw new Error('network timeout');}}),/FISCAL_CONSULT_REQUIRED/);
   assert.equal((await admin.query('SELECT status FROM bansir.fiscal_documents WHERE id=$1',[docId])).rows[0].status,'unknown');
   const doc=(await admin.query('SELECT * FROM bansir.fiscal_documents WHERE id=$1',[docId])).rows[0];
   const xml=`<nfeProc><NFe><infNFe Id="NFe${doc.access_key}"/></NFe><protNFe><infProt><tpAmb>1</tpAmb><chNFe>${doc.access_key}</chNFe><cStat>100</cStat><nProt>151000000000001</nProt></infProt></protNFe></nfeProc>`;
   const wizard=async m=>{assert.equal(m.action,'consult');consultations++;return {result:{},xml};};
   await assert.rejects(processFiscal(queue,job,{wizard,upload:async()=>{throw new Error('S3 offline');}}),/S3 offline/);
   const durable=(await admin.query('SELECT * FROM bansir.fiscal_documents WHERE id=$1',[docId])).rows[0];assert.equal(durable.status,'authorized');assert.equal(durable.xml,xml);
   await processFiscal(queue,job,{wizard:async()=>{throw new Error('MUST NOT CALL SEFAZ');},upload:async(j,d)=>{assert.equal(d.xml,xml);return `tenants/${j.tenant_id}/authorized.xml`;}});
   assert.equal(emissions,1);assert.equal(consultations,1);assert.ok((await admin.query('SELECT s3_key FROM bansir.fiscal_documents WHERE id=$1',[docId])).rows[0].s3_key);await queue.finish(job,'done');
   assert.equal((await send(`/fiscal/documents/${docId}/xml`)).body.data.xml,xml);
   await assert.rejects(admin.query(`INSERT INTO bansir.fiscal_documents(tenant_id,establishment_id,request_key,environment,access_key,payload,configuration_version,certificate_fingerprint)
    SELECT tenant_id,establishment_id,$2,environment,overlay(access_key placing '99999999' from 36 for 8),payload,configuration_version,certificate_fingerprint FROM bansir.fiscal_documents WHERE id=$1`,[docId,randomUUID()]),e=>e.code==='23505');
   const configuration=await send('/fiscal/settings');assert.equal(configuration.body.data.settings.nextNumber,2);
   assert.equal((await send('/fiscal/settings','PUT',{...config,nextNumber:1})).status,409);
  });
  await t.test('changed configuration requires review; production gate rejects enqueue and cannot silently become homologation',async()=>{
   const result=await send('/fiscal/documents','POST',{requestKey:randomUUID(),draft});assert.equal(result.status,202);
   assert.equal((await send('/fiscal/settings','PUT',{...config,legalName:'Configuration changed',nextNumber:3})).status,200);
   const job=await queue.claim('fiscal');assert.equal(job.payload.documentId,result.body.data.id);
   await processFiscal(queue,job,{wizard:async()=>{throw new Error('MUST NOT EMIT');}});
   assert.equal((await admin.query('SELECT status FROM bansir.fiscal_documents WHERE id=$1',[result.body.data.id])).rows[0].status,'manual_review');await queue.finish(job,'done');
   process.env.FISCAL_PRODUCTION_ENABLED='false';assert.equal((await send('/fiscal/documents','POST',{requestKey:randomUUID(),draft})).status,409);process.env.FISCAL_PRODUCTION_ENABLED='true';
  });
 }finally{if(server)await new Promise(r=>server.close(r));await Promise.all([queue.close(),db.close(),admin.end()]);}
});

