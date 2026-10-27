import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createAuth} from '../src/postgres/auth.js';
import {provisionTenant} from '../src/postgres/provision.js';
import {createPostgresApp} from '../src/postgres/app.js';
test('rotating tab sessions preserve unit, absolute deadline and revocation',{skip:!process.env.TEST_POSTGRES_URL},async()=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL});let server;
 try{const password=randomBytes(20).toString('hex'),secret=randomBytes(40).toString('hex');await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'refresh-test',name:'Refresh',adminName:'Owner',email:'refresh@test.invalid',password});const auth=createAuth(db,{jwtSecret:secret});
 const login=()=>auth.login({email:'refresh@test.invalid',password});const identity=s=>{const p=jwt.decode(s.token);return {userId:p.id,tenantId:p.tenantId,establishmentId:p.establishmentId,sessionId:p.jti};};
 const a=await login(),p=jwt.decode(a.token),r=jwt.decode(a.refreshToken);assert.equal(p.exp-p.iat,600);assert.equal(r.exp-r.iat,43200);assert.equal(p.establishmentId,r.establishmentId);
 const b=await auth.refresh({refreshToken:a.refreshToken});assert.notEqual(b.refreshToken,a.refreshToken);assert.equal(jwt.decode(b.refreshToken).exp,r.exp);assert.equal(b.establishment.id,a.establishment.id);await auth.session(identity(b));
 await assert.rejects(auth.refresh({refreshToken:a.refreshToken}),e=>e.code==='SESSION_REVOKED');await assert.rejects(auth.refresh({refreshToken:b.refreshToken}),e=>e.code==='SESSION_REVOKED');await assert.rejects(auth.session(identity(b)),e=>e.code==='SESSION_REVOKED');
 const c=await login();await auth.logout(identity(c));await assert.rejects(auth.refresh({refreshToken:c.refreshToken}),e=>e.code==='SESSION_REVOKED');
 const d=await login();await auth.returnToSelection(identity(d));await assert.rejects(auth.refresh({refreshToken:d.refreshToken}),e=>e.code==='SESSION_REVOKED');
 const e=await login();await auth.changePassword(identity(e),{currentPassword:password,newPassword:'changed-only-in-disposable-test-2026'});await assert.rejects(auth.refresh({refreshToken:e.refreshToken}),err=>err.code==='SESSION_REVOKED');
 const last=await auth.login({email:'refresh@test.invalid',password:'changed-only-in-disposable-test-2026'});await admin.query("UPDATE bansir.access_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[identity(last).sessionId]);await assert.rejects(auth.refresh({refreshToken:last.refreshToken}),err=>err.code==='SESSION_REVOKED');
 server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test'}).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/auth/refresh`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:'forged'})});assert.equal(response.status,401);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await db.close();await admin.end();}
});
