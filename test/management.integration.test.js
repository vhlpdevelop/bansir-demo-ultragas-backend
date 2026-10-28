import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {createAuth} from '../src/postgres/auth.js';
import {provisionTenant,assignPlan,createEstablishment} from '../src/postgres/provision.js';
test('Management PostgreSQL: finance, employees, pricing, commissions and reports',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async t=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL,max:8});let server;
 try{
  const password=randomBytes(20).toString('hex'),secret=randomBytes(48).toString('hex'),tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'management-test',name:'Management',adminName:'Owner',email:'management@test.invalid',password});
  const actor=(await admin.query("SELECT id,password_hash FROM bansir.users WHERE email='management@test.invalid'")).rows[0];
  await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,code:'management-two',name:'Two',maxEstablishments:2});const other=await createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,name:'Other',memberships:[{userId:actor.id,role:'admin',allowedRoutes:[]}]});
  const reader=randomUUID();await admin.query("INSERT INTO bansir.users(id,email,name,password_hash) VALUES($1,'management-reader@test.invalid','Reader',$2)",[reader,actor.password_hash]);for(const table of ['tenant_memberships','establishment_memberships']){if(table==='tenant_memberships')await admin.query("INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes) VALUES($1,$2,'operador',ARRAY['financial-payables'])",[tenant.id,reader]);else await admin.query("INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes) VALUES($1,$2,$3,'operador',ARRAY['financial-payables'])",[tenant.id,tenant.establishmentId,reader]);}
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test',onError:e=>{if(!e.status&&!e.issues)console.error('Management test diagnostic',e.code,e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/v1`,auth=createAuth(db,{jwtSecret:secret});
  const login=async unit=>{const s=await auth.login({email:'management@test.invalid',password});return auth.select({selectionToken:s.selectionToken,tenantId:tenant.id,establishmentId:unit});};const session=await login(tenant.establishmentId),foreign=await login(other.establishmentId),read=await auth.login({email:'management-reader@test.invalid',password});
  const send=async(path,method='GET',body,token=session.token)=>{const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const employeeBody={name:'Seller',email:'seller@test.invalid',roleTitle:'Caixa',laborType:'MOD',baseSalary:2000,commissionType:'percentage',commissionValue:5,userId:actor.id};let employee,sale,manual;
  await t.test('employee CRUD is unit-scoped, admin-only and linked to an existing unit user',async()=>{
   let r=await send('/employees','POST',employeeBody);assert.equal(r.status,201,JSON.stringify(r));employee=r.body.data;assert.equal(employee.baseSalary,2000);
   assert.equal((await send('/employees','GET',undefined,foreign.token)).body.data.length,0);assert.equal((await send('/employees','GET',undefined,read.token)).status,403);
   assert.equal((await send('/employees/'+employee.id,'PUT',employeeBody,foreign.token)).status,404);assert.equal((await send('/employees','POST',{...employeeBody,userId:randomUUID()})).status,400);
  });
  const entry=()=>({requestKey:randomUUID(),title:'Conta energia',type:'expense',category:'energia',amount:100,paymentMethod:'pix',status:'pending',dueDate:'2026-12-01'});
  await t.test('manual payable is idempotent; confirmation occurs once and restricted reader cannot see income or mutate',async()=>{
   const input=entry(),r=await Promise.all(Array.from({length:3},()=>send('/financial/transactions','POST',input)));assert.ok(r.every(x=>x.status===201),JSON.stringify(r));assert.equal(new Set(r.map(x=>x.body.data.id)).size,1);manual=r[0].body.data;
   assert.equal((await send('/financial/transactions','POST',{...input,amount:101})).status,409);
   assert.equal((await send('/financial/summary')).body.data.kpis.payable,100);
   assert.equal((await send('/financial/transactions?type=expense','GET',undefined,read.token)).status,200);assert.equal((await send('/financial/transactions?type=income','GET',undefined,read.token)).status,403);assert.equal((await send('/financial/summary','GET',undefined,read.token)).status,403);
   assert.equal((await send('/financial/transactions/'+manual.id+'/status','PATCH',{status:'completed'},read.token)).status,403);
   for(let n=0;n<2;n++)assert.equal((await send('/financial/transactions/'+manual.id+'/status','PATCH',{status:'completed'})).status,200);
   assert.equal((await send('/financial/summary')).body.data.kpis.totalExpenses,100);assert.equal((await send('/financial/summary','GET',undefined,foreign.token)).body.data.kpis.totalExpenses,0);
  });
  await t.test('PDV payments flow into finance once; paid commissions retain their original rate; refunds offset receipts',async()=>{
   await send('/pdv/cash/open','POST',{openingCents:0});const product=(await send('/products','POST',{name:'Gas management',barcode:'MGMT-1',price:150,costPrice:100,stock:20})).body.data;
   let r=await send('/sales','POST',{requestKey:randomUUID(),items:[{productId:product.id,quantity:1,expectedUnitPriceCents:15000}],payment:{method:'cash',confirmed:true,receivedCents:15000}});assert.equal(r.status,201,JSON.stringify(r));sale=r.body.data;
   assert.equal((await send('/financial/summary')).body.data.kpis.totalRevenue,150);let e=(await send('/employees')).body.data[0];assert.equal(e.totalSalesCount,1);assert.equal(e.totalCommissionsEarned,7.5);
   await send('/employees/'+employee.id,'PUT',{...employeeBody,commissionValue:10});e=(await send('/employees')).body.data[0];assert.equal(e.totalCommissionsEarned,7.5);
   const customer=(await send('/customers','POST',{name:'Management customer',phone:'65999996666'})).body.data;const pending=await send('/sales','POST',{customerId:customer.id,requestKey:randomUUID(),items:[{productId:product.id,quantity:1,expectedUnitPriceCents:15000}],payment:{method:'pending',term:'credit',dueDate:'2026-12-01'}});assert.equal(pending.status,201,JSON.stringify(pending));
   assert.equal((await send('/financial/summary')).body.data.kpis.receivable,150);assert.equal((await send('/employees')).body.data[0].totalSalesCount,1);
   await send('/sales/'+sale.id+'/cancel','POST',{reason:'Management test refund',refundConfirmed:true});assert.equal((await send('/financial/summary')).body.data.kpis.netIncome,-100);assert.equal((await send('/employees')).body.data[0].totalSalesCount,0);
  });
  await t.test('employee advances atomically add one expense and reject cross-unit employee or decreasing vehicle KM',async()=>{
   const input={requestKey:randomUUID(),employeeId:employee.id,amount:50,justification:'Adiantamento teste'};
   const results=await Promise.all([send('/employees/vouchers','POST',input),send('/employees/vouchers','POST',input)]);assert.ok(results.every(r=>[200,201].includes(r.status)),JSON.stringify(results));assert.equal(new Set(results.map(r=>r.body.data.id)).size,1);
   assert.equal((await send('/financial/summary')).body.data.kpis.totalExpenses,300); // energy + refund + advance
   assert.equal((await send('/employees/vouchers','POST',{...input,requestKey:randomUUID()},foreign.token)).status,404);
   const v=(await send('/fleet/vehicles','POST',{name:'Truck',code:'MGMT-TRUCK',currentKm:100})).body.data;
   assert.equal((await send('/employees/vouchers','POST',{...input,requestKey:randomUUID(),vehicleId:v.id,vehicleKm:99})).status,400);
   assert.equal((await send('/employees/vouchers')).body.data.length,1);
   const advanceId=results[0].body.data.id;for(let n=0;n<2;n++)assert.equal((await send('/employees/vouchers/'+advanceId+'/discount','POST',{reference:'Folha teste'})).status,200);
   assert.equal((await send('/employees/vouchers/'+advanceId+'/discount','POST',{reference:'Outra folha'})).status,409);
   assert.equal((await send('/financial/summary')).body.data.kpis.totalExpenses,300);
  });
  await t.test('pricing preserves the pure legacy calculation with isolated settings and real employee payroll',async()=>{
   const p=await send('/financial/pricing-intelligence');assert.equal(p.status,200,JSON.stringify(p));assert.equal(p.body.data.workforce.totalPayroll,2000);
   assert.equal((await send('/financial/pricing-intelligence','PUT',{pricingRules:{expectedMonthlyRevenue:0}})).status,400);
   assert.equal((await send('/financial/pricing-intelligence','PUT',{pricingRules:{taxRate:6,expectedMonthlyRevenue:60000}})).status,200);
   assert.equal((await send('/financial/pricing-intelligence','GET',undefined,foreign.token)).body.data.pricingRules.taxRate,0);
  });
  await t.test('reports include all six modes, real fiscal status, valid PDF and unit isolation',async()=>{
   const now=new Date().toISOString().slice(0,10),query='?startDate='+now+'&endDate='+now;
   for(const mode of ['consolidado','vendas','estoque','fiscal','funcionarios','vales']){const r=await send('/reports/summary'+query+'&mode='+mode);assert.equal(r.status,200,JSON.stringify(r));assert.ok(Array.isArray(r.body.data.rows));}
   const r=await send('/reports/pdf'+query+'&mode=vendas');assert.equal(r.status,200,JSON.stringify(r));assert.equal(Buffer.from(r.body.data.base64,'base64').subarray(0,5).toString(),'%PDF-');
   assert.equal((await send('/reports/summary'+query,'GET',undefined,read.token)).status,403);assert.equal((await send('/reports/summary'+query,'GET',undefined,foreign.token)).body.data.rows.length,0);
   assert.equal((await send('/reports/summary?startDate=2026-12-31&endDate=2026-01-01')).status,400);
  });
 }finally{if(server)await new Promise(r=>server.close(r));await db.pool.end();await admin.end();}
});
