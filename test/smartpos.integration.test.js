import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {createAuth} from '../src/postgres/auth.js';
import {provisionTenant} from '../src/postgres/provision.js';

test('SmartPOS pairing and durable remote payments: real database, simulated SDK only',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async t=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();
 const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL,max:8});let server;
 try{
  const password=randomBytes(20).toString('hex'),secret=randomBytes(48).toString('hex');
  const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'smartpos-a',name:'SmartPOS fixture',adminName:'Admin',email:'smartpos@test.invalid',password});
  await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'smartpos-b',name:'Foreign',adminName:'Other',email:'smartpos-other@test.invalid',password});
  const auth=createAuth(db,{jwtSecret:secret}),s=await auth.login({email:'smartpos@test.invalid',password}),session=s.requiresEstablishmentSelection?await auth.select({selectionToken:s.selectionToken,tenantId:tenant.id,establishmentId:tenant.establishmentId}):s,foreign=await auth.login({email:'smartpos-other@test.invalid',password});
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test'}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const send=async(path,method='GET',body,terminal,token=session.token)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(terminal?{'X-Pdv-Terminal':terminal}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const product=(await send('/products','POST',{name:'SmartPOS test only',barcode:'SMART-FIXTURE',price:100,stock:30})).body.data;
  const terminal=(await send('/pdv/terminals','POST',{name:'Cash fixture'})).body.data;
  const code=(await send(`/pdv/terminals/${terminal.id}/activation`,'POST',{})).body.data.code;
  const browser=(await send('/pdv/terminals/pair','POST',{code})).body.data.token;
  let smart,cash;
  await t.test('codes are scoped to SmartPOS/provider, single use, and do not replace browser',async()=>{
   cash=(await send('/pdv/cash/open','POST',{openingCents:0},browser)).body.data;
   const issued=await send(`/pdv/terminals/${terminal.id}/smartpos/activation`,'POST',{provider:'pagbank'});assert.equal(issued.status,200,JSON.stringify(issued.body));assert.match(issued.body.data.code,/^\d{6}$/);
   assert.equal((await send('/pdv/terminals/pair','POST',{code:issued.body.data.code})).status,400);
   assert.equal((await send('/pdv/terminals/pair','POST',{code:issued.body.data.code,clientType:'smartpos',provider:'mercadopago'})).status,400);
   const paired=await send('/pdv/terminals/pair','POST',{code:issued.body.data.code,clientType:'smartpos',provider:'pagbank'});assert.equal(paired.status,200,JSON.stringify(paired.body));smart=paired.body.data.token;
   assert.equal((await send('/pdv/terminals/pair','POST',{code:issued.body.data.code,clientType:'smartpos',provider:'pagbank'})).status,400);
   assert.equal((await send('/pdv/terminals','GET',undefined,browser)).body.data.current.client_type,'browser');
   assert.equal((await send(`/pdv/terminals/${terminal.id}/smartpos/activation`,'POST',{provider:'pagbank'})).body.code,'SMARTPOS_REPLACEMENT_REQUIRED');
  });
  const order=()=>({requestKey:randomUUID(),items:[{productId:product.id,quantity:1,expectedUnitPriceCents:10000}],payment:{method:'credit_card',confirmed:true,installments:2},smartposProvider:'pagbank'});
  let sale,command,claimKey,deferredSale;
  await t.test('incompatible/offline APK rolls back entire checkout; compatible checkout is unpaid and idempotent',async()=>{
   const body=order();assert.equal((await send('/sales','POST',body,browser)).body.code,'SMARTPOS_NOT_READY');assert.equal((await admin.query('SELECT stock FROM bansir.products WHERE id=$1',[product.id])).rows[0].stock,30);
   assert.equal((await send('/pdv/terminals/heartbeat','POST',{remoteChargeVersion:1,paymentSdkAvailable:true,acquirerProvider:'PAGBANK',appVersion:'fixture'},smart)).status,200);
   const [a,b]=await Promise.all([send('/sales','POST',body,browser),send('/sales','POST',body,browser)]);assert.equal(a.status,201,JSON.stringify(a.body));assert.equal(b.body.data.id,a.body.data.id);sale=a.body.data;assert.equal(sale.status,'pending');assert.equal(sale.payments.length,0);assert.equal(sale.smartpos.status,'queued');
   assert.equal((await admin.query('SELECT stock FROM bansir.products WHERE id=$1',[product.id])).rows[0].stock,29);
   assert.equal((await send('/sales','POST',order(),browser)).body.code,'SMARTPOS_PENDING');assert.equal((await admin.query('SELECT stock FROM bansir.products WHERE id=$1',[product.id])).rows[0].stock,29);
   assert.equal((await send(`/sales/${sale.id}/smartpos`,'GET',undefined,browser,foreign.token)).status,404);
  });
  await t.test('delivery claim is idempotent, authenticated by device and cannot blindly redeliver to a new claim',async()=>{
   claimKey=randomUUID();assert.equal((await send('/smartpos/commands/next','POST',{requestKey:claimKey},browser)).status,403);
   assert.equal((await send('/smartpos/commands/next','POST',{requestKey:claimKey},smart,foreign.token)).status,403);
   const first=await send('/smartpos/commands/next','POST',{requestKey:claimKey},smart);assert.equal(first.status,200,JSON.stringify(first.body));command=first.body.data;assert.equal(command.id,sale.smartpos.id);assert.equal(command.status,'executing');assert.equal(command.merchantReference,command.id);
   assert.equal((await send('/smartpos/commands/next','POST',{requestKey:claimKey},smart)).body.data.executionToken,command.executionToken);
   assert.equal((await send('/smartpos/commands/next','POST',{requestKey:randomUUID()},smart)).body.data,null);
  });
  const approved=()=>({executionToken:command.executionToken,status:'approved',provider:'pagbank',method:'credit_card',amountCents:10000,installments:2,transactionId:'fixture-tx-1',nsu:'000123',authorizationCode:'TEST-AUTH',acquirerCnpj:'11222333000181',brandCode:'01'});
  await t.test('pending charge blocks manual payment, refunds, cash closing and device replacement',async()=>{
   assert.equal((await send(`/sales/${sale.id}/payments`,'POST',{requestKey:randomUUID(),method:'cash',confirmed:true,amountCents:10000,receivedCents:10000},browser)).body.code,'SMARTPOS_PENDING');
   assert.equal((await send(`/pdv/cash/${cash.id}/close`,'POST',{countedCents:0,note:''},browser)).body.code,'SMARTPOS_PENDING');
   assert.equal((await send(`/sales/${sale.id}/cancel`,'POST',{reason:'test cancellation',refundConfirmed:true},browser)).body.code,'SMARTPOS_PENDING');
   assert.equal((await send(`/pdv/terminals/${terminal.id}/smartpos/pagbank`,'DELETE')).body.code,'SMARTPOS_PENDING');
   assert.equal((await send(`/pdv/terminals/${terminal.id}/smartpos/activation`,'POST',{provider:'pagbank',replaceExisting:true})).body.code,'SMARTPOS_PENDING');
   assert.equal((await send(`/sales/${sale.id}/smartpos/${command.id}/cancel`,'POST',{},browser)).body.code,'SMARTPOS_RESULT_REQUIRED');
  });
  await t.test('result requires exact amount/provider/method, original execution token and structured evidence; no card data',async()=>{
   const endpoint=`/smartpos/commands/${command.id}/result`;
   assert.equal((await send(endpoint,'POST',{...approved(),amountCents:1},smart)).body.code,'SMARTPOS_RESULT_MISMATCH');
   assert.equal((await send(endpoint,'POST',{...approved(),provider:'mercadopago'},smart)).body.code,'SMARTPOS_RESULT_MISMATCH');
   assert.equal((await send(endpoint,'POST',{...approved(),executionToken:'0'.repeat(64)},smart)).status,403);
   const missing=approved();delete missing.nsu;assert.equal((await send(endpoint,'POST',missing,smart)).status,400);
   assert.equal((await send(endpoint,'POST',{...approved(),pan:'4111111111111111'},smart)).status,400);
   assert.equal((await send(`/sales/${sale.id}`,'GET',undefined,browser)).body.data.paid_cents,0);
   const results=await Promise.all([send(endpoint,'POST',approved(),smart),send(endpoint,'POST',approved(),smart)]);assert.ok(results.every(r=>r.status===200),JSON.stringify(results));
   const paid=(await send(`/sales/${sale.id}`,'GET',undefined,browser)).body.data;assert.equal(paid.status,'paid');assert.equal(paid.payments.length,1);assert.equal(paid.payments[0].smartpos_charge_id,command.id);
   const draft=(await send(`/sales/${sale.id}/fiscal-draft`)).body.data;assert.equal(draft.pag.detPag[0].card.tpIntegra,1);assert.equal(draft.pag.detPag[0].card.CNPJ,'11222333000181');assert.equal(draft.pag.detPag[0].card.cAut,'TEST-AUTH');assert.equal(draft.pag.detPag[0].card.tBand,'01');
   assert.equal((await send(endpoint,'POST',{...approved(),authorizationCode:'CHANGED'},smart)).status,409);
  });
  await t.test('unknown execution never becomes a new charge automatically; late approval settles once',async()=>{
   const created=await send('/sales','POST',order(),browser);assert.equal(created.status,201,JSON.stringify(created.body));const nextSale=created.body.data;
   const c=(await send('/smartpos/commands/next','POST',{requestKey:randomUUID()},smart)).body.data;
   await admin.query("UPDATE bansir.smartpos_charges SET expires_at=now()-interval '1 second' WHERE id=$1",[c.id]);
   assert.equal((await send(`/sales/${nextSale.id}/smartpos`)).body.data[0].status,'unknown');
   assert.equal((await send(`/sales/${nextSale.id}/smartpos`,'POST',{requestKey:randomUUID(),provider:'pagbank',method:'credit_card',amountCents:10000,installments:2},browser)).body.code,'SMARTPOS_PENDING');
   assert.equal((await send('/smartpos/commands/next','POST',{requestKey:randomUUID()},smart)).body.data,null);
   const result={...approved(),executionToken:c.executionToken,transactionId:'fixture-tx-2'};assert.equal((await send(`/smartpos/commands/${c.id}/result`,'POST',result,smart)).status,200);
   assert.equal((await send(`/sales/${nextSale.id}`)).body.data.payments.length,1);
  });
  await t.test('expired or never-delivered charges can be explicitly replaced; declined charges do not record payment',async()=>{
   const newSale=(await send('/sales','POST',order(),browser)).body.data;
   await admin.query("UPDATE bansir.smartpos_charges SET expires_at=now()-interval '1 second' WHERE id=$1",[newSale.smartpos.id]);
   assert.equal((await send(`/sales/${newSale.id}/smartpos`)).body.data[0].status,'expired');
   const next=(await send(`/sales/${newSale.id}/smartpos`,'POST',{requestKey:randomUUID(),provider:'pagbank',method:'debit_card',amountCents:10000,installments:1},browser)).body.data;
   const c=(await send('/smartpos/commands/next','POST',{requestKey:randomUUID()},smart)).body.data;assert.equal(c.id,next.id);
   const duplicate={...approved(),executionToken:c.executionToken,method:'debit_card',installments:1};assert.equal((await send(`/smartpos/commands/${c.id}/result`,'POST',duplicate,smart)).body.code,'ACQUIRER_TRANSACTION_REUSED');
   const decline={executionToken:c.executionToken,status:'declined',provider:'pagbank',method:'debit_card',amountCents:10000,installments:1,responseCode:'DECLINED'};assert.equal((await send(`/smartpos/commands/${c.id}/result`,'POST',decline,smart)).status,200);
   const state=(await send(`/sales/${newSale.id}`)).body.data;assert.equal(state.paid_cents,0);
   assert.equal((await send(`/sales/${newSale.id}/payments`,'POST',{requestKey:randomUUID(),method:'cash',amountCents:10000,receivedCents:10000,confirmed:true},browser)).status,201);
  });
  await t.test('queued cancellation does not cancel sale or restock; no charge secrets are returned to browser',async()=>{
   const nextSale=(await send('/sales','POST',order(),browser)).body.data;
   deferredSale=nextSale;
   const list=await send(`/sales/${nextSale.id}/smartpos`);assert.equal(JSON.stringify(list.body).includes('device_hash'),false);assert.equal(JSON.stringify(list.body).includes('executionToken'),false);
   const stock=(await admin.query('SELECT stock FROM bansir.products WHERE id=$1',[product.id])).rows[0].stock;
   assert.equal((await send(`/sales/${nextSale.id}/smartpos/${nextSale.smartpos.id}/cancel`,'POST',{},browser)).status,200);
   assert.equal((await send(`/sales/${nextSale.id}`)).body.data.status,'pending');assert.equal((await admin.query('SELECT stock FROM bansir.products WHERE id=$1',[product.id])).rows[0].stock,stock);
   const shift=(await send('/pdv/cash')).body.data;assert.equal((await send(`/pdv/cash/${shift.id}/close`,'POST',{countedCents:shift.expected_cents,note:''},browser)).status,200);
  });
  await t.test('collection of an earlier sale settles into the requesting operators current cash session',async()=>{
   const reopened=(await send('/pdv/cash/open','POST',{openingCents:0},browser)).body.data;assert.notEqual(reopened.id,cash.id);
   const created=await send(`/sales/${deferredSale.id}/smartpos`,'POST',{requestKey:randomUUID(),provider:'pagbank',method:'credit_card',amountCents:5000,installments:2},browser);assert.equal(created.status,202,JSON.stringify(created.body));
   const c=(await send('/smartpos/commands/next','POST',{requestKey:randomUUID()},smart)).body.data;
   assert.equal((await send(`/smartpos/commands/${c.id}/result`,'POST',{...approved(),executionToken:c.executionToken,amountCents:5000,transactionId:'fixture-current-cash'},smart)).status,200);
   const state=(await send(`/sales/${deferredSale.id}`)).body.data;assert.equal(state.paid_cents,5000);assert.equal(state.outstanding_cents,5000);
   const ledger=(await admin.query('SELECT cash_session_id FROM bansir.sale_payments WHERE smartpos_charge_id=$1',[c.id])).rows[0];assert.equal(ledger.cash_session_id,reopened.id);
  });
  await t.test('PIX is opt-in per machine and requires SDK support; cash never becomes a remote charge',async()=>{
   const pixOrder={...order(),payment:{method:'pix',confirmed:true}};
   assert.equal((await send('/sales','POST',pixOrder,browser)).body.code,'SMARTPOS_PIX_DISABLED');
   assert.equal((await send(`/pdv/terminals/${terminal.id}/smartpos/pagbank`,'PATCH',{pixEnabled:true})).status,200);
   assert.equal((await send('/sales','POST',pixOrder,browser)).body.code,'SMARTPOS_PIX_DISABLED');
   await send('/pdv/terminals/heartbeat','POST',{remoteChargeVersion:1,paymentSdkAvailable:true,pixSdkAvailable:true,acquirerProvider:'PAGBANK'},smart);
   const result=await send('/sales','POST',pixOrder,browser);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.data.paid_cents,0);
   const c=(await send('/smartpos/commands/next','POST',{requestKey:randomUUID()},smart)).body.data;assert.equal(c.method,'pix');assert.equal(c.installments,1);
   const approval={executionToken:c.executionToken,status:'approved',provider:'pagbank',method:'pix',amountCents:10000,installments:1,transactionId:'fixture-pix-endtoend'};
   assert.equal((await send(`/smartpos/commands/${c.id}/result`,'POST',approval,smart)).status,200);
   assert.equal((await send(`/sales/${result.body.data.id}`)).body.data.status,'paid');
   assert.equal((await send('/sales','POST',{...order(),payment:{method:'cash',confirmed:true,receivedCents:10000}},browser)).body.code,'SMARTPOS_METHOD_REQUIRED');
  });
 }finally{if(server)await new Promise(r=>server.close(r));await Promise.all([db.close(),admin.end()]);}
});
