import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {WebSocket} from 'ws';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {createAuth} from '../src/postgres/auth.js';
import {provisionTenant,assignPlan,createEstablishment} from '../src/postgres/provision.js';
test('PostgreSQL bridge: scoped pairing, diagnostics, terminal configuration and revocation',{skip:!process.env.TEST_POSTGRES_URL,timeout:60000},async t=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();const database=createDatabase({connectionString:process.env.TEST_POSTGRES_URL});let server,app;const clients=[];
 try{
 const password=randomBytes(24).toString('hex'),tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'bridge-pg',name:'Bridge',adminName:'Owner',email:'bridge-pg@test.invalid',password});
 const user=(await admin.query("SELECT id FROM bansir.users WHERE email='bridge-pg@test.invalid'")).rows[0];await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,code:'bridge-pg-two',name:'Test',maxEstablishments:2});
 const other=await createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,name:'Other',memberships:[{userId:user.id,role:'admin',allowedRoutes:[]}]});
 const jwtSecret=randomBytes(48).toString('hex'),auth=createAuth(database,{jwtSecret});
 const login=async id=>{const sel=await auth.login({email:'bridge-pg@test.invalid',password});return (await auth.select({selectionToken:sel.selectionToken,tenantId:tenant.id,establishmentId:id})).token;};
 const token=await login(tenant.establishmentId),foreign=await login(other.establishmentId);
 app=createPostgresApp({database,jwtSecret,nodeEnv:'test'});server=app.listen(0,'127.0.0.1');app.locals.bridge.attach(server);await once(server,'listening');const base='http://127.0.0.1:'+server.address().port+'/api/v1';
 const send=async(path,method='GET',body,bearer=token)=>{const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,...await r.json()};};
 const create=()=>send('/bridge/tokens','POST',{label:'Test checkout'});
 let cred,profile,ws;
 const connect=async(raw,installation='installation-test')=>{
  const socket=new WebSocket(base.replace('http:','ws:')+'/bridge/ws',{headers:{Authorization:'Bearer '+raw}});clients.push(socket);socket.messages=[];socket.on('message',raw=>{const m=JSON.parse(raw);socket.messages.push(m);if(m.type==='diagnostics.ping')socket.send(JSON.stringify({type:'diagnostics.pong',correlationId:m.correlationId,timestamp:new Date().toISOString()}));});await once(socket,'open');socket.send(JSON.stringify({type:'bridge.hello',protocolVersion:1,installationId:installation,machine:'Test PC',version:'0.3.0'}));return socket;
 };
 const wait=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('Bridge event timeout');};
 await t.test('setup code contains endpoint and secret once; token list and foreign unit expose no secret',async()=>{
  cred=(await create()).data;assert.ok(cred.token.startsWith('bpdv1_'));profile=JSON.parse(Buffer.from(cred.token.slice(6),'base64url'));
  assert.equal(profile.apiBaseUrl,base);assert.equal(profile.webSocketUrl,base.replace('http:','ws:')+'/bridge/ws');
  const list=await send('/bridge/tokens');assert.equal(list.data.length,1);assert.equal(JSON.stringify(list).includes(profile.apiToken),false);assert.equal('token_hash' in list.data[0],false);
  assert.equal((await send('/bridge/tokens','GET',undefined,foreign)).data.length,0);
  await send('/bridge/tokens/'+cred.id,'DELETE',undefined,foreign);assert.equal((await send('/bridge/tokens')).data[0].revokedAt,null);
 });
 await t.test('real websocket binds installation, scopes lists and ping, sends only configured unit terminals',async()=>{
  const terminal=(await send('/settings/hardware/terminals','POST',{name:'Local terminal',provider:'other',model:'Test',connectionType:'usb'})).data;
  ws=await connect(profile.apiToken);await wait(()=>ws.messages.some(m=>m.type==='configuration.terminals'));
  assert.equal(ws.messages.find(m=>m.type==='configuration.terminals').terminals[0].terminalId,terminal._id);
  const connections=(await send('/bridge/connections')).data;assert.equal(connections.length,1);assert.equal((await send('/bridge/connections','GET',undefined,foreign)).data.length,0);
  assert.equal((await send('/bridge/connections/'+connections[0].id+'/ping','POST',{},foreign)).status,404);
  assert.equal((await send('/bridge/connections/'+connections[0].id+'/ping','POST',{})).status,200);
  ws.send(JSON.stringify({type:'terminal.status',terminals:[{terminalId:terminal._id,status:'not_supported'}]}));await wait(()=>app.locals.bridge.status({tenantId:tenant.id,establishmentId:tenant.establishmentId},terminal._id)==='not_supported');
  const hardware=(await send('/settings/hardware')).data;assert.equal(hardware.terminals[0].status,'not_supported');assert.equal(hardware.terminals[0].connected,false);
  const wrong=await connect(profile.apiToken,'different-installation');await once(wrong,'close');assert.equal(ws.readyState,WebSocket.OPEN);
 });
 await t.test('revocation closes the live socket and rejects subsequent handshakes',async()=>{
  const closed=once(ws,'close');assert.equal((await send('/bridge/tokens/'+cred.id,'DELETE')).status,200);await closed;
  const socket=new WebSocket(profile.webSocketUrl,{headers:{Authorization:'Bearer '+profile.apiToken}});clients.push(socket);const rejected=await new Promise(resolve=>{socket.on('unexpected-response',(_,response)=>{resolve(response.statusCode);socket.terminate();});socket.on('error',()=>{});});assert.equal(rejected,401);
 });
 }finally{for(const c of clients)c.terminate();if(app)await app.locals.bridge.close();if(server)await new Promise(r=>server.close(r));await database.close();await admin.end();}
});
