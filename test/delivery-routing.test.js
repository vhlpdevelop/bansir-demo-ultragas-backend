import test from 'node:test';
import assert from 'node:assert/strict';
import {driverPlan,recommend,point,color,routeRevision} from '../src/postgres/delivery-planner.js';
import {createDeliveryRouter} from '../src/postgres/delivery-router.js';
const p=x=>({latitude:0,longitude:x}),task=(id,x,status='assigned')=>({sale_id:id,driver_id:'a',status,...p(x),version:1,route_order:1,created_at:new Date().toISOString()});
const driver=(id,pos)=>({id,name:id,map_color_index:id==='a'?1:2,active:true,on_duty:true,driver_active:true,account_active:true,gps_state:'ok',position:{...p(pos),accuracy:10,capturedAt:new Date().toISOString(),receivedAt:new Date().toISOString()}});
const fallback={matrix:async()=>null,info:()=>({configured:false})};
test('Driver already going past destination beats closer driver with a larger detour; pinned stops stay first',async()=>{
 const a=driverPlan(driver('a',0),[task('stop',.1)],p(0)),b=driverPlan(driver('b',.045),[],p(0));
 const result=await recommend([a,b],p(.05),fallback,'unit');assert.equal(result.recommendedDriverId,'a');assert.equal(result.candidates[0].insertionIndex,0);assert.equal(result.candidates[0].addedKm,0);
 const pinned=driverPlan(driver('a',0),[task('stop',.1,'en_route')],p(0));const r=await recommend([pinned],p(.05),fallback,'unit');assert.equal(r.candidates[0].insertionIndex,1);
 assert.notEqual(color(1),color(2));assert.equal(point({latitude:null,longitude:0}),null);assert.notEqual(routeRevision(a.stops),routeRevision(pinned.stops));
});
test('Stale GPS falls back to store; off-duty and unknown destinations are not eligible',async()=>{
 const d=driver('a',.01);d.position.capturedAt=new Date(Date.now()-100000).toISOString();const plan=driverPlan(d,[],p(0));assert.equal(plan.originSource,'store');assert.deepEqual(plan.origin,p(0));
 plan.onDuty=false;assert.equal((await recommend([plan],p(.05),fallback,'unit')).recommendedDriverId,null);
 const unknown=driverPlan(driver('a',0),[{...task('unknown',0),latitude:null}],p(0));assert.equal((await recommend([unknown],p(.05),fallback,'unit')).recommendedDriverId,null);
 assert.equal((await recommend([driverPlan(driver('a',0),[],p(0))],{...p(.05),accuracy:1000},fallback,'unit')).targetLocated,false);
});
test('Provider stays server-side, coalesces requests, caches current route, enforces quota and backs off',async()=>{
 let calls=0,now=0;const transport=async(url,opts)=>{calls++;assert.ok(url.startsWith('https://api.heigit.org/openrouteservice/v2/'));assert.equal(opts.headers.Authorization,'test-secret');assert.ok(opts.headers.Accept.includes('application/geo+json'));const body=JSON.parse(opts.body);if(body.locations){assert.deepEqual(body.locations,[[0,0],[.1,0]]);return Response.json({distances:[[0,1000],[1000,0]],durations:[[0,60],[60,0]]});}return Response.json({features:[{geometry:{type:'LineString',coordinates:[[0,0],[.1,0]]},properties:{summary:{distance:1000,duration:60}}}]});};
 const router=createDeliveryRouter({apiKey:'test-secret',transport,clock:()=>now,matrixLimit:1,minuteLimit:20});
 await Promise.all([router.matrix([p(0),p(.1)],'u'),router.matrix([p(0),p(.1)],'u')]);assert.equal(calls,1);
 const plan=driverPlan(driver('a',0),[task('s',.1)],p(0));const path=await router.geometry(plan,'u');assert.equal(path.model,'road');assert.equal(path.distanceKm,1);assert.equal(calls,2);
 plan.origin=p(.02);await router.geometry(plan,'u');assert.equal(calls,2);now=300001;await router.geometry(plan,'u');assert.equal(calls,3);
 assert.equal(await router.matrix([p(0),p(.2)],'u'),null);assert.equal(router.info().status,'local_quota');assert.ok(!JSON.stringify(router.info()).includes('test-secret'));router.close();
 let failed=0;const blocked=createDeliveryRouter({apiKey:'x',transport:async()=>{failed++;return new Response('',{status:429});}});await blocked.matrix([p(0),p(.1)],'u');await blocked.matrix([p(0),p(.2)],'u');assert.equal(failed,1);blocked.close();
});
test('Unreachable baseline cannot produce a zero-cost recommendation',async()=>{
 const plan=driverPlan(driver('a',0),[task('s',.1)],p(0));const r=await recommend([plan],p(.05),{matrix:async points=>({distances:points.map(()=>points.map(()=>Infinity)),durations:points.map(()=>points.map(()=>Infinity))}),info:()=>({})},'u');assert.equal(r.recommendedDriverId,null);
});
