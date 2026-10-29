import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {createAuth} from '../src/postgres/auth.js';
import {provisionTenant,assignPlan,createEstablishment} from '../src/postgres/provision.js';
import {createQueue} from '../src/postgres/queue.js';
import {processMetaJob} from '../src/postgres/meta-delivery.js';

test('Meta, paid vouchers and fleet: transactional financial flow and unit isolation',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async t=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();
 const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL,max:8}),queue=createQueue(process.env.TEST_WORKER_URL);let server;
 const previous={...process.env};
 try{
  process.env.META_EMBEDDED_SIGNUP_ENABLED='true';process.env.META_APP_ID='12345';process.env.META_EMBEDDED_SIGNUP_CONFIG_ID='67890';process.env.META_GRAPH_VERSION='v25.0';process.env.META_CONNECT_FUNCTION_ARN='test-only';
  process.env.FISCAL_ENCRYPTION_KEY=randomBytes(32).toString('base64');process.env.META_APP_SECRET=randomBytes(32).toString('hex');process.env.META_VERIFY_TOKEN=randomUUID();
  const password=randomBytes(20).toString('hex'),secret=randomBytes(48).toString('hex');
  const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'meta-vouchers',name:'Vouchers',adminName:'Owner',email:'vouchers@test.invalid',password});
  const user=(await admin.query("SELECT id,password_hash FROM bansir.users WHERE email='vouchers@test.invalid'")).rows[0];
  await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,code:'voucher-two',name:'Test',maxEstablishments:2});
  const other=await createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,name:'Other',memberships:[{userId:user.id,role:'admin',allowedRoutes:[]}]});
  const driver=randomUUID();await admin.query("INSERT INTO bansir.users(id,email,name,password_hash) VALUES($1,'voucher-driver@test.invalid','Driver',$2)",[driver,user.password_hash]);
  await admin.query("INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes) VALUES($1,$2,'entregador',ARRAY['valegas-redeem'])",[tenant.id,driver]);
  await admin.query("INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes) VALUES($1,$2,$3,'entregador',ARRAY['valegas-redeem'])",[tenant.id,tenant.establishmentId,driver]);
  let exchanges=0,activations=0,failActivation=true;
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test',metaConnect:async b=>{if(b.action==='exchange'){exchanges++;return {ok:true,token:'TEST_ONLY_TOKEN_FOR_ONBOARDING',phoneNumberId:'123456789012345',wabaId:'987654321012345',displayPhone:'TEST'};}if(b.action==='activate'){activations++;if(failActivation){failActivation=false;throw Object.assign(Error('Simulated failure'),{status:409});}}return {ok:true};}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const auth=createAuth(db,{jwtSecret:secret});const login=async unit=>{const s=await auth.login({email:'vouchers@test.invalid',password});return auth.select({selectionToken:s.selectionToken,tenantId:tenant.id,establishmentId:unit});};
  const session=await login(tenant.establishmentId),otherSession=await login(other.establishmentId),driverSession=await auth.login({email:'voucher-driver@test.invalid',password});
  const send=async(path,method='GET',body,token=session.token)=>{const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const product=(await send('/products','POST',{name:'Gas voucher',barcode:'VOUCHER-1',price:150,stock:20})).body.data;
  const stock=async()=>Number((await admin.query('SELECT stock FROM bansir.products WHERE id=$1',[product.id])).rows[0].stock);
  const input=()=>({requestKey:randomUUID(),customerName:'Voucher Buyer',customerPhone:'65999999999',items:[{product:product.id,productName:product.name,quantity:1,price:150}],totalAmount:150,payment:{method:'cash',confirmed:true,receivedCents:15000}});
  let voucher;
  await t.test('fleet DELETE grant, CRUD and cross-unit protection',async()=>{
   const v=await send('/fleet/vehicles','POST',{code:'TRUCK-1',name:'Truck'});assert.equal(v.status,201,JSON.stringify(v));
   assert.equal((await send('/fleet/vehicles','GET',undefined,otherSession.token)).body.data.length,0);
   assert.equal((await send(`/fleet/vehicles/${v.body.data.id}`,'DELETE',undefined,otherSession.token)).status,404);
   assert.equal((await send(`/fleet/vehicles/${v.body.data.id}`,'DELETE')).status,200);
   assert.equal((await send('/fleet/vehicles','GET',undefined,driverSession.token)).status,403);
  });
  await t.test('fleet scheduler warns once, escalates overdue, respects units and private deletion',async()=>{
   const v=(await send('/fleet/vehicles','POST',{code:'ALERT',name:'Delivery truck',currentKm:9600,maintenanceRules:[{name:'Oil',intervalKm:10000,lastServiceKm:0}]})).body.data;
   await queue.pool.query('SELECT bansir.schedule_fleet_alerts()');await queue.pool.query('SELECT bansir.schedule_fleet_alerts()');
   const alerts=()=>admin.query("SELECT * FROM bansir.notifications WHERE tenant_id=$1 AND body LIKE 'Delivery truck%'",[tenant.id]);
   assert.equal((await alerts()).rowCount,1);assert.match((await alerts()).rows[0].body,/400 km/);
   assert.equal((await alerts()).rows[0].user_id,user.id);
   assert.equal((await send('/notifications','GET',undefined,otherSession.token)).body.data.length,0);
   assert.equal((await send('/notifications','GET',undefined,driverSession.token)).body.data.length,0);
   await admin.query('UPDATE bansir.vehicles SET current_km=10000 WHERE id=$1',[v.id]);
   await queue.pool.query('SELECT bansir.schedule_fleet_alerts()');assert.equal((await alerts()).rowCount,2);
   const id=(await alerts()).rows[0].id;
   await send('/notifications/'+id,'DELETE',undefined,otherSession.token);assert.equal((await alerts()).rowCount,2);
   await send('/notifications/'+id,'DELETE',undefined,driverSession.token);assert.equal((await alerts()).rowCount,2);
   assert.equal((await send('/notifications/'+id,'DELETE')).status,200);assert.equal((await alerts()).rowCount,1);
   await queue.pool.query('SELECT bansir.schedule_fleet_alerts()');assert.equal((await alerts()).rowCount,1);
   await admin.query("UPDATE bansir.vehicles SET maintenance_rules='[]' WHERE id=$1",[v.id]);
   await queue.pool.query('SELECT bansir.schedule_fleet_alerts()');assert.equal((await alerts()).rowCount,1);
  });
  await t.test('payment is required at issuance, and concurrent retries reserve stock and receive cash once',async()=>{
   assert.equal((await send('/vouchers','POST',input())).status,409);assert.equal(await stock(),20);
   await send('/pdv/cash/open','POST',{openingCents:0});
   assert.equal((await send('/vouchers','POST',{...input(),payment:{method:'pending',term:'pickup'}})).status,400);
   assert.equal((await send('/vouchers','POST',{...input(),payment:{method:'cash',confirmed:false,receivedCents:15000}})).status,400);
   assert.equal((await send('/vouchers','POST',{...input(),payment:{method:'cash',confirmed:true,receivedCents:100}})).status,400);
   assert.equal((await send('/vouchers','POST',input(),driverSession.token)).status,403);
   const body=input(),results=await Promise.all(Array.from({length:4},()=>send('/vouchers','POST',body)));assert.ok(results.every(r=>[200,201].includes(r.status)),JSON.stringify(results));
   assert.equal(new Set(results.map(r=>r.body.data.id)).size,1);voucher=results[0].body.data;assert.equal(voucher.customerName,'Voucher Buyer');assert.equal(voucher.issuedByName,'Owner');assert.ok(voucher.saleId);assert.equal(await stock(),19);
   const sale=(await send(`/sales/${voucher.saleId}`)).body.data;assert.equal(sale.status,'paid');assert.equal(sale.payments.length,1);assert.equal((await send('/pdv/cash')).body.data.expected_cents,15000);
   assert.equal((await send('/vouchers','POST',{...body,customerName:'Different'})).status,409);
   assert.equal((await admin.query('SELECT id FROM bansir.vouchers WHERE request_key=$1',[body.requestKey])).rowCount,1);
   assert.equal((await admin.query('SELECT id FROM bansir.stock_movements WHERE reason=$1',[`Reserva vale ${voucher.saleId}`])).rowCount,1);
  });
  await t.test('redemption delivers once without charging or reducing stock again; cancellation refunds and reconciles',async()=>{
   const lookup=await send('/vouchers/'+voucher.code,'GET',undefined,driverSession.token);assert.equal(lookup.status,200);assert.equal(lookup.body.data.redeemable,true);assert.equal('totalAmount' in lookup.body.data,false);assert.equal('price' in lookup.body.data.items[0],false);
   assert.equal((await send('/vouchers','GET',undefined,driverSession.token)).body.data.length,0);
   await admin.query("UPDATE bansir.establishment_memberships SET allowed_routes=ARRAY['valegas-issue','valegas-redeem'] WHERE user_id=$1",[driver]);
   assert.equal((await send('/vouchers','POST',input(),driverSession.token)).status,403);
   const dashboard=await send('/dashboard?timezone=America/Cuiaba');assert.equal(dashboard.status,200,JSON.stringify(dashboard));assert.equal(dashboard.body.data.revenue,150);assert.equal(dashboard.body.data.vouchers.active,1);assert.equal(dashboard.body.data.ticket,150);assert.equal(dashboard.body.data.daily.length,7);assert.equal(dashboard.body.data.topProducts[0].units,1);
   assert.equal((await send('/dashboard','GET',undefined,otherSession.token)).body.data.revenue,0);
   assert.equal((await send('/dashboard?timezone=INVALID')).status,400);
   assert.equal((await send(`/vouchers/${voucher.code}`,'GET',undefined,otherSession.token)).status,404);
   assert.equal((await send(`/vouchers/${voucher.code}/redeem`,'POST',{},otherSession.token)).status,404);
   const r=await send(`/vouchers/${voucher.code}/redeem`,'POST',{},driverSession.token);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.status,'REDEEMED');assert.equal(r.body.data.redeemedByName,'Driver');
   assert.equal((await send(`/vouchers/${voucher.code}/redeem`,'POST',{},driverSession.token)).status,200);assert.equal(await stock(),19);assert.equal((await send('/pdv/cash')).body.data.expected_cents,15000);
   assert.equal((await send(`/sales/${voucher.saleId}/cancel`,'POST',{reason:'Test voucher refund',refundConfirmed:true})).status,200);
   assert.equal((await send(`/vouchers/${voucher.code}`)).body.data.status,'CANCELLED');assert.equal((await send('/dashboard')).body.data.revenue,0);assert.equal((await send('/dashboard')).body.data.vouchers.active,0);assert.equal((await send('/vouchers/'+voucher.code,'GET',undefined,driverSession.token)).body.data.redeemable,false);assert.equal((await send(`/vouchers/${voucher.code}/redeem`,'POST',{})).status,409);assert.equal(await stock(),20);assert.equal((await send('/pdv/cash')).body.data.expected_cents,0);
  });
  await t.test('legacy vouchers require reconciliation and normal sale UUID cannot issue a second entitlement',async()=>{
   await admin.query("INSERT INTO bansir.vouchers(tenant_id,establishment_id,code,customer_name,customer_phone,items,total_cents,issued_by) VALUES($1,$2,'VGL-LEGACY','Legacy','5565999999999','[]',15000,$3)",[tenant.id,tenant.establishmentId,user.id]);
   const legacy=await send('/vouchers/VGL-LEGACY/redeem','POST',{});assert.equal(legacy.status,409);assert.equal(legacy.body.code,'VOUCHER_RECONCILIATION_REQUIRED');
   const body=input(),sale=await send('/sales','POST',{requestKey:body.requestKey,items:[{productId:product.id,quantity:1,expectedUnitPriceCents:15000}],payment:body.payment});assert.equal(sale.status,201);assert.equal((await send('/vouchers','POST',body)).status,409);
   await send(`/sales/${sale.body.data.id}/cancel`,'POST',{reason:'Test normal sale refund',refundConfirmed:true});
  });
  const account={phoneNumberId:'123456789012345',wabaId:'987654321012345',accessToken:'TEST_ONLY_'+randomBytes(20).toString('hex'),voucherTemplate:'voucher_test',deliveryTemplate:'delivery_test'};
  await t.test('Meta settings encrypt the token, isolate accounts and remove QR pairing',async()=>{
   assert.equal((await send('/whatsapp/meta','PUT',account)).status,200);const status=await send('/whatsapp/status');assert.equal(status.body.data.provider,'meta');assert.equal(status.body.data.status,'CONFIGURED');assert.ok(!JSON.stringify(status).includes(account.accessToken));
   const stored=(await admin.query('SELECT encrypted_token FROM bansir.meta_accounts WHERE tenant_id=$1',[tenant.id])).rows[0];assert.ok(!stored.encrypted_token.includes(account.accessToken));assert.equal((await send('/whatsapp/status','GET',undefined,otherSession.token)).body.data.status,'NOT_CONFIGURED');assert.equal((await send('/whatsapp/start','POST',{})).status,409);
  });
  const webhook=async body=>{const raw=JSON.stringify(body),signature='sha256='+createHmac('sha256',process.env.META_APP_SECRET).update(raw).digest('hex');return fetch(base+'/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-hub-signature-256':signature},body:raw});};
  const inbound=(id,phone='5565988888888')=>({object:'whatsapp_business_account',entry:[{id:account.wabaId,changes:[{field:'messages',value:{metadata:{phone_number_id:account.phoneNumberId},messages:[{id,from:phone,timestamp:String(Math.floor(Date.now()/1000)),text:{body:'Test message'}}]}}]}]});
  await t.test('signed raw webhooks deduplicate incoming messages and reject unverified or foreign events',async()=>{
   const invalid=await fetch(base+'/whatsapp/webhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(inbound('wamid.invalid'))});assert.equal(invalid.status,403);
   const challenge=await fetch(base+'/whatsapp/webhook?hub.mode=subscribe&hub.verify_token='+process.env.META_VERIFY_TOKEN+'&hub.challenge=123');assert.equal(await challenge.text(),'123');
   assert.equal((await webhook(null)).status,400);assert.equal((await webhook(inbound('wamid.inbound'))).status,200);assert.equal((await webhook(inbound('wamid.inbound'))).status,200);
   const wrong=inbound('wamid.foreign');wrong.entry[0].id='12345';assert.equal((await webhook(wrong)).status,200);
   assert.equal((await admin.query("SELECT message_id FROM bansir.meta_messages WHERE message_id='wamid.inbound'")).rowCount,1);assert.equal((await admin.query("SELECT message_id FROM bansir.meta_messages WHERE message_id='wamid.foreign'")).rowCount,0);assert.deepEqual((await send('/whatsapp/messages','GET',undefined,otherSession.token)).body.data,[]);
  });
  assert.equal((await queue.pool.query('SELECT * FROM bansir.meta_cell_receiver($1,$2)',[account.phoneNumberId,account.wabaId])).rows[0].establishment_id,tenant.establishmentId);
  assert.equal((await queue.pool.query('SELECT * FROM bansir.meta_cell_receiver($1,$2)',[account.phoneNumberId,'wrong'])).rowCount,0);
  await queue.ready();const createJob=async(phone)=>{assert.equal((await send('/whatsapp/messages','POST',{requestKey:randomUUID(),phone,message:'Hello test'})).status,202);const j=await queue.claim('whatsapp');assert.ok(j);return j;};
  const finish=job=>queue.finish(job,'done');
  await t.test('greeting outbox is isolated, deduplicated, rate limited and disabled before sending',async()=>{
   const cfg={enabled:true,message:'Olá! Faça seu pedido pelo link de teste.'};
   assert.equal((await send('/whatsapp/greeting','PUT',cfg,driverSession.token)).status,403);
   assert.equal((await send('/whatsapp/greeting','PUT',cfg)).status,200);
   assert.equal((await send('/whatsapp/greeting','GET',undefined,otherSession.token)).body.data.enabled,false);
   const inbound=async(mid,phone='556577777777',text='Olá!',date=new Date())=>admin.query('SELECT bansir.meta_ingest($1,$2,$3,$4,$5,$6,$7,$8)',[account.phoneNumberId,account.wabaId,mid,'in',phone,text,'received',date]);
   await inbound('wamid.greeting');await inbound('wamid.greeting');await Promise.all([inbound('wamid.greeting2'),inbound('wamid.greeting3')]);
   const jobs=(await admin.query("SELECT id FROM bansir.jobs WHERE payload->>'action'='auto-greeting'")).rows;assert.equal(jobs.length,1);
   const j=await queue.claim('whatsapp');assert.equal(j.id,jobs[0].id);assert.equal(j.payload.phone,'5565977777777');let calls=0;
   await processMetaJob(queue,j,{version:'v99.0',transport:async(_u,o)=>{calls++;assert.equal(JSON.parse(o.body).text.body,cfg.message);return new Response(JSON.stringify({messages:[{id:'wamid.greeting.sent'}]}),{status:200});}});assert.equal(calls,1);await finish(j);
   assert.equal((await send('/whatsapp/messages')).body.data.find(m=>m.message_id==='wamid.greeting.sent').body,cfg.message);
   await inbound('wamid.greeting.old','5565966666666','oi',new Date(Date.now()-3600000));assert.equal((await queue.claim('whatsapp')),undefined);
   await inbound('wamid.greeting.new','5565966666666');const stale=await queue.claim('whatsapp');assert.ok(stale);
   await send('/whatsapp/greeting','PUT',{...cfg,enabled:false});await assert.rejects(processMetaJob(queue,stale,{version:'v99.0'}),/META_GREETING_DISABLED/);await queue.finish(stale,'dead','META_GREETING_DISABLED');
  });
  await t.test('closed-hour greetings are kept without consuming cooldown and worker rechecks calendar',async()=>{
   const hours={enabled:true,ignoreWhatsappOutsideHours:true,closingSoonMinutes:30,days:Array.from({length:7},(_,day)=>({day,enabled:false,open:'08:00',close:'18:00'}))};
   const config={acceptingOrders:true,timeZone:'America/Cuiaba',businessHours:hours};
   await admin.query("INSERT INTO bansir.storefronts(tenant_id,establishment_id,slug,config) VALUES($1,$2,'meta-calendar-test',$3)",[tenant.id,tenant.establishmentId,config]);
   await send('/whatsapp/greeting','PUT',{enabled:true,message:'Calendar greeting'});
   const phone='5565955554444';const inbound=mid=>admin.query('SELECT bansir.meta_ingest($1,$2,$3,$4,$5,$6,$7,$8)',[account.phoneNumberId,account.wabaId,mid,'in',phone,'Olá','received',new Date()]);
   await inbound('wamid.calendar.closed');assert.equal(await queue.claim('whatsapp'),undefined);
   assert.equal((await admin.query('SELECT phone FROM bansir.meta_greeting_contacts WHERE phone=$1',[phone])).rowCount,0);
   assert.equal((await admin.query('SELECT message_id FROM bansir.meta_messages WHERE message_id=$1',['wamid.calendar.closed'])).rowCount,1);
   await admin.query("UPDATE bansir.storefronts SET config=$1 WHERE slug='meta-calendar-test'",[{...config,businessHours:{...hours,enabled:false}}]);
   await inbound('wamid.calendar.open');const job=await queue.claim('whatsapp');assert.ok(job);
   await admin.query("UPDATE bansir.storefronts SET config=$1 WHERE slug='meta-calendar-test'",[config]);let calls=0;
   const outcome=await processMetaJob(queue,job,{version:'v99.0',transport:()=>{calls++;throw Error('must not call');}});assert.equal(outcome.skipped,true);assert.equal(calls,0);await finish(job);
   await admin.query("DELETE FROM bansir.storefronts WHERE slug='meta-calendar-test'");await send('/whatsapp/greeting','PUT',{enabled:false,message:'Calendar greeting'});
  });
  await t.test('worker requires consent/templates, uses approved template and never resends accepted messages',async()=>{
   const phone='5565999999999',j=await createJob(phone);let calls=0;const transport=async(url,opts)=>{calls++;assert.match(url,/graph\.facebook\.com\/v99\.0\/123456789012345\/messages$/);assert.equal(JSON.parse(opts.body).type,'template');return new Response(JSON.stringify({messages:[{id:'wamid.accepted'}]}),{status:200});};
   await assert.rejects(processMetaJob(queue,j,{version:'v99.0',transport}),/META_OPT_IN_REQUIRED/);assert.equal(calls,0);
   assert.equal((await send('/whatsapp/contacts','POST',{phone,optIn:true})).status,200);
   await processMetaJob(queue,j,{version:'v99.0',transport});await processMetaJob(queue,j,{version:'v99.0',transport});assert.equal(calls,1);await finish(j);
  });
  await t.test('recent inbound allows text, but uncertain send stops automatic retries',async()=>{
   const j=await createJob('5565988888888');let calls=0;const transport=async(_url,opts)=>{calls++;assert.equal(JSON.parse(opts.body).type,'text');throw new Error('timeout');};
   await assert.rejects(processMetaJob(queue,j,{version:'v99.0',transport}),/META_SEND_UNCERTAIN/);await assert.rejects(processMetaJob(queue,j,{version:'v99.0',transport}),/META_SEND_UNCERTAIN/);assert.equal(calls,1);await queue.finish(j,'dead','META_SEND_UNCERTAIN');
  });
  await t.test('queued messages revalidate sender and enabled account before external calls',async()=>{
   const j=await createJob('5565988888888');await admin.query('UPDATE bansir.establishment_memberships SET active=false WHERE tenant_id=$1 AND establishment_id=$2 AND user_id=$3',[tenant.id,tenant.establishmentId,user.id]);let calls=0;const transport=()=>{calls++;throw new Error('must not call');};
   await assert.rejects(processMetaJob(queue,j,{version:'v99.0',transport}),/META_SENDER_REVOKED/);assert.equal(calls,0);await admin.query('UPDATE bansir.establishment_memberships SET active=true WHERE tenant_id=$1 AND establishment_id=$2 AND user_id=$3',[tenant.id,tenant.establishmentId,user.id]);
   await send('/whatsapp/logout','POST',{});await assert.rejects(processMetaJob(queue,j,{version:'v99.0',transport}),/META_NOT_CONFIGURED/);assert.equal(calls,0);await queue.finish(j,'dead','META_NOT_CONFIGURED');
  });
  await t.test('Embedded Signup binds nonce to user/unit/session and resumes activation without another exchange',async()=>{
   assert.equal((await send('/whatsapp/onboarding/config','GET',undefined,driverSession.token)).status,403);
   const started=await send('/whatsapp/onboarding/start','POST',{});assert.equal(started.status,200,JSON.stringify(started));const attemptId=started.body.data.id;
   assert.equal((await send('/whatsapp/onboarding/complete','POST',{attemptId,code:'test-authorization-code'},otherSession.token)).status,409);
   const complete=await send('/whatsapp/onboarding/complete','POST',{attemptId,code:'test-authorization-code'});assert.equal(complete.status,200,JSON.stringify(complete));assert.equal(exchanges,1);
   assert.equal((await send('/whatsapp/status')).body.data.status,'NOT_CONFIGURED');
   assert.equal((await send('/whatsapp/onboarding/activate','POST',{attemptId})).status,409);
   assert.equal((await send('/whatsapp/onboarding/config')).body.data.pendingAttempt,attemptId);
   assert.equal((await send('/whatsapp/onboarding/complete','POST',{attemptId,code:'test-authorization-code'})).status,200);assert.equal(exchanges,1);
   assert.equal((await send('/whatsapp/onboarding/activate','POST',{attemptId})).status,200);assert.equal(activations,2);
   assert.equal((await send('/whatsapp/status')).body.data.status,'CONFIGURED');
   assert.equal((await send('/whatsapp/logout','POST',{})).status,200);
  });
 }finally{for(const k of ['FISCAL_ENCRYPTION_KEY','META_APP_SECRET','META_VERIFY_TOKEN','META_APP_ID','META_EMBEDDED_SIGNUP_CONFIG_ID','META_GRAPH_VERSION','META_CONNECT_FUNCTION_ARN','META_EMBEDDED_SIGNUP_ENABLED']){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}if(server)await new Promise(r=>server.close(r));await queue.close();await db.pool.end();await admin.end();}
});
