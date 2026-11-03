import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {randomUUID,randomBytes} from 'node:crypto';
import {createDatabase} from '../src/postgres/database.js';import {createPostgresApp} from '../src/postgres/app.js';import {provisionTenant} from '../src/postgres/provision.js';import {createAuth} from '../src/postgres/auth.js';import {nfeRecipient} from '../src/postgres/fiscal-models.js';
test('sale revisions correct customer and fiscal data after cash closing without rewriting the ledger',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async t=>{
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL});let server;
 try{
  const password=randomBytes(20).toString('hex'),secret=randomBytes(40).toString('hex');const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'sale-edit',name:'Sale edit',adminName:'Owner',email:'edit-owner@test.invalid',password});
  await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'sale-edit-other',name:'Other',adminName:'Other',email:'edit-other@test.invalid',password});
  const owner=(await admin.query("SELECT id,password_hash FROM bansir.users WHERE email='edit-owner@test.invalid'")).rows[0],operator=randomUUID();await admin.query("INSERT INTO bansir.users(id,name,email,password_hash) VALUES($1,'Operator','edit-operator@test.invalid',$2)",[operator,owner.password_hash]);
  await admin.query("INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes) VALUES($1,$2,'operador',ARRAY['sales'])",[tenant.id,operator]);await admin.query("INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes) VALUES($1,$2,$3,'operador',ARRAY['sales'])",[tenant.id,tenant.establishmentId,operator]);
  const auth=createAuth(db,{jwtSecret:secret}),sessions={};for(const name of ['owner','operator','other'])sessions[name]=await auth.login({email:`edit-${name}@test.invalid`,password});
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test',onError:e=>{if(!e.status&&!e.issues)console.error(e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const send=async(path,method='GET',body,who='owner')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method,headers:{Authorization:'Bearer '+sessions[who].token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const product=(await send('/products','POST',{name:'Water with bottle',barcode:'EDIT-1',price:45,stock:10})).body.data;
  const cash=(await send('/pdv/cash/open','POST',{openingCents:0})).body.data;
  const sale=(await send('/sales','POST',{requestKey:randomUUID(),items:[{productId:product.id,quantity:1,expectedUnitPriceCents:4500}],customerName:'Original',payment:{method:'cash',confirmed:true,receivedCents:5000}})).body.data;
  assert.equal((await send(`/pdv/cash/${cash.id}/close`,'POST',{countedCents:4500,note:''})).status,200);
  const before=(await admin.query('SELECT row_to_json(c) AS row FROM bansir.cash_sessions c WHERE id=$1',[cash.id])).rows[0].row;
  const ledger=(await admin.query('SELECT row_to_json(p) AS row FROM bansir.sale_payments p WHERE sale_id=$1',[sale.id])).rows.map(x=>x.row);
  const profile={cfop:'5102',ncm:'22011000',cest:'0302500',taxes:{ICMS:{ICMSSN102:{orig:0,CSOSN:'102'}},PIS:{PISOutr:{CST:'49',vBC:0,pPIS:0,vPIS:0}},COFINS:{COFINSOutr:{CST:'49',vBC:0,pCOFINS:0,vCOFINS:0}}}};
  const body={requestKey:randomUUID(),revision:0,reason:'Customer and fiscal review before invoice',customer:{name:'Corrected customer',document:'11222333000181',phone:'67999991111',address:'Rua Fiscal, 10',email:'',notes:'Reference',fiscal:{indIEDest:9,enderDest:{xLgr:'Rua Fiscal',nro:'10',xBairro:'Centro',xMun:'Bonito',UF:'MS',cMun:'5002209',CEP:'79290000'}}},deliveryAddress:'Rua Fiscal, 10',itemProfiles:[{position:1,ncm:'22011000',fiscalProfile:{'55':profile}}]};
  await t.test('closed cash allows reviewed corrections; receipt, fiscal draft and audit agree',async()=>{
   const r=await send(`/sales/${sale.id}/edit`,'PATCH',body);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.data.revision,1);assert.equal(r.body.data.receipt_address,'Rua Fiscal, 10');assert.equal(r.body.data.customer_name,'Corrected customer');assert.equal(r.body.data.total_cents,4500);assert.equal(r.body.data.saleNumber,sale.saleNumber);
   assert.equal((await send(`/sales/${sale.id}/edit`,'PATCH',body)).body.data.revision,1);
   const draft=(await send(`/sales/${sale.id}/fiscal-draft?model=55`)).body.data;assert.equal(draft.det[0].prod.NCM,'22011000');assert.equal(draft.det[0].prod.CFOP,'5102');assert.equal(draft.det[0].imposto.ICMS.ICMSSN102.CSOSN,'102');assert.equal(nfeRecipient.safeParse(draft.dest).success,true);
   const view=(await send(`/sales/${sale.id}/edit`)).body.data;assert.equal(view.history.length,1);assert.equal(view.history[0].reason,body.reason);
   assert.deepEqual((await admin.query('SELECT row_to_json(c) AS row FROM bansir.cash_sessions c WHERE id=$1',[cash.id])).rows[0].row,before);assert.deepEqual((await admin.query('SELECT row_to_json(p) AS row FROM bansir.sale_payments p WHERE sale_id=$1',[sale.id])).rows.map(x=>x.row),ledger);assert.equal((await admin.query('SELECT stock FROM bansir.products WHERE id=$1',[product.id])).rows[0].stock,9);assert.equal((await admin.query('SELECT ncm FROM bansir.products WHERE id=$1',[product.id])).rows[0].ncm,'');
  });
  await t.test('RBAC, scope, idempotency and optimistic concurrency protect corrections',async()=>{
   assert.equal((await send(`/sales/${sale.id}/edit`,'PATCH',body,'operator')).status,403);assert.equal((await send(`/sales/${sale.id}/edit`,'PATCH',body,'other')).status,404);
   assert.equal((await send(`/sales/${sale.id}/edit`,'PATCH',{...body,reason:'Changed same request'})).body.code,'IDEMPOTENCY_CONFLICT');
   assert.equal((await send(`/sales/${sale.id}/edit`,'PATCH',{...body,requestKey:randomUUID()})).body.code,'STALE_SALE');
   const results=await Promise.all([1,2].map(n=>send(`/sales/${sale.id}/edit`,'PATCH',{...body,requestKey:randomUUID(),revision:1,reason:'Concurrent reviewed correction '+n})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
   const valueChange=await send(`/sales/${sale.id}/edit`,'PATCH',{...body,requestKey:randomUUID(),revision:2,totalCents:100});assert.equal(valueChange.status,400);
  });
  await t.test('sales manager cannot change taxes without fiscal permission',async()=>{
   await admin.query("UPDATE bansir.establishment_memberships SET allowed_routes=ARRAY['sales','sales-manage'] WHERE user_id=$1",[operator]);
   assert.equal((await send(`/sales/${sale.id}/edit`,'PATCH',{...body,requestKey:randomUUID(),revision:2},'operator')).status,403);
   const {itemProfiles,...customerOnly}=body;assert.equal((await send(`/sales/${sale.id}/edit`,'PATCH',{...customerOnly,requestKey:randomUUID(),revision:2},'operator')).status,200);
  });
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db.close();await admin.end();}
});
