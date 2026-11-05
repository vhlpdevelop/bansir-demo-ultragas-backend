import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes,randomUUID} from 'node:crypto';import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';import {createPostgresApp} from '../src/postgres/app.js';import {createAuth} from '../src/postgres/auth.js';import {provisionTenant} from '../src/postgres/provision.js';
import {createQueue} from '../src/postgres/queue.js';import {deliverNotification} from '../src/postgres/notifications.js';
test('agreements preserve sales ledger, membership history, scopes and daily notifications',{skip:!process.env.TEST_POSTGRES_URL,timeout:120000},async t=>{
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL,max:10}),queue=createQueue(process.env.TEST_WORKER_URL);let server;
 try{
  const password=randomBytes(20).toString('hex'),secret=randomBytes(48).toString('hex');
  const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'agreement-test',name:'Agreement test',adminName:'Owner',email:'agreement-owner@test.invalid',password});
  await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'agreement-other',name:'Other',adminName:'Other owner',email:'agreement-other@test.invalid',password});
  const owner=(await admin.query("SELECT id,password_hash FROM bansir.users WHERE email='agreement-owner@test.invalid'")).rows[0];
  const users={};for(const [name,routes] of [['seller',['sales']],['collector',['sales','agreements-collect']],['viewer',['agreements-view']]]){
   const id=randomUUID();users[name]=id;await admin.query('INSERT INTO bansir.users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[id,name,`agreement-${name}@test.invalid`,owner.password_hash]);
   await admin.query("INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes) VALUES($1,$2,'operador',$3)",[tenant.id,id,routes]);
   await admin.query("INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes) VALUES($1,$2,$3,'operador',$4)",[tenant.id,tenant.establishmentId,id,routes]);
  }
  const auth=createAuth(db,{jwtSecret:secret}),sessions={};for(const name of ['owner','other','seller','collector','viewer'])sessions[name]=await auth.login({email:`agreement-${name}@test.invalid`,password});
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test',onError:e=>{if(!e.status&&!e.issues)console.error('Agreement test diagnostic:',e.code,e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));await queue.ready();
  const send=async(path,method='GET',body,who='owner')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessions[who].token},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const payer=(await send('/customers','POST',{name:'Company payer',document:'11222333000181'})).body.data;
  const customer=(await send('/customers','POST',{name:'Member one',document:'11144477735',phone:'67999991111'})).body.data;
  const second=(await send('/customers','POST',{name:'Member two',phone:'67999992222'})).body.data;
  const third=(await send('/customers','POST',{name:'Ordinary customer',phone:'67999993333'})).body.data;
  const foreign=(await send('/customers','POST',{name:'Foreign payer'},'other')).body.data;
  const product=(await send('/products','POST',{name:'Agreement water',barcode:'AG-1',price:10,stock:100,ncm:'22011000'})).body.data;
  await send('/pdv/cash/open','POST',{openingCents:0});await send('/pdv/cash/open','POST',{openingCents:0},'collector');
  const config={requestKey:randomUUID(),name:'Company agreement',payerCustomerId:payer.id,cutDay:25,dueDay:10,limitCents:5000,blockOverdue:true,active:true};
  let agreement,first,secondSale,receipt;
  const sell=(customerId,quantity=1,extra={})=>({requestKey:randomUUID(),customerId,items:[{productId:product.id,quantity,expectedUnitPriceCents:1000}],payment:{method:'pending',term:'credit'},...extra});
  await t.test('configuration and membership enforce RBAC, idempotency and unit boundaries',async()=>{
   assert.equal((await send('/agreements')).status,200);assert.equal((await send('/agreements','GET',undefined,'seller')).status,403);
   assert.equal((await send('/agreements','POST',{...config,payerCustomerId:foreign.id})).status,404);
   const r=await send('/agreements','POST',config);assert.equal(r.status,201,JSON.stringify(r.body));agreement=r.body.data;
   assert.equal((await send('/agreements','POST',config)).body.data.id,agreement.id);
   assert.equal((await send('/agreements','POST',{...config,name:'Changed request'})).body.code,'IDEMPOTENCY_CONFLICT');
   assert.equal((await send(`/agreements/${agreement.id}/statement`,'GET',undefined,'other')).status,404);
   const body={requestKey:randomUUID(),active:true,limitCents:2500};assert.equal((await send(`/agreements/${agreement.id}/members/${customer.id}`,'PUT',body)).status,200);
   assert.equal((await send(`/agreements/${agreement.id}/members/${customer.id}`,'PUT',body)).status,200);
   assert.equal((await send(`/agreements/${agreement.id}/members/${foreign.id}`,'PUT',{...body,requestKey:randomUUID()})).status,404);
   assert.equal((await send(`/agreements/${agreement.id}/members/${second.id}`,'PUT',{requestKey:randomUUID(),active:true,limitCents:null})).status,200);
   assert.equal((await send(`/agreements/customer/${customer.id}`,'GET',undefined,'seller')).status,403);
   await admin.query("UPDATE bansir.establishment_memberships SET allowed_routes=ARRAY['financial-receivables'] WHERE user_id=$1",[users.viewer]);assert.equal((await send('/agreements','GET',undefined,'viewer')).status,200);assert.equal((await send('/agreements','POST',{...config,requestKey:randomUUID()},'viewer')).status,403);
   await admin.query("UPDATE bansir.establishment_memberships SET allowed_routes=ARRAY['sales','agreements-use'] WHERE user_id=$1",[users.seller]);
   assert.equal((await send(`/agreements/customer/${customer.id}`,'GET',undefined,'seller')).body.data.id,agreement.id);
  });
  await t.test('only deferred credit joins the group and retains fiscal recipient identity',async()=>{
   const r=await send('/sales','POST',sell(customer.id,2));assert.equal(r.status,201,JSON.stringify(r.body));first=r.body.data;assert.equal(first.total_cents,2000);assert.deepEqual(first.agreement.snapshot.balanceAtEntry,{previousCents:0,entryCents:2000,totalCents:2000});assert.equal(first.agreement.agreement_id,agreement.id);assert.equal(first.agreement.snapshot.payerCustomerId,payer.id);assert.equal(first.customer_document,'11144477735');assert.ok(first.due_date);
   const stock=(await admin.query('SELECT stock FROM bansir.products WHERE id=$1',[product.id])).rows[0].stock;
   const blocked=await send('/sales','POST',sell(customer.id));assert.equal(blocked.body.code,'AGREEMENT_MEMBER_LIMIT');assert.equal((await admin.query('SELECT stock FROM bansir.products WHERE id=$1',[product.id])).rows[0].stock,stock);
   const immediate=await send('/sales','POST',sell(customer.id,1,{payment:{method:'pix',confirmed:true}}));assert.equal(immediate.status,201,JSON.stringify(immediate.body));assert.equal(immediate.body.data.agreement,null);
   const delivery=await send('/sales','POST',sell(customer.id,1,{deliveryMode:'delivery',deliveryAddress:'Delivery street 10',payment:{method:'pending',term:'delivery'}}));assert.equal(delivery.status,201,JSON.stringify(delivery.body));assert.equal(delivery.body.data.agreement,null);
   secondSale=(await send('/sales','POST',sell(second.id))).body.data;assert.equal(secondSale.agreement.agreement_id,agreement.id);
   assert.equal((await send(`/agreements/${agreement.id}/statement-pdf`)).body.data.base64.startsWith('JVBER'),true);
   assert.equal((await send('/agreements','POST',{...config,requestKey:randomUUID()},'viewer')).status,403);
  });
  await t.test('batch receipt allocates exactly once, supports partial collection and uses collector cash',async()=>{
   const before=(await send('/financial/summary')).body.data.kpis.totalRevenue;
   const origin=(await send('/pdv/cash')).body.data.expected_cents;
   const body={requestKey:randomUUID(),confirmed:true,method:'cash',receivedCents:700,allocations:[{saleId:first.id,amountCents:500}]};
   const r=await send(`/agreements/${agreement.id}/receipts`,'POST',body,'collector');assert.equal(r.status,201,JSON.stringify(r.body));receipt=r.body.data;
   const retry=await send(`/agreements/${agreement.id}/receipts`,'POST',body,'collector');assert.equal(retry.status,200);assert.equal(retry.body.data.id,receipt.id);
   assert.equal((await send(`/agreements/${agreement.id}/receipts`,'POST',{...body,receivedCents:800},'collector')).body.code,'IDEMPOTENCY_CONFLICT');
   const view=(await send(`/sales/${first.id}`)).body.data;assert.equal(view.outstanding_cents,1500);assert.equal(view.payments.length,1);assert.equal(view.payments[0].paid_by,users.collector);assert.equal(view.payments[0].received_cents,700);
   assert.equal((await send('/pdv/cash')).body.data.expected_cents,origin);assert.equal((await send('/pdv/cash','GET',undefined,'collector')).body.data.expected_cents,500);
   assert.equal((await send('/financial/summary')).body.data.kpis.totalRevenue,before+5);
   const statement=(await send(`/agreements/${agreement.id}/statement`)).body.data;assert.equal(statement.outstandingCents,2500);assert.equal(statement.receipts.length,1);
   const payments=Number((await admin.query('SELECT count(*) FROM bansir.sale_payments')).rows[0].count);
   const bad=await send(`/agreements/${agreement.id}/receipts`,'POST',{requestKey:randomUUID(),method:'pix',confirmed:true,allocations:[{saleId:first.id,amountCents:100},{saleId:randomUUID(),amountCents:100}]},'collector');assert.equal(bad.status,404);assert.equal(Number((await admin.query('SELECT count(*) FROM bansir.sale_payments')).rows[0].count),payments);
   assert.equal((await send(`/agreements/${agreement.id}/receipts`,'POST',{...body,requestKey:randomUUID(),receivedCents:5000,allocations:[{saleId:first.id,amountCents:5000}]},'collector')).body.code,'PAYMENT_EXCEEDS_BALANCE');
   assert.equal((await send(`/agreements/${agreement.id}/receipts`,'POST',{...body,requestKey:randomUUID()},'viewer')).status,403);
  });
  await t.test('concurrent credit cannot exceed group limit',async()=>{
   const r=await send('/agreements','POST',{...config,requestKey:randomUUID(),name:'Concurrent group',limitCents:1000});const id=r.body.data.id;
   await send(`/agreements/${id}/members/${third.id}`,'PUT',{requestKey:randomUUID(),active:true,limitCents:null});
   const results=await Promise.all([send('/sales','POST',sell(third.id)),send('/sales','POST',sell(third.id))]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409],JSON.stringify(results));assert.equal(results.find(r=>r.status===409).body.code,'AGREEMENT_LIMIT');
  });
  await t.test('suspension, payer changes and member moves never transfer historical debts',async()=>{
   assert.equal((await send(`/agreements/${agreement.id}`,'PUT',{...config,requestKey:randomUUID(),version:agreement.version,payerCustomerId:customer.id})).body.code,'AGREEMENT_PAYER_LOCKED');
   const other=(await send('/agreements','POST',{...config,requestKey:randomUUID(),name:'Future membership'})).body.data;
   assert.equal((await send(`/agreements/${other.id}/members/${customer.id}`,'PUT',{requestKey:randomUUID(),active:true,limitCents:null})).body.code,'AGREEMENT_MEMBER_EXISTS');
   await send(`/agreements/${agreement.id}/members/${customer.id}`,'PUT',{requestKey:randomUUID(),active:false,limitCents:2500});await send(`/agreements/${other.id}/members/${customer.id}`,'PUT',{requestKey:randomUUID(),active:true,limitCents:null});
   const future=(await send('/sales','POST',sell(customer.id))).body.data;assert.equal(future.agreement.agreement_id,other.id);assert.equal((await send(`/sales/${first.id}`)).body.data.agreement.agreement_id,agreement.id);
   await send(`/agreements/${other.id}`,'PUT',{...config,requestKey:randomUUID(),name:other.name,version:other.version,active:false});assert.equal((await send('/sales','POST',sell(customer.id))).body.code,'AGREEMENT_SUSPENDED');
   const c=(await send('/agreements')).body.data.find(g=>g.id===agreement.id);assert.equal((await send(`/agreements/${agreement.id}`,'PUT',{...config,requestKey:randomUUID(),version:c.version+1})).body.code,'STALE_AGREEMENT');
  });
  await t.test('closure and overdue notifications deduplicate, exclude normal digest and stop after payment',async()=>{
   const period=(await admin.query("SELECT ((now() AT TIME ZONE 'America/Cuiaba')::date-2)::text AS day")).rows[0].day;
   await admin.query("UPDATE bansir.sale_agreements SET period_end=$2,due_date=(now() AT TIME ZONE 'America/Cuiaba')::date+2 WHERE agreement_id=$1",[agreement.id,period]);
   await queue.pool.query('SELECT bansir.schedule_agreement_alerts()');await queue.pool.query('SELECT bansir.schedule_agreement_alerts()');
   let jobs=(await admin.query("SELECT * FROM bansir.jobs WHERE tenant_id=$1 AND payload->>'category'='agreement' AND payload->>'agreementId'=$2 AND payload->>'userId'=$3",[tenant.id,agreement.id,owner.id])).rows;assert.equal(jobs.length,1);assert.equal(jobs[0].payload.event,'close');
   const close={requestKey:randomUUID(),periodEnd:period};assert.equal((await send(`/agreements/${agreement.id}/close`,'POST',close)).status,200);assert.equal((await send(`/agreements/${agreement.id}/close`,'POST',close)).status,200);
   assert.equal(Number((await admin.query('SELECT count(*) FROM bansir.agreement_cycles WHERE agreement_id=$1',[agreement.id])).rows[0].count),1);
   await admin.query("UPDATE bansir.sale_agreements SET due_date=(now() AT TIME ZONE 'America/Cuiaba')::date-1 WHERE agreement_id=$1",[agreement.id]);
   assert.equal((await send('/sales','POST',sell(second.id))).body.code,'AGREEMENT_OVERDUE');
   await queue.pool.query('SELECT bansir.schedule_agreement_alerts()');await queue.pool.query('SELECT bansir.schedule_agreement_alerts()');await queue.pool.query('SELECT bansir.schedule_financial_alerts()');
   jobs=(await admin.query("SELECT * FROM bansir.jobs WHERE tenant_id=$1 AND payload->>'category'='agreement' AND payload->>'agreementId'=$2 AND payload->>'userId'=$3",[tenant.id,agreement.id,owner.id])).rows;assert.equal(jobs.length,2);const overdue=jobs.find(j=>j.payload.event==='overdue');assert.ok(overdue);
   assert.equal(Number((await admin.query("SELECT count(*) FROM bansir.jobs WHERE tenant_id=$1 AND payload->>'category'='financial' AND payload->>'financialPart'='income'",[tenant.id])).rows[0].count),0);
   const out=(await send(`/agreements/${agreement.id}/statement`)).body.data.sales.filter(s=>s.outstanding_cents>0).map(s=>({saleId:s.sale_id,amountCents:s.outstanding_cents}));
   const paid=await send(`/agreements/${agreement.id}/receipts`,'POST',{requestKey:randomUUID(),confirmed:true,method:'pix',allocations:out},'collector');assert.equal(paid.status,201,JSON.stringify(paid.body));
   const needed=(await queue.pool.query("SELECT bansir.agreement_alert_needed($1,$2,$3,$4,'overdue') AS needed",[tenant.id,tenant.establishmentId,agreement.id,period])).rows[0].needed;assert.equal(needed,false);
   let leased;for(let attempt=0;attempt<100;attempt++){const job=await queue.claim('notification');if(!job)break;if(job.id===overdue.id){leased=job;break;}await queue.finish(job,'done');}assert.ok(leased);let sent=0;await deliverNotification(queue,leased,{pushEnabled:true,send:async()=>sent++});assert.equal(sent,0);await queue.finish(leased,'done');
   const view=(await send(`/sales/${first.id}`)).body.data;assert.equal(view.status,'paid');const fiscal=(await send(`/sales/${first.id}/fiscal-draft?model=65`)).body.data;assert.equal(fiscal.dest.CNPJCPF,'11144477735');
   const inbox=(await send('/notifications')).body.data;assert.ok(inbox.some(n=>n.metadata?.agreementId===agreement.id));
  });
  await t.test('cancelled group sales stop debt and ordinary overdue sales retain their daily reminder',async()=>{
   const ordinary=(await send('/customers','POST',{name:'Ordinary due customer',phone:'67999994444'})).body.data;
   const due=(await admin.query("SELECT ((now() AT TIME ZONE 'America/Cuiaba')::date-1)::text AS day")).rows[0].day;
   const credit=await send('/sales','POST',sell(ordinary.id,1,{payment:{method:'pending',term:'credit',dueDate:due}}));assert.equal(credit.status,201,JSON.stringify(credit.body));assert.equal(credit.body.data.agreement,null);
   await queue.pool.query('SELECT bansir.schedule_financial_alerts()');await queue.pool.query('SELECT bansir.schedule_financial_alerts()');
   assert.equal(Number((await admin.query("SELECT count(*) FROM bansir.jobs WHERE tenant_id=$1 AND payload->>'financialPart'='income' AND payload->>'userId'=$2",[tenant.id,owner.id])).rows[0].count),1);
   const linked=(await admin.query('SELECT sale_id FROM bansir.sale_agreements WHERE customer_id=$1',[third.id])).rows[0].sale_id;
   const cancelled=await send(`/sales/${linked}/cancel`,'POST',{reason:'Customer cancelled agreement purchase',refundConfirmed:true});assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
   const gid=cancelled.body.data.agreement.agreement_id;
   assert.equal((await send(`/agreements/${gid}/statement`)).body.data.outstandingCents,0);
   assert.equal((await send(`/agreements/${gid}/receipts`,'POST',{requestKey:randomUUID(),confirmed:true,method:'pix',allocations:[{saleId:linked,amountCents:1000}]},'collector')).body.code,'SALE_CANCELLED');
   const counts=await admin.query('SELECT count(*) FROM bansir.financial_entries');assert.equal(Number(counts.rows[0].count),0);
  });
  await t.test('PDV association moves membership atomically with optimistic concurrency and idempotency',async()=>{
   const destination=(await send('/agreements','POST',{...config,requestKey:randomUUID(),name:'PDV destination'})).body.data;
   const endpoint=`/agreements/customer/${second.id}/membership`,body={requestKey:randomUUID(),agreementId:destination.id,expectedAgreementId:agreement.id};
   assert.equal((await send(endpoint,'PUT',body,'seller')).status,403);
   assert.equal((await send(endpoint,'PUT',{...body,agreementId:randomUUID()})).status,404);
   assert.equal((await send(`/agreements/customer/${second.id}`)).body.data.id,agreement.id);
   assert.equal((await send(endpoint,'PUT',body)).status,200);assert.equal((await send(endpoint,'PUT',body)).status,200);
   assert.equal((await send(`/agreements/customer/${second.id}`)).body.data.id,destination.id);
   assert.equal((await send(`/sales/${secondSale.id}`)).body.data.agreement.agreement_id,agreement.id);
   assert.equal((await send(endpoint,'PUT',{...body,requestKey:randomUUID()})).body.code,'STALE_AGREEMENT');
   assert.equal((await send(endpoint,'PUT',{requestKey:randomUUID(),agreementId:agreement.id,expectedAgreementId:destination.id})).status,200);
  });
  await t.test('contract disabling blocks new group credit without hiding existing debts',async()=>{
   await admin.query("INSERT INTO bansir.tenant_contracts(tenant_id,features) VALUES($1,'{\"agreements\":false}') ON CONFLICT(tenant_id) DO UPDATE SET features=tenant_contracts.features||'{\"agreements\":false}'",[tenant.id]);
   assert.equal((await send(`/agreements/customer/${second.id}`)).body.data,null);assert.equal((await send('/sales','POST',sell(second.id))).body.code,'FEATURE_DISABLED');assert.equal((await send('/agreements')).status,200);
   assert.equal((await send('/agreements','POST',{...config,requestKey:randomUUID()})).body.code,'FEATURE_DISABLED');
  });
 }finally{if(server)await new Promise(r=>server.close(r));await Promise.all([db.close(),queue.close(),admin.end()]);}
});
