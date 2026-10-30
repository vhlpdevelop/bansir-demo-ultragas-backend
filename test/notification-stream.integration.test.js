import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {provisionTenant,assignPlan,createEstablishment} from '../src/postgres/provision.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw new Error('Timed out waiting for notification stream');await sleep(10);}}
test('SSE shares one listener, isolates units and synchronizes independent browser sessions',{skip:!process.env.TEST_POSTGRES_URL,timeout:60000},async()=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();
 const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL}),streams=[];let server;
 try{
  const password=randomBytes(20).toString('hex'),email='stream@example.invalid';
  const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'stream-test',name:'Stream',adminName:'Stream test',email,password});
  const user=(await admin.query('SELECT id FROM bansir.users WHERE email=$1',[email])).rows[0];
  await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,code:'stream-two',name:'Test',maxEstablishments:2});
  const unit2=await createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,name:'Second unit',memberships:[{userId:user.id,role:'admin',allowedRoutes:[]}]});
  const app=createPostgresApp({database:db,jwtSecret:randomBytes(48).toString('hex'),nodeEnv:'test'});
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,base=origin+'/api/v1';
  const defaults={Origin:origin,'Content-Type':'application/json','X-Bansir-Client':'browser','X-Bansir-Session-Mode':'cookie'};
  const send=(path,body,headers={})=>fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...defaults,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const login=async establishmentId=>{
   const ticket=(await (await send('/auth/login',{email,password})).json()).data;
   const response=await send('/auth/select-establishment',{selectionToken:ticket.selectionToken,tenantId:tenant.id,establishmentId});
   const data=(await response.json()).data;assert.equal(data.token,undefined);
   return {Cookie:response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),'X-Bansir-Session':data.cookieSession.id,'X-CSRF-Token':data.cookieSession.csrfToken};
  };
  const a=await login(tenant.establishmentId),b=await login(tenant.establishmentId),other=await login(unit2.establishmentId);
  const connect=async headers=>{
   const controller=new AbortController(),response=await fetch(base+'/notifications/stream',{headers:{...defaults,...headers},signal:controller.signal});
   assert.equal(response.status,200);assert.equal(response.headers.get('x-accel-buffering'),'no');
   const stream={controller,events:[],ended:false};streams.push(stream);
   stream.done=(async()=>{const reader=response.body.getReader();let buffer='';const decoder=new TextDecoder();try{while(true){const r=await reader.read();if(r.done)break;buffer+=decoder.decode(r.value,{stream:true});let at;while((at=buffer.indexOf('\n\n'))!==-1){const event=buffer.slice(0,at);buffer=buffer.slice(at+2);if(event.startsWith('event:'))stream.events.push(event.split('\n')[0].slice(7));}}}catch{}finally{stream.ended=true;}})();
   await until(()=>stream.events.includes('ready'));return stream;
  };
  const first=await connect(a),second=await connect(b),foreign=await connect(other);
  const count=s=>s.events.filter(e=>e==='changed').length;
  const insert=async unit=>{const id=randomUUID();await admin.query('INSERT INTO bansir.notifications(tenant_id,establishment_id,id,user_id,title,body) VALUES($1,$2,$3,$4,$5,$6)',[tenant.id,unit,id,user.id,'Private test','Never in SSE']);return id;};
  const id=await insert(tenant.establishmentId);await until(()=>count(first)===1&&count(second)===1);await sleep(50);assert.equal(count(foreign),0);
  await insert(unit2.establishmentId);await until(()=>count(foreign)===1);assert.equal(count(first),1);
  const listeners=(await admin.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='bansir-notification-listener'")).rows[0].count;
  assert.equal(listeners,'1');assert.equal(db.pool.totalCount,db.pool.idleCount);
  const read=await fetch(base+`/notifications/${id}/read`,{method:'PATCH',headers:{...defaults,...a}});assert.equal(read.status,200);
  await until(()=>count(first)===2&&count(second)===2);
  assert.equal((await fetch(base+`/notifications/${id}`,{method:'DELETE',headers:{...defaults,...b}})).status,200);
  await until(()=>count(first)===3&&count(second)===3);assert.equal(count(foreign),1);
  await admin.query('BEGIN');await insert(tenant.establishmentId);await admin.query('ROLLBACK');await sleep(100);assert.equal(count(first),3);
  assert.equal((await send('/notifications/stream',undefined,{...b,'X-CSRF-Token':''})).status,403);
  assert.equal((await send('/notifications/stream',undefined,{...b,Origin:'https://evil.invalid'})).status,403);
  assert.equal((await send('/notifications/stream',undefined,{...b,'X-Bansir-Session':other['X-Bansir-Session']})).status,403);
  assert.equal((await send('/auth/logout',{},a)).status,200);await until(()=>first.ended);assert.equal(second.ended,false);
  await insert(tenant.establishmentId);await until(()=>count(second)===4);assert.equal(count(foreign),1);
  // A fresh connection always resyncs; NOTIFY is not used as durable storage.
  const reconnect=await connect(b);assert.ok(reconnect.events.includes('ready'));
  const list=(await (await send('/notifications',undefined,b)).json()).data;assert.ok(list.length>0);
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name='bansir-notification-listener'");
  await until(()=>second.ended&&foreign.ended&&reconnect.ended);
  const recovered=await connect(b),recoveredOther=await connect(other);
  assert.ok(recovered.events.includes('ready'));
  const changed=await send('/auth/change-password',{currentPassword:password,newPassword:randomBytes(24).toString('hex')},b);
  assert.equal(changed.status,200);await until(()=>recovered.ended&&recoveredOther.ended);
 }finally{
  for(const stream of streams)stream.controller.abort();await Promise.allSettled(streams.map(s=>s.done));
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await db.close();await admin.end();
 }
});
