import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {provisionTenant,assignPlan,createEstablishment} from '../src/postgres/provision.js';
import {createBrowserSessions} from '../src/postgres/browser-sessions.js';
import {createLoginThrottle} from '../src/postgres/login-throttle.js';

test('production browser cookies require HTTPS and use host-only secure HttpOnly attributes',()=>{
 const sessions=createBrowserSessions({secret:'test-only-secret',nodeEnv:'production',allowedOrigins:['https://app.test.invalid']});
 let issued;const req={secure:true,get:key=>key.toLowerCase()==='origin'?'https://app.test.invalid':'browser',res:{cookie:(...args)=>{issued=args;}}};
 sessions.openPlatform(req,'a'.repeat(64));assert.equal(issued[0],'__Host-bansir-platform');
 assert.deepEqual(issued[2],{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:7200000});
 req.secure=false;assert.throws(()=>sessions.openPlatform(req,'a'.repeat(64)),e=>e.status===403);
});

test('browser cookie rotation, separate sessions, CSRF, admin restore and persistent login throttles',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async()=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();
 const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL}),secret=randomBytes(48).toString('hex'),origin='https://app.test.invalid';let server;
 try{
  const password=randomBytes(20).toString('hex'),email='browser-auth@example.invalid';
  await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'browser-auth',name:'Browser',adminName:'Browser Test',email,password});
  const platformEmail='browser-platform@example.invalid';
  await admin.query('INSERT INTO bansir.platform_admins(email,name,password_hash) VALUES($1,$2,$3)',[platformEmail,'Cookie admin',await bcrypt.hash(password,12)]);
  const start=async()=>{server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test',corsOrigin:origin}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));};
  await start();
  const send=async(path,body,headers={},method=body===undefined?'GET':'POST')=>{
   const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1${path}`,{method,headers:{'Content-Type':'application/json',Origin:origin,'X-Bansir-Client':'browser',...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
   return {status:response.status,headers:response.headers,data:(await response.json()).data};
  };
  const cookie=r=>r.headers.getSetCookie()[0]?.split(';')[0];
  const context=(r,cookieValue=cookie(r))=>({Cookie:cookieValue,'X-Bansir-Session':r.data.cookieSession.id,'X-CSRF-Token':r.data.cookieSession.csrfToken});
  const a=await send('/auth/login',{email,password}),b=await send('/auth/login',{email,password});
  assert.equal(a.status,200);assert.equal(a.data.refreshToken,undefined);assert.ok(a.data.token);
  assert.match(a.headers.getSetCookie()[0],/HttpOnly/);assert.match(a.headers.getSetCookie()[0],/SameSite=Strict/);
  assert.equal(a.headers.get('access-control-allow-credentials'),'true');assert.equal(a.headers.get('access-control-allow-origin'),origin);
  assert.notEqual(a.data.cookieSession.id,b.data.cookieSession.id);
  const combined=cookie(a)+'; '+cookie(b);
  assert.equal((await send('/auth/refresh',{},context(a,combined))).status,200);
  const refreshedB=await send('/auth/refresh',{},context(b,combined));assert.equal(refreshedB.status,200);
  assert.equal(refreshedB.data.cookieSession.id,b.data.cookieSession.id);
  assert.equal((await send('/auth/refresh',{}, {...context(refreshedB),'X-CSRF-Token':''})).status,403);
  assert.equal((await send('/auth/refresh',{}, {...context(refreshedB),Origin:'https://evil.invalid'})).status,403);
  assert.equal((await send('/auth/refresh',{}, {...context(refreshedB),Origin:''})).status,403);
  assert.equal((await send('/auth/refresh',{}, {...context(refreshedB),'X-Bansir-Session':a.data.cookieSession.id})).status,403);
  assert.equal((await send('/auth/refresh',{},context(refreshedB,cookie(refreshedB)+'; '+cookie(refreshedB)))).status,401);
  // Missing/invalid CSRF does not consume the refresh token.
  const fresh=await send('/auth/refresh',{},context(refreshedB));assert.equal(fresh.status,200);
  const logout=await send('/auth/logout',{}, {...context(fresh),Authorization:'Bearer '+fresh.data.token});assert.equal(logout.status,200);
  assert.match(logout.headers.getSetCookie()[0],/Expires=Thu, 01 Jan 1970/);
  assert.equal((await send('/auth/refresh',{},context(fresh))).status,401);
  // Existing clients and the future APK retain the explicit token contract.
  const native=await send('/auth/login',{email,password},{'X-Bansir-Client':''});assert.ok(native.data.refreshToken);assert.equal(native.headers.getSetCookie().length,0);
  const migrated=await send('/auth/refresh',{refreshToken:native.data.refreshToken});assert.equal(migrated.status,200);assert.equal(migrated.data.refreshToken,undefined);assert.ok(migrated.data.cookieSession);
  assert.equal((await send('/auth/refresh',{}, {Cookie:cookie(migrated),'X-Bansir-Client':''})).status,400);
  const full=await send('/auth/login',{email,password},{'X-Bansir-Session-Mode':'cookie'});
  assert.equal(full.status,200);assert.equal(full.data.token,undefined);assert.equal(full.data.refreshToken,undefined);
  assert.equal(full.headers.getSetCookie().length,2);assert.equal(full.data.cookieSession.mode,'cookie');
  const cookies=full.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const fullHeaders={...context(full,cookies),'X-Bansir-Session-Mode':'cookie'};
  assert.equal((await send('/auth/me',undefined,fullHeaders)).status,200);
  assert.equal((await send('/products',undefined,fullHeaders)).status,200);
  assert.equal((await send('/products',undefined,{...fullHeaders,'X-CSRF-Token':''})).status,403);
  assert.equal((await send('/products',undefined,{...fullHeaders,Origin:'https://evil.invalid'})).status,403);
  assert.equal((await send('/products',undefined,{...fullHeaders,Origin:'',Referer:origin+'/pdv'})).status,200);
  assert.equal((await send('/auth/me',{name:'Cookie User',phone:''},fullHeaders,'PUT')).status,200);
  assert.equal((await send('/auth/me',{name:'Denied',phone:''},{...fullHeaders,'X-CSRF-Token':''},'PUT')).status,403);
  // Cookies never authenticate native requests implicitly, nor does Bearer bypass cookie-mode CSRF.
  assert.equal((await send('/products',undefined,{Cookie:cookies,'X-Bansir-Client':''})).status,401);
  assert.equal((await send('/products',undefined,{...fullHeaders,'X-CSRF-Token':'',Authorization:'Bearer '+native.data.token})).status,403);
  const logoutFull=await send('/auth/logout',{},fullHeaders);assert.equal(logoutFull.status,200);assert.equal(logoutFull.headers.getSetCookie().length,2);
  assert.equal((await send('/products',undefined,fullHeaders)).status,401);
  await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:'browser-auth',code:'browser-two',name:'Browser test plan',maxEstablishments:2});
  const userId=(await admin.query('SELECT id FROM bansir.users WHERE email=$1',[email])).rows[0].id;
  await createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:'browser-auth',name:'Second cookie unit',documentId:'',memberships:[{userId,role:'admin',allowedRoutes:['products','settings']}]});
  const select=async index=>{const login=await send('/auth/login',{email,password});assert.equal(login.data.requiresEstablishmentSelection,true);const unit=login.data.establishments[index];return send('/auth/select-establishment',{selectionToken:login.data.selectionToken,tenantId:unit.tenant.id,establishmentId:unit.id});};
  const unitA=await select(0),unitB=await select(1),unitCookies=cookie(unitA)+'; '+cookie(unitB);
  assert.notEqual(unitA.data.establishment.id,unitB.data.establishment.id);
  const renewedA=await send('/auth/refresh',{},context(unitA,unitCookies)),renewedB=await send('/auth/refresh',{},context(unitB,unitCookies));
  assert.equal(renewedA.data.establishment.id,unitA.data.establishment.id);assert.equal(renewedB.data.establishment.id,unitB.data.establishment.id);
  assert.equal((await send('/auth/logout',{}, {...context(renewedA),Authorization:'Bearer '+renewedB.data.token})).status,403);
  const platform=await send('/platform/login',{email:platformEmail,password});assert.equal(platform.status,200);assert.equal(platform.data.token,undefined);assert.ok(platform.data.csrfToken);
  const platformHeaders={Cookie:cookie(platform),'X-CSRF-Token':platform.data.csrfToken};
  const restored=await send('/platform/csrf',undefined,{Cookie:cookie(platform)});assert.equal(restored.status,200);assert.equal(restored.data.csrfToken,platform.data.csrfToken);
  assert.equal((await send('/platform/logout',{}, {...platformHeaders,'X-CSRF-Token':''})).status,403);
  assert.equal((await send('/platform/logout',{}, {...platformHeaders,Origin:'https://evil.invalid'})).status,403);
  const changed=await send('/platform/password',{currentPassword:password,newPassword:'browser-admin-test-password-2026'},platformHeaders);assert.equal(changed.status,200);assert.match(changed.headers.getSetCookie()[0],/Expires=Thu, 01 Jan 1970/);
  assert.equal((await send('/platform/csrf',undefined,platformHeaders)).status,401);
  // Account budget survives app recreation and does not expose stored email/IP.
  const missing='rate-browser@example.invalid';
  for(let i=0;i<5;i++)assert.equal((await send('/platform/login',{email:missing,password:'invalid-password'})).status,401);
  server.closeAllConnections();await new Promise(r=>server.close(r));await start();
  const blocked=await send('/platform/login',{email:missing.toUpperCase(),password:'invalid-password'});assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('retry-after'))>0);
  await assert.rejects(db.pool.query('SELECT * FROM bansir.auth_attempt_windows'),e=>e.code==='42501');
  const stored=(await admin.query('SELECT subject_hash FROM bansir.auth_attempt_windows')).rows;assert.ok(stored.length);assert.ok(stored.every(r=>/^[a-f0-9]{64}$/.test(r.subject_hash)));
  // IP aggregation, account normalization, reset on success, fixed expiry.
  const throttle=createLoginThrottle(db,secret),fake=(email,ip)=>({body:{email},ip,res:{set:()=>{}}});
  const request=fake('direct-rate@example.invalid','2001:db8:1234:5600::1');
  for(let i=0;i<10;i++)await throttle.attempt(request,'tenant');
  await assert.rejects(throttle.attempt(fake('DIRECT-RATE@example.invalid','203.0.113.10'),'tenant'),e=>e.status===429);
  await createLoginThrottle(db,secret).success(request,'tenant');await throttle.attempt(request,'tenant');
  const key='a'.repeat(64);for(let i=0;i<20;i++)assert.equal(Number((await db.pool.query("SELECT bansir.auth_attempt('platform-ip',$1) AS retry",[key])).rows[0].retry),0);
  assert.ok(Number((await db.pool.query("SELECT bansir.auth_attempt('platform-ip',$1) AS retry",[key])).rows[0].retry)>0);
  await admin.query("UPDATE bansir.auth_attempt_windows SET expires_at=now()-interval '1 second' WHERE subject_hash=$1",[key]);
  assert.equal(Number((await db.pool.query("SELECT bansir.auth_attempt('platform-ip',$1) AS retry",[key])).rows[0].retry),0);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await db.close();await admin.end();}
});
