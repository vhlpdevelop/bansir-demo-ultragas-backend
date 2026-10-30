import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {createAuth} from '../src/postgres/auth.js';
import {provisionTenant} from '../src/postgres/provision.js';

test('Settings delegation is granular and reports cover business modules without secrets or cross-unit data',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async()=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL}),db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL});await admin.connect();let server;
 try{
  const password=randomBytes(20).toString('hex'),secret=randomBytes(48).toString('hex');
  const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'settings-report-test',name:'Settings reports',adminName:'Owner',email:'settings-owner@example.invalid',password});
  await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'settings-report-other',name:'Other',adminName:'Other',email:'settings-other@example.invalid',password});
  const owner=(await admin.query("SELECT id,password_hash FROM bansir.users WHERE email='settings-owner@example.invalid'")).rows[0];
  const rights={personal:[],store:['settings-store'],fiscal:['settings-fiscal'],terminals:['settings-terminals'],whatsapp:['settings-whatsapp'],reporter:['reports'],notify:['fiscal-notify']};
  for(const [name,routes] of Object.entries(rights)){
   const id=randomUUID();await admin.query('INSERT INTO bansir.users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[id,name,`settings-${name}@example.invalid`,owner.password_hash]);
   await admin.query("INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'operador')",[tenant.id,id]);
   await admin.query("INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes) VALUES($1,$2,$3,'operador',$4)",[tenant.id,tenant.establishmentId,id,routes]);
  }
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test'}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const auth=createAuth(db,{jwtSecret:secret}),sessions={};
  for(const name of ['owner','other',...Object.keys(rights)])sessions[name]=await auth.login({email:`settings-${name}@example.invalid`,password});
  const send=async(path,body,who='owner',method=body===undefined?'GET':'POST')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessions[who].token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};};
  for(const path of ['/settings','/fiscal/settings','/settings/hardware','/pdv/terminals','/whatsapp/status'])assert.equal((await send(path,undefined,'personal')).status,403,path);
  assert.equal((await send('/auth/me',undefined,'personal')).status,200);
  assert.equal((await send('/auth/me',{name:'Personal user',phone:'123'},'personal','PUT')).status,200);
  assert.equal((await send('/settings',undefined,'store')).status,200);
  assert.equal((await send('/settings',{storeName:'Delegated store',contact:'65999998888'},'store','PUT')).status,200);
  assert.equal((await send('/settings',undefined,'store')).body.data.contact,'65999998888');
  for(const path of ['/fiscal/settings','/whatsapp/status','/pdv/terminals'])assert.equal((await send(path,undefined,'store')).status,403,path);
  assert.equal((await send('/fiscal/certificate',{},'store')).status,403);
  assert.equal((await send('/fiscal/settings',undefined,'fiscal')).status,200);
  assert.equal((await send('/fiscal/monitor',undefined,'fiscal')).status,200);
  assert.equal((await send('/fiscal/certificate',{},'fiscal')).status,400);
  assert.equal((await send('/settings',undefined,'fiscal')).status,403);
  assert.equal((await send('/fiscal/documents',undefined,'fiscal')).status,403);
  assert.equal((await send('/fiscal/documents',undefined,'notify')).status,403);
  assert.equal((await send('/pdv/terminals',undefined,'terminals')).status,200);
  assert.equal((await send('/pdv/terminals',{name:'Delegated terminal'},'terminals')).status,201);
  assert.equal((await send('/settings/hardware',undefined,'terminals')).status,200);
  assert.equal((await send('/bridge/tokens',undefined,'terminals')).status,200);
  assert.equal((await send('/sales',undefined,'terminals')).status,403);
  assert.equal((await send('/pdv/terminals/pair',{code:'A'.repeat(24)},'terminals')).status,403);
  assert.equal((await send('/whatsapp/status',undefined,'whatsapp')).status,200);
  assert.equal((await send('/whatsapp/greeting',{enabled:false,message:'Test only'},'whatsapp','PUT')).status,200);
  assert.equal((await send('/whatsapp/onboarding/config',undefined,'whatsapp')).status,200);
  assert.equal((await send('/fiscal/settings',undefined,'whatsapp')).status,403);
  const opened=await send('/pdv/cash/open',{openingCents:5000});assert.equal(opened.status,201,JSON.stringify(opened.body));
  const product=(await send('/products',{name:'Gas report',barcode:'REPORT-GAS',price:10,stock:10})).body.data;
  const driver=(await send('/deliverers',{name:'Report Driver',phone:''})).body.data;
  await send('/deliverers',{name:'Other Driver',phone:''});
  const saleResponse=await send('/sales',{requestKey:randomUUID(),items:[{productId:product.id,quantity:1,expectedUnitPriceCents:1000}],customerName:'Customer report',customerPhone:'65999998888',deliveryMode:'delivery',deliveryEmployeeId:driver.id,deliveryAddress:'Test street 100',payment:{method:'cash',receivedCents:1000,confirmed:true}});
  assert.equal(saleResponse.status,201,JSON.stringify(saleResponse.body));const sale=saleResponse.body.data;
  assert.ok(sale?.id);
  assert.equal((await send(`/deliveries/tasks/${sale.id}/actions`,{requestKey:randomUUID(),version:1,action:'depart'})).status,200);
  assert.equal((await send(`/deliveries/tasks/${sale.id}/actions`,{requestKey:randomUUID(),version:2,action:'complete'})).status,200);
  await admin.query("INSERT INTO bansir.storefronts(tenant_id,establishment_id,slug,enabled,config) VALUES($1,$2,'report-store',true,'{}')",[tenant.id,tenant.establishmentId]);
  const checkout=(await admin.query("INSERT INTO bansir.checkout_sessions(tenant_id,establishment_id,token_hash,phone) VALUES($1,$2,$3,'5565999998888') RETURNING id",[tenant.id,tenant.establishmentId,randomBytes(32).toString('hex')])).rows[0];
  await admin.query("INSERT INTO bansir.storefront_orders(tenant_id,establishment_id,checkout_session_id,request_key,request_hash,phone,customer_name,delivery_address,fulfillment,zone_id,items,subtotal_cents,shipping_cents,total_cents,status,sale_id) VALUES($1,$2,$3,$4,'test','5565999998888','New order','Test street','delivery','', '[]',1000,0,1000,'new',NULL),($1,$2,$3,$5,'test','5565999998888','Accepted order','Test street','delivery','', '[]',1000,0,1000,'accepted',$6)",[tenant.id,tenant.establishmentId,checkout.id,randomUUID(),randomUUID(),sale.id]);
  const day=(await admin.query("SELECT to_char(now() AT TIME ZONE 'America/Cuiaba','YYYY-MM-DD') AS day")).rows[0].day,query=`?startDate=${day}&endDate=${day}`;
  const catalog=(await send('/reports/catalog')).body.data;assert.ok(catalog.modes.length>=30);
  for(const mode of catalog.modes.filter(m=>m.available)){const r=await send('/reports/summary'+query+'&mode='+mode.key);assert.equal(r.status,200,mode.key+': '+JSON.stringify(r.body));}
  const deliveries=(await send('/reports/summary'+query+'&mode=entregadores')).body.data;
  assert.equal(Number(deliveries.rows.find(r=>r[0]==='Report Driver')[2]),1);assert.equal(Number(deliveries.rows.find(r=>r[0]==='Other Driver')[2]),0);
  const consolidated=(await send('/reports/summary'+query)).body.data;assert.equal(consolidated.kpis.salesCount,1);assert.equal(consolidated.sections.find(s=>s.key==='pedidos').rows.length,2);assert.equal(consolidated.sections.find(s=>s.key==='entregas').rows.length,1);
  assert.equal((await send('/reports/summary'+query+'&mode=entregas&driverId='+driver.id,undefined,'other')).body.data.rows.length,0);
  assert.equal((await send('/reports/summary'+query+'&mode=acessos',undefined,'reporter')).status,403);
  assert.equal((await send('/reports/summary'+query+'&mode=configuracoes',undefined,'reporter')).status,403);
  const pdf=await send('/reports/pdf'+query);assert.equal(pdf.status,200);assert.equal(Buffer.from(pdf.body.data.base64,'base64').subarray(0,5).toString(),'%PDF-');
  const csv=await send('/reports/csv'+query);assert.equal(csv.status,200);const text=Buffer.from(csv.body.data.base64,'base64').toString();assert.ok(text.includes('Report Driver'));for(const secret of ['password_hash','encrypted_bundle','token_hash','collector_hash','latitude','longitude'])assert.equal(text.includes(secret),false,secret);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db.close();await admin.end();}
});

