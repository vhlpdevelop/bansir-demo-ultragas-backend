import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {provisionTenant} from '../src/postgres/provision.js';
import {defaultStorefront} from '../src/postgres/storefront.js';
import {pricingDay,productQuote} from '../src/postgres/product-pricing.js';

test('Product pricing, Saturday calendar and Gas do Povo',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async t=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL});let server;
 try{
  const password=randomBytes(20).toString('hex'),tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'pricing-test',name:'Pricing test',adminName:'Owner',email:'pricing@test.invalid',password});
  let now=new Date('2026-10-30T15:00:00Z');
  server=createPostgresApp({database:db,jwtSecret:randomBytes(48).toString('hex'),nodeEnv:'test',clock:()=>now}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const call=async(path,method='GET',body,token)=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
  const login=await call('/auth/login','POST',{email:'pricing@test.invalid',password});const token=login.body.data.token;assert.ok(token);
  const send=(path,method,body)=>call(path,method,body,token);
  const create=async data=>{const r=await send('/products','POST',{name:'Product',barcode:randomUUID(),stock:30,...data});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.data;};
  const gas=await create({name:'Gás P13',price:145,fulfillmentPricing:{deliveryPrice:150,saturdayPickupPrice:135,saturdayDeliveryPrice:140}}),water=await create({name:'Água',price:12,fulfillmentPricing:{deliveryPrice:15,saturdayDeliveryPrice:13}}),program=await create({name:'Gás do Povo',price:145,gasDoPovo:true,gasDoPovoDelivery:false}),regular=await create({name:'Sem entrega inclusa',price:8});
  const settings={slug:'pricing-public',enabled:true,config:{...defaultStorefront,location:{latitude:-15.6,longitude:-56.1,address:'Store',showMap:false},deliveryRadiusKm:10,timeZone:'America/Cuiaba',productIds:[gas.id,water.id,program.id,regular.id],zones:[{id:'centro',name:'Centro',feeCents:700}]}};assert.equal((await send('/storefront/settings','PUT',settings)).status,200);
  const catalog=async()=>{const r=await call('/public/stores/pricing-public');assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
  const checkout=await call('/public/stores/pricing-public/start','POST',{phone:'65999991111'});const checkoutToken=checkout.body.data.token;
  const order=async({mode='delivery',shipping=0,items})=>{const response=await fetch(base+'/public/stores/pricing-public/orders',{method:'POST',headers:{'Content-Type':'application/json','X-Checkout-Token':checkoutToken},body:JSON.stringify({requestKey:randomUUID(),customerName:'Cliente teste',deliveryAddress:'Rua teste 10 Centro',fulfillment:mode,...(mode==='delivery'?{deliveryLocation:{latitude:-15.601,longitude:-56.101,accuracy:10,capturedAt:new Date().toISOString(),confirmed:true}}:{}),zoneId:mode==='delivery'?'centro':'',expectedShippingCents:shipping,items})});return {status:response.status,body:await response.json()};};
  const item=(p,price,quantity=1)=>({productId:p.id,quantity,expectedUnitPriceCents:price});let saturdayOrder;
  await t.test('normal and Saturday totals include delivery once and preserve pickup prices',async()=>{
   let c=await catalog();assert.equal(c.products.find(p=>p.id===gas.id).deliveryCents,15000);assert.equal(c.products.find(p=>p.id===water.id).pickupCents,1200);
   const normal=await order({items:[item(gas,15000),item(water,1500)]});assert.equal(normal.status,201,JSON.stringify(normal.body));assert.equal(normal.body.data.totalCents,16500);
   const mixed=await order({items:[item(gas,15000),item(regular,800)],shipping:700});assert.equal(mixed.status,201);assert.equal(mixed.body.data.totalCents,16500);
   assert.equal((await order({items:[item(gas,15000)],shipping:700})).status,409);
   now=new Date('2026-10-31T15:00:00Z');c=await catalog();assert.equal(c.pricingDay.saturday,true);assert.equal(c.products.find(p=>p.id===gas.id).pickupCents,13500);assert.equal(c.products.find(p=>p.id===water.id).deliveryCents,1300);assert.equal(c.products.find(p=>p.id===water.id).pickupCents,1200);
   assert.equal((await order({items:[item(gas,15000)]})).status,409);
   saturdayOrder=await order({items:[item(gas,14000),item(water,1300)]});assert.equal(saturdayOrder.status,201,JSON.stringify(saturdayOrder.body));assert.equal(saturdayOrder.body.data.totalCents,15300);
   assert.equal((await order({mode:'pickup',items:[item(gas,13500),item(water,1200)]})).body.data.totalCents,14700);
   assert.equal(pricingDay('America/Cuiaba',new Date('2026-10-31T02:00:00Z')).saturday,false);assert.equal(pricingDay('America/Cuiaba',new Date('2026-11-01T02:00:00Z')).saturday,true);
   assert.equal(productQuote({price_cents:1200,fulfillment_pricing:{}},pricingDay()).deliveryIncluded,false);
  });
  await t.test('program delivery is blocked on server; pickup works; enabling delivery changes the rule',async()=>{
   const denied=await order({items:[item(program,14500)],shipping:700});assert.equal(denied.status,409);assert.equal(denied.body.code,'PROGRAM_PICKUP_ONLY');
   assert.equal((await order({mode:'pickup',items:[item(program,14500)]})).status,201);
   assert.equal((await send('/products/'+program.id,'PUT',{gasDoPovoDelivery:true,fulfillmentPricing:{deliveryPrice:150}})).status,200);
   assert.equal((await order({items:[item(program,15000)]})).status,201);
  });
  await t.test('acceptance preserves the Saturday quote after the day and catalog change',async()=>{
   now=new Date('2026-11-01T15:00:00Z');await send('/products/'+gas.id,'PUT',{price:180,fulfillmentPricing:{deliveryPrice:190}});
   await send('/pdv/cash/open','POST',{openingCents:0});const accepted=await send(`/storefront/orders/${saturdayOrder.body.data.id}/accept`,'POST',{customerConfirmed:true});assert.equal(accepted.status,201,JSON.stringify(accepted.body));assert.equal(accepted.body.data.total_cents,15300);assert.equal(accepted.body.data.items.find(i=>i.product_id===gas.id).unit_price_cents,14000);
   const replay=await send(`/storefront/orders/${saturdayOrder.body.data.id}/accept`,'POST',{customerConfirmed:true});assert.equal(replay.body.data.id,accepted.body.data.id);
   const forged=await send('/sales','POST',{requestKey:randomUUID(),quotedItems:[{productId:gas.id,priceCents:1}],items:[item(gas,1)],payment:{method:'cash',confirmed:true,receivedCents:1}});assert.equal(forged.status,400);
   const snapshot=(await admin.query('SELECT pricing_context FROM bansir.storefront_orders WHERE id=$1',[saturdayOrder.body.data.id])).rows[0];assert.equal(snapshot.pricing_context.date,'2026-10-31');
  });
  await t.test('promotions persist, quote real discounted amounts and preserve accepted order prices',async()=>{
   const result=await send('/products/'+water.id,'PUT',{fulfillmentPricing:{deliveryPrice:15,promotionPickupPrice:10,promotionDeliveryPrice:13}});assert.equal(result.status,200);
   const p=(await catalog()).products.find(p=>p.id===water.id);assert.equal(p.pickupOriginalCents,1200);assert.equal(p.deliveryOriginalCents,1500);assert.equal(p.pickupCents,1000);assert.equal(p.deliveryCents,1300);
   const promo=await order({items:[item(water,1300)]});assert.equal(promo.status,201);assert.equal(promo.body.data.totalCents,1300);
   assert.equal((await order({items:[item(water,1500)]})).status,409);
   await send('/products/'+water.id,'PUT',{fulfillmentPricing:{deliveryPrice:15}});
   const accepted=await send(`/storefront/orders/${promo.body.data.id}/accept`,'POST',{customerConfirmed:true});assert.equal(accepted.status,201);assert.equal(accepted.body.data.total_cents,1300);
   const normal=(await catalog()).products.find(p=>p.id===water.id);assert.equal(normal.pickupCents,1200);assert.equal(normal.deliveryCents,1500);
  });
  await t.test('non-owner cannot alter delivery prices or the calendar, including direct SQL',async()=>{
   const user=(await admin.query("SELECT id FROM bansir.users WHERE email='pricing@test.invalid'")).rows[0];await admin.query('UPDATE bansir.establishments SET owner_user_id=NULL WHERE id=$1',[tenant.establishmentId]);
   assert.equal((await send('/products/'+gas.id,'PUT',{fulfillmentPricing:{deliveryPrice:1}})).status,403);
   assert.equal((await send('/products/'+gas.id,'PUT',{fulfillmentPricing:{promotionPickupPrice:1}})).status,403);
   assert.equal((await send('/products/'+gas.id,'PUT',{gasDoPovo:true})).status,403);
   assert.equal((await send('/products/'+gas.id,'PUT',{name:'Permitido'})).status,200);
   await assert.rejects(db.transaction({tenantId:tenant.id,establishmentId:tenant.establishmentId,userId:user.id},c=>c.query("UPDATE bansir.products SET fulfillment_pricing='{\"deliveryPrice\":1}' WHERE id=$1",[gas.id])),e=>e.code==='42501');
   assert.equal((await send('/storefront/settings','PUT',{...settings,config:{...settings.config,timeZone:'America/Sao_Paulo'}})).status,403);
  });
 }finally{if(server)await new Promise(r=>server.close(r));await db.close();await admin.end();}
});
