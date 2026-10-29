import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {createAuth} from '../src/postgres/auth.js';
import {provisionTenant,assignPlan,createEstablishment} from '../src/postgres/provision.js';

test('PDV terminals: enrollment, cash provenance, RBAC and receipt authorization',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async t=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();
 const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL,max:8});let server;
 try{
  const password=randomBytes(20).toString('hex'),jwtSecret=randomBytes(48).toString('hex');
  const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'terminals-a',name:'Terminals A',adminName:'Manager',email:'terminal-admin@test.invalid',password});
  await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'terminals-b',name:'Terminals B',adminName:'Other',email:'terminal-other@test.invalid',password});
  const owner=(await admin.query("SELECT id,password_hash FROM bansir.users WHERE email='terminal-admin@test.invalid'")).rows[0];
  await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,code:'terminal-two',name:'Test',maxEstablishments:2});
  const unit=await createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,name:'Other unit',memberships:[{userId:owner.id,role:'admin',allowedRoutes:[]}]});
  for(const [email,routes] of [['terminal-operator@test.invalid',['sales']],['terminal-reader@test.invalid',['products']]]){
   const id=randomUUID();await admin.query('INSERT INTO bansir.users(id,email,name,password_hash) VALUES($1,$2,$2,$3)',[id,email,owner.password_hash]);
   await admin.query("INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes) VALUES($1,$2,'operador',$3)",[tenant.id,id,routes]);
   await admin.query("INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes) VALUES($1,$2,$3,'operador',$4)",[tenant.id,tenant.establishmentId,id,routes]);
  }
  server=createPostgresApp({database:db,jwtSecret,nodeEnv:'test'}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api/v1`,auth=createAuth(db,{jwtSecret});
  const login=async email=>{const s=await auth.login({email,password});return s.requiresEstablishmentSelection?auth.select({selectionToken:s.selectionToken,tenantId:tenant.id,establishmentId:tenant.establishmentId}):s;};
  const session=await login('terminal-admin@test.invalid'),operator=await login('terminal-operator@test.invalid'),reader=await login('terminal-reader@test.invalid'),foreign=await login('terminal-other@test.invalid');
  const select=await auth.login({email:'terminal-admin@test.invalid',password}),otherUnit=await auth.select({selectionToken:select.selectionToken,tenantId:tenant.id,establishmentId:unit.establishmentId});
  const send=async(path,method='GET',body,token=session.token,terminal)=>{const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(terminal?{'X-Pdv-Terminal':terminal}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const create=async name=>(await send('/pdv/terminals','POST',{name})).body.data;
  const activate=async id=>send(`/pdv/terminals/${id}/activation`,'POST',{});
  const pair=async code=>send('/pdv/terminals/pair','POST',{code});
  const open=(token,terminal)=>send('/pdv/cash/open','POST',{openingCents:0},token,terminal);
  const close=async(token,terminal)=>{const cash=(await send('/pdv/cash','GET',undefined,token)).body.data;return send(`/pdv/cash/${cash.id}/close`,'POST',{countedCents:cash.expected_cents,note:''},token,terminal);};
  let first,second,binding1,binding2,legacy;
  await t.test('registration and activation are scoped and admin-only',async()=>{
   legacy=(await open(session.token)).body.data;assert.equal(legacy.terminal_id,null);
   assert.equal((await send('/pdv/terminals','POST',{name:'Denied'},operator.token)).status,403);
   assert.equal((await send('/pdv/terminals','GET',undefined,reader.token)).status,403);
   first=await create('Terminal 1');second=await create('Terminal 2');assert.ok(first.id&&second.id);
   assert.equal((await send('/pdv/terminals','POST',{name:'terminal 1'})).status,409);
   assert.equal((await send(`/pdv/terminals/${first.id}/activation`,'POST',{},operator.token)).status,403);
   assert.equal((await send(`/pdv/terminals/${first.id}/activation`,'POST',{},foreign.token)).status,404);
   assert.equal((await send(`/pdv/terminals/${first.id}/activation`,'POST',{},otherUnit.token)).status,404);
   const code=(await activate(first.id)).body.data.code;binding1=(await pair(code)).body.data.token;assert.match(binding1,/^pdvt_/);
   assert.equal((await pair(code)).status,400);
   assert.equal((await open(operator.token)).body.code,'TERMINAL_REQUIRED');
   const expired=(await activate(second.id)).body.data.code;
   await admin.query("UPDATE bansir.pdv_terminals SET activation_expires_at=now()-interval '1 second' WHERE id=$1",[second.id]);
   assert.equal((await pair(expired)).status,400);
   binding2=(await pair((await activate(second.id)).body.data.code)).body.data.token;
   const info=await send('/pdv/terminals','GET',undefined,session.token,binding1);
   assert.equal(info.body.data.current.id,first.id);assert.equal(info.body.data.required,true);
   assert.equal(JSON.stringify(info.body).includes('device_hash'),false);assert.equal(JSON.stringify(info.body).includes(binding1),false);
   assert.deepEqual((await send('/pdv/terminals','GET',undefined,foreign.token,binding1)).body.data.terminals,[]);
   assert.equal((await open(foreign.token,binding1)).status,409);
  });
  await t.test('legacy shifts keep their real origin and can close after enrollment',async()=>{
   assert.equal((await open(session.token,binding1)).body.code,'LEGACY_CASH_CLOSE_REQUIRED');
   const ended=await close(session.token);assert.equal(ended.status,200);assert.equal(ended.body.data.terminal_id,null);
   assert.equal(ended.body.data.opened_at,legacy.opened_at);assert.ok(ended.body.data.closed_at);
  });
  let cash1,sale;
  await t.test('one active shift per terminal, exact user and terminal provenance, no client spoofing',async()=>{
   const results=await Promise.all([open(session.token,binding1),open(operator.token,binding1)]);
   assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
   // Use the winner consistently; if it was the operator, close before the owner opens.
   if(results[1].status===201){assert.equal((await close(operator.token,binding1)).status,200);cash1=(await open(session.token,binding1)).body.data;}else cash1=results[0].body.data;
   assert.equal(cash1.terminal_id,first.id);assert.equal(cash1.terminal_name,'Terminal 1');assert.equal(cash1.user_id,owner.id);
   assert.equal((await open(session.token,binding2)).body.code,'CASH_TERMINAL_MISMATCH');
   assert.equal((await open(operator.token,binding2)).status,201);
   assert.equal((await activate(first.id)).body.code,'TERMINAL_BUSY');
   assert.equal((await send(`/pdv/terminals/${first.id}`,'PATCH',{active:false})).body.code,'TERMINAL_BUSY');
   const p=(await send('/products','POST',{name:'Gas',barcode:'TERM-GAS',price:100,stock:10})).body.data;
   const order=()=>({requestKey:randomUUID(),items:[{productId:p.id,quantity:1,expectedUnitPriceCents:10000}],payment:{method:'credit_card',confirmed:true,installments:2}});
   assert.equal((await send('/sales','POST',order(),session.token,binding2)).body.code,'CASH_TERMINAL_MISMATCH');
   assert.equal((await send('/sales','POST',order())).body.code,'TERMINAL_REQUIRED');
   assert.equal((await send('/sales','POST',{...order(),terminalId:second.id},session.token,binding1)).status,400);
   const body=order(),sold=await send('/sales','POST',body,session.token,binding1);assert.equal(sold.status,201,JSON.stringify(sold));sale=sold.body.data;
   assert.equal(sale.terminal_id,first.id);assert.equal(sale.terminal_name,'Terminal 1');assert.equal(sale.created_by,owner.id);
   assert.equal(sale.payments[0].terminal_id,first.id);assert.equal(sale.payments[0].paid_by,owner.id);
   assert.equal((await send('/pdv/cash/movements','POST',{requestKey:randomUUID(),kind:'deposit',amountCents:100,reason:'Test deposit'},session.token,binding2)).body.code,'CASH_TERMINAL_MISMATCH');
   assert.equal((await send(`/sales/${sale.id}/payments`,'POST',{requestKey:randomUUID(),method:'pix',confirmed:true,amountCents:100},session.token,binding2)).body.code,'CASH_TERMINAL_MISMATCH');
   assert.equal((await send(`/sales/${sale.id}/cancel`,'POST',{reason:'Test cancellation',refundConfirmed:true,refundReference:'Test external refund'},session.token,binding2)).body.code,'CASH_TERMINAL_MISMATCH');
   assert.equal((await send('/sales','POST',body,session.token,binding1)).body.data.id,sale.id);
   assert.equal((await send(`/pdv/cash/${cash1.id}/close`,'POST',{countedCents:0,note:''},session.token,binding2)).status,409);
   await assert.rejects(db.transaction({userId:owner.id,tenantId:tenant.id,establishmentId:tenant.establishmentId},c=>c.query('UPDATE bansir.cash_sessions SET terminal_id=$2 WHERE id=$1',[cash1.id,second.id])),e=>e.code==='23514');
  });
  await t.test('terminal reuse never grants access to another operator receipt (SEC-01)',async()=>{
   assert.equal((await send(`/sales/${sale.id}/receipt`,'GET',undefined,operator.token,binding2)).status,404);
   assert.equal((await close(session.token,binding1)).status,200);assert.equal((await close(operator.token,binding2)).status,200);
   assert.equal((await open(operator.token,binding1)).status,201);
   assert.equal((await send(`/sales/${sale.id}`,'GET',undefined,operator.token,binding1)).status,404);
   assert.equal((await send(`/sales/${sale.id}/receipt`,'GET',undefined,operator.token,binding1)).status,404);
   assert.equal((await send(`/sales/${sale.id}/receipt`,'GET',undefined,session.token,binding1)).status,200);
   assert.equal((await close(operator.token,binding1)).status,200);
  });
  await t.test('admin can recover a lost browser without rewriting or closing the cash origin',async()=>{
   const before=(await open(session.token,binding1)).body.data;
   assert.equal((await send(`/pdv/terminals/${first.id}/activation`,'POST',{recoveryReason:'Lost browser profile'},operator.token)).status,403);
   const issued=await send(`/pdv/terminals/${first.id}/activation`,'POST',{recoveryReason:'Lost browser profile'});assert.equal(issued.status,200);
   const replacement=await pair(issued.body.data.code);assert.equal(replacement.status,200);
   assert.equal((await open(session.token,binding1)).body.code,'TERMINAL_REVOKED');binding1=replacement.body.data.token;
   const after=(await open(session.token,binding1)).body.data;assert.equal(after.id,before.id);assert.equal(after.user_id,before.user_id);assert.equal(after.opened_at,before.opened_at);
   assert.equal((await close(session.token,binding1)).status,200);
  });
  await t.test('re-enrollment revokes old credential, disabling never bypasses enforcement, audit is append-only',async()=>{
   const code=(await activate(first.id)).body.data.code,newBinding=(await pair(code)).body.data.token;
   assert.equal((await open(session.token,binding1)).body.code,'TERMINAL_REVOKED');
   assert.equal((await open(session.token,newBinding)).status,201);assert.equal((await close(session.token,newBinding)).status,200);
   assert.equal((await send(`/pdv/terminals/${first.id}`,'PATCH',{active:false})).status,200);
   assert.equal((await send(`/pdv/terminals/${second.id}`,'PATCH',{active:false})).status,200);
   assert.equal((await open(session.token)).body.code,'TERMINAL_REQUIRED');
   assert.equal((await open(session.token,newBinding)).body.code,'TERMINAL_REVOKED');
   assert.equal((await send('/pdv/terminals/events','GET',undefined,operator.token)).status,403);
   const events=(await send('/pdv/terminals/events')).body.data;assert.ok(events.some(e=>e.event==='paired'&&e.user_name==='Manager'));
   assert.ok(events.some(e=>e.event==='recovery_issued'&&e.reason==='Lost browser profile'));
   const shifts=await send(`/pdv/terminals/${first.id}/cash-history`);assert.equal(shifts.status,200);assert.ok(shifts.body.data.some(s=>s.user_id===owner.id&&s.closed_at));
   assert.equal((await send(`/pdv/terminals/${first.id}/cash-history`,'GET',undefined,operator.token)).status,403);
   assert.equal((await send(`/pdv/terminals/${first.id}/cash-history`,'GET',undefined,foreign.token)).status,404);
   await assert.rejects(db.transaction({userId:owner.id,tenantId:tenant.id,establishmentId:tenant.establishmentId},c=>c.query('DELETE FROM bansir.pdv_terminal_events')),e=>e.code==='42501');
   const history=(await send('/pdv/cash/history')).body.data;assert.ok(history.some(c=>c.terminal_id===first.id&&c.closed_at));
   const original=(await send(`/sales/${sale.id}`)).body.data;assert.equal(original.terminal_name,'Terminal 1');
  });
 }finally{if(server)await new Promise(r=>server.close(r));await Promise.all([db.close(),admin.end()]);}
});
