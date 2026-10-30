import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {provisionTenant} from '../src/postgres/provision.js';
import {createAuth} from '../src/postgres/auth.js';

test('Route recommendations respect RBAC, apply ordered stops atomically and reject stale plans',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async()=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();
 const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL});let server;
 try{
  const password=randomBytes(20).toString('hex'),secret=randomBytes(48).toString('hex');
  const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'routing-test',name:'Delivery test',adminName:'Owner',email:'routing-owner@example.invalid',password});
  await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'routing-other',name:'Other',adminName:'Other',email:'routing-other@example.invalid',password});
  const owner=(await admin.query("SELECT id,password_hash FROM bansir.users WHERE email='routing-owner@example.invalid'")).rows[0];
  const users={};for(const [name,role,routes] of [['driver','entregador',['my-deliveries','my-deliveries-history']],['driver2','entregador',['my-deliveries','my-deliveries-history']],['viewer','operador',['dashboard']],['manager','operador',['deliveries-manage']],['cashier','operador',['sales']]]){
   const id=randomUUID();users[name]=id;await admin.query('INSERT INTO bansir.users(id,name,email,password_hash) VALUES($1,$2,$3,$4)',[id,name,`routing-${name}@example.invalid`,owner.password_hash]);
   await admin.query('INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes) VALUES($1,$2,$3,$4)',[tenant.id,id,role,routes]);
   await admin.query('INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes) VALUES($1,$2,$3,$4,$5)',[tenant.id,tenant.establishmentId,id,role,routes]);
  }
  let onGeometry;const fakeRouter={close(){},info:()=>({configured:true,status:'ready'}),matrix:async points=>({distances:points.map(a=>points.map(b=>Math.hypot(a.latitude-b.latitude,a.longitude-b.longitude)*100000)),durations:points.map(a=>points.map(b=>Math.hypot(a.latitude-b.latitude,a.longitude-b.longitude)*10000))}),geometry:async()=>{await onGeometry?.();return null;}};
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test',deliveryRouter:fakeRouter,onError:e=>{if(!e.status&&!e.issues)console.error(e.stack);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const auth=createAuth(db,{jwtSecret:secret}),sessions={};for(const name of ['owner','other','driver','driver2','viewer','manager','cashier'])sessions[name]=await auth.login({email:`routing-${name}@example.invalid`,password});
  const send=async(path,body,who='owner',method=body===undefined?'GET':'POST')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessions[who].token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};};
  const d=(await send('/deliverers',{name:'Driver test',phone:''})).body.data;
  const d2=(await send('/deliverers',{name:'Driver second',phone:''})).body.data;
  const linked=await send(`/deliveries/drivers/${d.id}/account`,{userId:users.driver},'owner','PUT');assert.equal(linked.status,200,JSON.stringify(linked.body));
  assert.equal((await send(`/deliveries/drivers/${d2.id}/account`,{userId:users.driver},'owner','PUT')).status,409);
  assert.equal((await send(`/deliveries/drivers/${d2.id}/account`,{userId:users.driver2},'owner','PUT')).status,200);
  assert.equal((await send('/deliveries/snapshot',undefined,'driver')).status,403);
  assert.equal((await send('/deliveries/mine',undefined,'manager')).status,403);
  await send('/pdv/cash/open',{openingCents:5000});
  const p=(await send('/products',{name:'Delivery product',barcode:'DELIVERY-TEST',price:10,stock:10})).body.data;
  const sale=(await send('/sales',{requestKey:randomUUID(),items:[{productId:p.id,quantity:1,expectedUnitPriceCents:1000}],customerName:'Delivery customer',customerPhone:'65999998888',deliveryMode:'delivery',deliveryAddress:'Test destination street 100',payment:{method:'pending',term:'delivery'}})).body.data;

  await admin.query("INSERT INTO bansir.storefronts(tenant_id,establishment_id,slug,config) VALUES($1,$2,'routing-store',$3)",[tenant.id,tenant.establishmentId,{location:{latitude:-15.6,longitude:-56.1}}]);
  assert.equal((await send(`/deliveries/drivers/${d.id}/color`,{color:'#e11d48'},'manager','PUT')).status,403);
  assert.equal((await send(`/deliveries/drivers/${d.id}/color`,{color:'#e11d48'},'other','PUT')).status,404);
  assert.equal((await send(`/deliveries/drivers/${d.id}/color`,{color:'red'},'owner','PUT')).status,400);
  assert.equal((await send(`/deliveries/drivers/${d.id}/color`,{color:'#e11d48'},'owner','PUT')).status,200);
  assert.equal((await send(`/deliveries/drivers/${d2.id}/color`,{color:'#E11D48'},'owner','PUT')).body.code,'COLOR_IN_USE');
  const collector=randomUUID();await send('/deliveries/work/start',{collector},'driver');
  await send('/deliveries/work/position',{collector,sequence:1,latitude:-15.61,longitude:-56.11,accuracy:15,capturedAt:new Date().toISOString()},'driver');
  await admin.query("UPDATE bansir.delivery_tasks SET latitude=-15.62,longitude=-56.12,accuracy=0 WHERE sale_id=$1",[sale.id]);
  const recommendation=await send(`/deliveries/tasks/${sale.id}/recommendations`);assert.equal(recommendation.status,200,JSON.stringify(recommendation.body));assert.equal(recommendation.body.data.recommendedDriverId,d.id);assert.equal(recommendation.body.data.model,'road');
  assert.equal((await send(`/deliveries/tasks/${sale.id}/recommendations`,undefined,'driver')).status,403);
  assert.equal((await send(`/deliveries/tasks/${sale.id}/recommendations`,undefined,'cashier')).status,403);
  assert.equal((await send(`/deliveries/tasks/${sale.id}/recommendations`,undefined,'other')).status,404);
  assert.equal((await send('/deliveries/map',undefined,'viewer')).status,403);assert.equal((await send('/deliveries/map',undefined,'manager')).status,403);
  const map=await send('/deliveries/map');assert.equal(map.status,200,JSON.stringify(map.body));assert.equal(map.body.data.routes.find(r=>r.driverId===d.id).color,'#e11d48');assert.equal(map.body.data.routes.find(r=>r.driverId===d.id).position.latitude,-15.61);assert.notEqual(map.body.data.routes[0].color,map.body.data.routes[1].color);assert.equal(JSON.stringify(map.body).includes('collector_hash'),false);
  onGeometry=async()=>{onGeometry=null;await send('/deliveries/work/stop',{collector},'driver');};const pausedMap=await send('/deliveries/map');assert.equal(pausedMap.body.data.routes.find(r=>r.driverId===d.id).position,null);
  await send('/deliveries/work/start',{collector},'driver');await send('/deliveries/work/position',{collector,sequence:1,latitude:-15.61,longitude:-56.11,accuracy:15,capturedAt:new Date().toISOString()},'driver');
  const c=recommendation.body.data.candidates.find(c=>c.driverId===d.id),routePlan={destinationRevision:recommendation.body.data.destinationRevision,routeRevision:c.routeRevision,insertionIndex:c.insertionIndex,expiresAt:recommendation.body.data.expiresAt};
  const assigned=await send(`/deliveries/tasks/${sale.id}/assign`,{requestKey:randomUUID(),driverId:d.id,version:1,routePlan});assert.equal(assigned.status,200,JSON.stringify(assigned.body));
  const task=(await send('/deliveries/mine',undefined,'driver')).body.data.tasks[0];assert.equal(task.route_order,1);
  const second=(await send('/sales',{requestKey:randomUUID(),items:[{productId:p.id,quantity:1,expectedUnitPriceCents:1000}],customerName:'Second',customerPhone:'65999997777',deliveryMode:'delivery',deliveryAddress:'Other destination street 200',payment:{method:'pending',term:'delivery'}})).body.data;
  await admin.query("UPDATE bansir.delivery_tasks SET latitude=-15.615,longitude=-56.115,accuracy=0 WHERE sale_id=$1",[second.id]);
  const fresh=(await send(`/deliveries/tasks/${second.id}/recommendations`)).body.data;
  const chosen=fresh.candidates.find(c=>c.driverId===d.id),proposal={destinationRevision:fresh.destinationRevision,routeRevision:chosen.routeRevision,insertionIndex:chosen.insertionIndex,expiresAt:fresh.expiresAt};assert.equal(proposal.insertionIndex,0);
  // A changed route invalidates the proposal and rolls back the entire assignment.
  await admin.query('UPDATE bansir.delivery_tasks SET version=version+1 WHERE sale_id=$1',[sale.id]);
  const stale=await send(`/deliveries/tasks/${second.id}/assign`,{requestKey:randomUUID(),driverId:d.id,version:1,routePlan:proposal});assert.equal(stale.status,409,JSON.stringify(stale.body));assert.equal(stale.body.code,'STALE_ROUTE');
  assert.equal((await admin.query('SELECT driver_id FROM bansir.delivery_tasks WHERE sale_id=$1',[second.id])).rows[0].driver_id,null);
  const fresh2=(await send(`/deliveries/tasks/${second.id}/recommendations`)).body.data,chosen2=fresh2.candidates.find(c=>c.driverId===d.id);
  const applied=await send(`/deliveries/tasks/${second.id}/assign`,{requestKey:randomUUID(),driverId:d.id,version:1,routePlan:{destinationRevision:fresh2.destinationRevision,routeRevision:chosen2.routeRevision,insertionIndex:chosen2.insertionIndex,expiresAt:fresh2.expiresAt}});assert.equal(applied.status,200,JSON.stringify(applied.body));
  const ordered=(await send('/deliveries/mine',undefined,'driver')).body.data.tasks;assert.deepEqual(ordered.map(t=>t.sale_id),[second.id,sale.id]);assert.deepEqual(ordered.map(t=>t.route_order),[1,2]);
  // Cashier can compare an incoming order without receiving any driver GPS or map access.
  const checkout=(await admin.query("INSERT INTO bansir.checkout_sessions(tenant_id,establishment_id,token_hash,phone) VALUES($1,$2,$3,'5565999998888') RETURNING id",[tenant.id,tenant.establishmentId,'a'.repeat(64)])).rows[0].id;
  const order=(await admin.query("INSERT INTO bansir.storefront_orders(tenant_id,establishment_id,checkout_session_id,request_key,request_hash,phone,customer_name,delivery_address,fulfillment,zone_id,items,subtotal_cents,shipping_cents,total_cents,delivery_location) VALUES($1,$2,$3,$4,'synthetic','5565999998888','Customer','New destination 300','delivery','test',$5,1000,0,1000,$6) RETURNING id",[tenant.id,tenant.establishmentId,checkout,randomUUID(),JSON.stringify([{productId:p.id,quantity:1,priceCents:1000,name:'Product'}]),{latitude:-15.617,longitude:-56.117,accuracy:0,confirmed:true,capturedAt:new Date().toISOString()}])).rows[0].id;
  const cashRec=await send(`/deliveries/orders/${order}/recommendations`,undefined,'cashier');assert.equal(cashRec.status,200,JSON.stringify(cashRec.body));assert.equal(cashRec.body.data.usesLivePositions,false);assert.equal(cashRec.body.data.candidates[0].originSource,'store');assert.equal(JSON.stringify(cashRec.body).includes('latitude'),false);assert.equal((await send('/deliveries/map',undefined,'cashier')).status,403);
  const acceptedPlan=cashRec.body.data.candidates.find(c=>c.driverId===d.id);
  const accepted=await send(`/storefront/orders/${order}/accept`,{customerConfirmed:true,deliveryEmployeeId:d.id,routePlan:{destinationRevision:cashRec.body.data.destinationRevision,routeRevision:acceptedPlan.routeRevision,insertionIndex:acceptedPlan.insertionIndex,expiresAt:cashRec.body.data.expiresAt}});assert.equal(accepted.status,201,JSON.stringify(accepted.body));
  const replay=await send(`/storefront/orders/${order}/accept`,{customerConfirmed:true,deliveryEmployeeId:d.id,routePlan:{destinationRevision:cashRec.body.data.destinationRevision,routeRevision:acceptedPlan.routeRevision,insertionIndex:acceptedPlan.insertionIndex,expiresAt:cashRec.body.data.expiresAt}});assert.equal(replay.status,200);assert.equal(replay.body.data.id,accepted.body.data.id);
  await admin.query("INSERT INTO bansir.tenant_contracts(tenant_id,features) VALUES($1,'{\"deliveries\":false}') ON CONFLICT(tenant_id) DO UPDATE SET features=excluded.features",[tenant.id]);assert.equal((await send('/deliveries/map')).status,403);assert.equal((await send(`/deliveries/orders/${order}/recommendations`,undefined,'cashier')).status,403);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db.close();await admin.end();}
});
