import {saleFiscalDraft} from '../src/postgres/sales.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {createAuth} from '../src/postgres/auth.js';
import {provisionTenant,assignPlan,createEstablishment} from '../src/postgres/provision.js';
import {seal,secretContext} from '../src/postgres/secrets.js';
import {crc16} from '../src/postgres/pix.js';

test('PDV PostgreSQL: real sales, ledger, cash, manual payments and fiscal linkage',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async t=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL,max:8});let server;
 try{
  const password=randomBytes(20).toString('hex'),secret=randomBytes(48).toString('hex');
  const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'pdv-a',name:'PDV A',adminName:'Caixa Admin',email:'pdv@test.invalid',password});
  const foreign=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'pdv-b',name:'PDV B',adminName:'Other',email:'pdv-other@test.invalid',password});
  const user=(await admin.query("SELECT id,password_hash FROM bansir.users WHERE email='pdv@test.invalid'")).rows[0];
  await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,code:'pdv-two',name:'Test',maxEstablishments:2});
  const unit2=await createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,name:'Unit 2',memberships:[{userId:user.id,role:'operador',allowedRoutes:['sales']}]});
  const operator=randomUUID(),reader=randomUUID();await admin.query("INSERT INTO bansir.users(id,email,name,password_hash) VALUES($1,'pdv-operator@test.invalid','Operator',$3),($2,'pdv-reader@test.invalid','Reader',$3)",[operator,reader,user.password_hash]);
  for(const [id,routes]of [[operator,['sales']],[reader,['products']]]){await admin.query("INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes) VALUES($1,$2,'operador',$3)",[tenant.id,id,routes]);await admin.query("INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes) VALUES($1,$2,$3,'operador',$4)",[tenant.id,tenant.establishmentId,id,routes]);}
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test'}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const auth=createAuth(db,{jwtSecret:secret}),selection=await auth.login({email:'pdv@test.invalid',password});const session=await auth.select({selectionToken:selection.selectionToken,tenantId:tenant.id,establishmentId:tenant.establishmentId});
  const ticket2=await auth.login({email:'pdv@test.invalid',password});const session2=await auth.select({selectionToken:ticket2.selectionToken,tenantId:tenant.id,establishmentId:unit2.establishmentId});
  const operatorSession=await auth.login({email:'pdv-operator@test.invalid',password}),readerSession=await auth.login({email:'pdv-reader@test.invalid',password}),foreignSession=await auth.login({email:'pdv-other@test.invalid',password});
  const send=async(path,method='GET',body,token=session.token)=>{const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  const product=(await send('/products','POST',{name:'Gas test',barcode:'PDV-1',price:120.45,costPrice:90,stock:100,ncm:'27111910'})).body.data;
  const water=(await send('/products','POST',{name:'Water test',barcode:'PDV-2',price:10.01,stock:100})).body.data;
  const stock=async p=>(await admin.query('SELECT stock FROM bansir.products WHERE id=$1',[p.id])).rows[0].stock;
  const order=(overrides={})=>({requestKey:randomUUID(),items:[{productId:product.id,quantity:1,expectedUnitPriceCents:12045}],payment:{method:'cash',confirmed:true,receivedCents:15000},...overrides});
  let cash,paid,pending;
  await t.test('cash required, unit isolation, explicit payment confirmation and strict input',async()=>{
   assert.equal((await send('/sales','POST',order())).status,409);assert.equal(await stock(product),100);
   assert.equal((await send('/pdv/cash')).body.data,null);
   const opens=await Promise.all([send('/pdv/cash/open','POST',{openingCents:10000}),send('/pdv/cash/open','POST',{openingCents:10000})]);assert.ok(opens.every(r=>[200,201].includes(r.status)));assert.equal(opens[0].body.data.id,opens[1].body.data.id);cash=opens[0].body.data;
   assert.equal((await send('/pdv/cash/open','POST',{openingCents:999})).status,409);
   assert.equal((await send('/pdv/cash','GET',undefined,session2.token)).body.data,null);
   assert.equal((await send('/sales','GET',undefined,readerSession.token)).status,403);
   assert.equal((await send('/sales','POST',order({invoiceIssued:true}))).status,400);
   assert.equal((await send('/sales','POST',order({payment:{method:'pix',confirmed:false,reference:'fake'}}))).status,400);
   assert.equal((await send('/sales','POST',order({payment:{method:'pix',confirmed:true}}))).status,400);
   assert.equal((await send('/sales','POST',order({payment:{method:'cash',confirmed:true,receivedCents:100}}))).status,400);
   assert.equal((await send('/sales','POST',order({items:[{productId:product.id,quantity:1,expectedUnitPriceCents:100}]}))).status,409);
   assert.equal((await send('/sales','POST',order({tenantId:foreign.id}))).status,400);
  });
  await t.test('basket totals, stock, seller identity, change and outbox commit exactly once',async()=>{
   const input=order({items:[{productId:product.id,quantity:2,expectedUnitPriceCents:12045},{productId:water.id,quantity:3,expectedUnitPriceCents:1001}],discountCents:76,payment:{method:'cash',confirmed:true,receivedCents:30000}});
   const results=await Promise.all(Array.from({length:4},()=>send('/sales','POST',input)));assert.ok(results.every(r=>r.status===201),JSON.stringify(results));assert.equal(new Set(results.map(r=>r.body.data.id)).size,1);paid=results[0].body.data;
   const printed=await send(`/sales/${paid.id}/receipt?width=58`);assert.equal(printed.status,200);assert.equal(Buffer.from(printed.body.data.base64,'base64').subarray(0,5).toString(),'%PDF-');assert.equal((await send(`/sales/${paid.id}/receipt`,'GET',undefined,session2.token)).status,404);assert.equal((await send(`/sales/${paid.id}/receipt?width=42`)).status,400);
   assert.equal(paid.subtotal_cents,27093);assert.equal(paid.total_cents,27017);assert.equal(paid.status,'paid');assert.equal(paid.invoiceIssued,false);assert.equal(paid.created_by,user.id);assert.equal(paid.seller_name,'Caixa Admin');assert.equal(paid.items.reduce((n,i)=>n+i.discount_cents,0),76);
   assert.equal(paid.payments.length,1);assert.equal(paid.payments[0].received_cents-paid.payments[0].amount_cents,2983);assert.equal(await stock(product),98);assert.equal(await stock(water),97);
   assert.equal(Number((await admin.query('SELECT unit_cost_cents FROM bansir.sale_items WHERE sale_id=$1 AND product_id=$2',[paid.id,product.id])).rows[0].unit_cost_cents),9000);assert.equal(paid.items[0].unit_cost_cents,undefined);
   assert.equal((await send('/pdv/cash')).body.data.expected_cents,37017);
   assert.equal((await admin.query('SELECT id FROM bansir.jobs WHERE dedupe_key=$1',[`sale:${paid.id}`])).rowCount,1);
   assert.equal((await send('/sales','POST',{...input,discountCents:77})).status,409);
   assert.equal((await send(`/sales/${paid.id}`,'GET',undefined,session2.token)).status,404);
   assert.equal((await send(`/sales/${paid.id}`,'GET',undefined,foreignSession.token)).status,404);
   assert.equal((await send(`/sales/${paid.id}`,'GET',undefined,operatorSession.token)).status,404);
  });
  await t.test('whole transaction rolls back on invalid basket; last-unit concurrency never oversells',async()=>{
   const before=await stock(product),balance=(await send('/pdv/cash')).body.data.expected_cents;
   assert.equal((await send('/sales','POST',order({items:[{productId:product.id,quantity:1,expectedUnitPriceCents:12045},{productId:water.id,quantity:999,expectedUnitPriceCents:1001}]}))).status,409);
   assert.equal(await stock(product),before);assert.equal((await send('/pdv/cash')).body.data.expected_cents,balance);
   const last=(await send('/products','POST',{name:'Last unit',barcode:'PDV-LAST',price:1.01,stock:1})).body.data;
   const requests=await Promise.all([send('/sales','POST',order({items:[{productId:last.id,quantity:1,expectedUnitPriceCents:101}]})),send('/sales','POST',order({items:[{productId:last.id,quantity:1,expectedUnitPriceCents:101}]}))]);assert.deepEqual(requests.map(r=>r.status).sort(),[201,409]);assert.equal(await stock(last),0);
   await send('/pdv/cash/open','POST',{openingCents:0},operatorSession.token);
   assert.equal((await send('/sales','POST',order({discountCents:1}),operatorSession.token)).status,403);
   assert.equal((await send('/sales','POST',order({items:[{productId:product.id,quantity:1,expectedUnitPriceCents:12045,unitPriceCents:1}]}),operatorSession.token)).status,403);
  });
  await t.test('customers and receivables; static PIX does not mark a sale paid; partial and final receipts are idempotent',async()=>{
   const customer=(await send('/customers','POST',{name:'Test customer',phone:'65999999999',document:'12345678909',address:'Rua Teste 1'})).body.data;
   assert.equal((await send('/customers/search?q=Test')).body.data.some(c=>c.id===customer.id),true);
   assert.deepEqual((await send('/customers/search?q=Test','GET',undefined,session2.token)).body.data,[]);
   const response=await send('/sales','POST',order({customerId:customer.id,payment:{method:'pending',term:'credit',dueDate:'2026-12-01'}}));assert.equal(response.status,201);pending=response.body.data;assert.equal(pending.status,'pending');assert.equal(pending.outstanding_cents,12045);assert.equal(pending.payments.length,0);
   assert.equal((await send(`/sales/${pending.id}/fiscal-draft`)).status,409);
   await send('/settings','PUT',{storeName:'Ultragas Test',merchantCity:'Cuiaba',pixKey:'test@example.com'});
   const pix=await send(`/sales/${pending.id}/pix`,'POST',{});assert.equal(pix.status,200);assert.equal(pix.body.data.manualConfirmationRequired,true);assert.equal(pix.body.data.brCode.slice(-4),crc16(pix.body.data.brCode.slice(0,-4)));assert.equal(pix.body.data.brCode.startsWith('00020126'),true);assert.equal((await send(`/sales/${pending.id}`)).body.data.status,'pending');
   const part={requestKey:randomUUID(),method:'pix',confirmed:true,reference:'TEST PIX CONFERRED',amountCents:5000};const payments=await Promise.all([send(`/sales/${pending.id}/payments`,'POST',part),send(`/sales/${pending.id}/payments`,'POST',part)]);assert.ok(payments.every(r=>[200,201].includes(r.status)));assert.equal(payments[0].body.data.outstanding_cents,7045);
   assert.equal((await send(`/sales/${pending.id}/payments`,'POST',{...part,requestKey:randomUUID(),amountCents:8000})).status,409);
   const final=await send(`/sales/${pending.id}/payments`,'POST',{requestKey:randomUUID(),method:'credit_card',confirmed:true,reference:'NSU-TEST-123',amountCents:7045});assert.equal(final.status,201);assert.equal(final.body.data.status,'paid');assert.equal(final.body.data.payments.length,2);
   assert.ok(!(await send('/sales?status=pending')).body.data.some(s=>s.id===pending.id));
   const foreignCustomer=(await send('/customers','POST',{name:'Other unit'},foreignSession.token)).body.data;
   assert.equal((await send('/sales','POST',order({customerId:foreignCustomer.id}))).status,404);
  });
  await t.test('cancel and refund restock once; externally paid sale needs refund confirmation; operators cannot cancel',async()=>{
   const stockBefore=await stock(product),balanceBefore=(await send('/pdv/cash')).body.data.expected_cents;
   assert.equal((await send(`/sales/${paid.id}/cancel`,'POST',{reason:'Test cancellation',refundConfirmed:true},operatorSession.token)).status,403);
   assert.equal((await send(`/sales/${paid.id}/cancel`,'POST',{reason:'Test cancellation',refundConfirmed:false})).status,400);
   const results=await Promise.all([send(`/sales/${paid.id}/cancel`,'POST',{reason:'Test cancellation',refundConfirmed:true}),send(`/sales/${paid.id}/cancel`,'POST',{reason:'Test cancellation',refundConfirmed:true})]);assert.ok(results.every(r=>r.status===200));assert.equal(results[0].body.data.status,'cancelled');assert.equal(await stock(product),stockBefore+2);assert.equal((await send('/pdv/cash')).body.data.expected_cents,balanceBefore-paid.total_cents);
   assert.equal((await send(`/sales/${pending.id}/cancel`,'POST',{reason:'External refund test',refundConfirmed:true})).status,400);
   assert.equal((await send(`/sales/${pending.id}/cancel`,'POST',{reason:'External refund test',refundConfirmed:true,refundReference:'REFUND TEST APPROVED'})).status,200);
  });
  await t.test('fiscal draft is bound to paid sale, item amounts and payment; queue never fabricates fiscal authorization',async()=>{
   process.env.FISCAL_ENCRYPTION_KEY=randomBytes(32).toString('base64');const identity={tenantId:tenant.id,establishmentId:tenant.establishmentId};
   await admin.query(`INSERT INTO bansir.fiscal_certificates(tenant_id,establishment_id,encrypted_bundle,subject,cnpj,fingerprint,valid_from,valid_until) VALUES($1,$2,$3,'TEST ONLY','11222333000181','test',now()-interval '1 day',now()+interval '1 day')`,[tenant.id,tenant.establishmentId,seal({base64:'TEST ONLY',password:'test'},secretContext(identity,'certificate'))]);
   const config={cnpj:'11222333000181',legalName:'Test',tradeName:'Test',ie:'123456789',crt:1,environment:2,series:1,nextNumber:1,timeZone:'America/Cuiaba',cscId:'1',address:{street:'Rua',number:'1',district:'Centro',city:'Cuiaba',cityCode:'5103403',uf:'MT',cep:'78000000',phone:'65999999999'}};
   await admin.query('INSERT INTO bansir.fiscal_settings(tenant_id,establishment_id,data,encrypted_csc) VALUES($1,$2,$3,$4)',[tenant.id,tenant.establishmentId,config,seal('TEST CSC',secretContext(identity,'csc'))]);await admin.query('INSERT INTO bansir.fiscal_numbering VALUES($1,$2,2,1,0)',[tenant.id,tenant.establishmentId]);
   const sale=(await send('/sales','POST',order())).body.data;
   const draft=(await send(`/sales/${sale.id}/fiscal-draft`)).body.data;
   assert.equal((await send(`/sales/${sale.id}/fiscal`,'POST',{requestKey:randomUUID(),draft})).status,400);
   draft.det[0].prod.CFOP='5102';draft.det[0].imposto={ICMS:{testOnly:true},PIS:{testOnly:true},COFINS:{testOnly:true}};
   const tampered=structuredClone(draft);tampered.det[0].prod.qCom=2;assert.equal((await send(`/sales/${sale.id}/fiscal`,'POST',{requestKey:randomUUID(),draft:tampered})).status,400);
   const body={requestKey:randomUUID(),draft};const issue=await send(`/sales/${sale.id}/fiscal`,'POST',body);assert.equal(issue.status,202,JSON.stringify(issue.body));assert.equal((await send(`/sales/${sale.id}/fiscal`,'POST',body)).body.data.id,issue.body.data.id);
   const state=(await send(`/sales/${sale.id}`)).body.data;assert.equal(state.invoiceIssued,false);assert.equal(state.fiscal_status,'queued');assert.equal(state.access_key.length,44);
   assert.equal((await send(`/sales/${sale.id}/cancel`,'POST',{reason:'Must cancel fiscally',refundConfirmed:true})).status,409);
   assert.equal((await send(`/sales/${sale.id}/fiscal-draft`,'GET',undefined,operatorSession.token)).status,403);
  });
  await t.test('invoice checkout requires CPF and paid sale; customer document edits stay scoped and lock after invoice',async()=>{
   const before=await stock(product);
   assert.equal((await send('/sales','POST',{...order(),issueInvoice:true})).status,400);
   assert.equal(await stock(product),before);
   const body={...order(),issueInvoice:true,customerDocument:'12345678909'};
   const a=await send('/sales','POST',body);assert.equal(a.status,201,JSON.stringify(a.body));
   assert.equal((await send('/sales','POST',body)).body.data.id,a.body.data.id);assert.equal(await stock(product),before-1);
   const id=a.body.data.id;
   assert.equal((await send(`/sales/${id}/customer-document`,'PATCH',{document:'98765432100'},session2.token)).status,403);
   assert.equal((await send(`/sales/${id}/customer-document`,'PATCH',{document:'98765432100'},operatorSession.token)).status,403);
   assert.equal((await send(`/sales/${id}/customer-document`,'PATCH',{document:'98765432100'})).status,200);
   const draft=(await send(`/sales/${id}/fiscal-draft`)).body.data;assert.equal(draft.dest.CNPJCPF,'98765432100');
   draft.det[0].prod.CFOP='5102';draft.det[0].imposto={ICMS:{testOnly:true},PIS:{testOnly:true},COFINS:{testOnly:true}};
   assert.equal((await send(`/sales/${id}/fiscal`,'POST',{requestKey:randomUUID(),draft})).status,202);
   assert.equal((await send(`/sales/${id}/customer-document`,'PATCH',{document:'12345678909'})).status,409);
   assert.equal((await send(`/sales/${id}`)).body.data.fiscal_model,'65');
  });
  await t.test('cash withdrawals, deposits and closing reconcile physical cash only, including cash refunds',async()=>{
   const before=(await send('/pdv/cash')).body.data.expected_cents;
   const movement={requestKey:randomUUID(),kind:'deposit',amountCents:1000,reason:'Test supply'};await send('/pdv/cash/movements','POST',movement);await send('/pdv/cash/movements','POST',movement);
   assert.equal((await send('/pdv/cash')).body.data.expected_cents,before+1000);
   assert.equal((await send('/pdv/cash/movements','POST',{...movement,requestKey:randomUUID(),kind:'withdrawal',amountCents:before+1001})).status,409);
   await send('/pdv/cash/movements','POST',{...movement,requestKey:randomUUID(),kind:'withdrawal',amountCents:500});
   const expected=(await send('/pdv/cash')).body.data.expected_cents;assert.equal(expected,before+500);
   assert.equal((await send(`/pdv/cash/${cash.id}/close`,'POST',{countedCents:expected+1})).status,400);
   const close=await send(`/pdv/cash/${cash.id}/close`,'POST',{countedCents:expected,note:'Test closing'});assert.equal(close.status,200);assert.equal(close.body.data.difference_cents,0);assert.equal(close.body.data.expected_cents,expected);
   assert.equal((await send('/sales','POST',order())).status,409);assert.equal((await send('/pdv/cash')).body.data,null);assert.equal((await send('/pdv/cash/history')).body.data[0].id,cash.id);
  });
  await t.test('collection permission is distinct from cancellation; payment UUID cannot settle a second sale',async()=>{
   await send('/pdv/cash/open','POST',{openingCents:0});
   const input=()=>order({customerName:'Credit customer',customerPhone:'65999999999',payment:{method:'pending',term:'credit',dueDate:'2026-12-01'}});
   const a=(await send('/sales','POST',input())).body.data,b=(await send('/sales','POST',input())).body.data;
   assert.equal((await send(`/sales/${a.id}`,'GET',undefined,operatorSession.token)).status,404);
   await admin.query("UPDATE bansir.establishment_memberships SET allowed_routes=ARRAY['sales','sales-collect'] WHERE tenant_id=$1 AND establishment_id=$2 AND user_id=$3",[tenant.id,tenant.establishmentId,operator]);
   assert.equal((await send(`/sales/${a.id}`,'GET',undefined,operatorSession.token)).status,200);
   const payment={requestKey:randomUUID(),method:'pix',confirmed:true,reference:'TEST COLLECTED',amountCents:100};
   assert.equal((await send(`/sales/${a.id}/payments`,'POST',payment,operatorSession.token)).status,201);
   assert.equal((await send(`/sales/${b.id}/payments`,'POST',payment,operatorSession.token)).status,409);
   assert.equal((await send(`/sales/${b.id}`,'GET',undefined,operatorSession.token)).body.data.paid_cents,0);
   assert.equal((await send(`/sales/${a.id}/cancel`,'POST',{reason:'No management permission',refundConfirmed:true},operatorSession.token)).status,403);
   assert.equal((await send(`/sales/${a.id}`,'GET',undefined,session2.token)).status,404);
  });
  await t.test('manual cards, exact split, cash shortfall, installments and fiscal change',async()=>{
   const p=(await send('/products','POST',{name:'Split test',barcode:'SPLIT',price:100,stock:20})).body.data;
   const input=payment=>order({items:[{productId:p.id,quantity:1,expectedUnitPriceCents:10000}],payment});
   const before=(await send('/pdv/cash')).body.data.expected_cents;
   for(const method of ['credit_card','debit_card']){
    const r=await send('/sales','POST',input({method,confirmed:true,...(method==='credit_card'?{installments:3}:{})}));
    assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.body.data.payments[0].installments,method==='credit_card'?3:1);
   }
   assert.equal((await send('/pdv/cash')).body.data.expected_cents,before);
   assert.equal((await send('/sales','POST',input({method:'cash',confirmed:true,receivedCents:9900}))).status,400);
   const parts=[{method:'cash',confirmed:true,amountCents:5000,receivedCents:6000},{method:'credit_card',confirmed:true,amountCents:5000,installments:3}];
   assert.equal((await send('/sales','POST',input({method:'split',parts:[{...parts[0],amountCents:4900},parts[1]]}))).status,400);
   const body=input({method:'split',parts});const r=await send('/sales','POST',body);assert.equal(r.status,201,JSON.stringify(r));
   const sale=r.body.data;assert.equal(sale.payments.length,2);assert.equal(sale.paid_cents,10000);assert.equal(sale.outstanding_cents,0);
   const retry=await send('/sales','POST',body);assert.equal(retry.body.data.id,sale.id);assert.equal((await send('/pdv/cash')).body.data.expected_cents,before+5000);
   const pag=saleFiscalDraft(sale).pag;assert.equal(pag.vTroco,10);assert.equal(pag.detPag.reduce((n,p)=>n+p.vPag,0)-pag.vTroco,100);
   const card=pag.detPag.find(p=>p.tPag==='03');assert.equal(card.indPag,1);assert.deepEqual(card.card,{tpIntegra:2});
  });
 }finally{if(server)await new Promise(r=>server.close(r));await Promise.all([db.close(),admin.end()]);}
});
