import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {provisionTenant} from '../src/postgres/provision.js';

test('Temporary password, own password change and session revocation',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async()=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL}),admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();let server;
 try{
  const password=randomBytes(18).toString('hex'),newPassword='Minha frase nova 2026!',email='password-test@example.invalid';
  const tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'password-test',name:'Loja teste',legalName:'Empresa Teste LTDA',tradeName:'Nome fantasia teste',documentId:'00000000000000',adminName:'Owner',email,password,mustChangePassword:true});
  server=createPostgresApp({database:db,jwtSecret:randomBytes(48).toString('hex'),nodeEnv:'test'}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const send=async(path,body,token)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  const first=(await send('/auth/login',{email,password})).data.data,second=(await send('/auth/login',{email,password})).data.data;
  assert.equal(first.user.mustChangePassword,true);assert.equal(first.user.isEstablishmentOwner,true);assert.equal(first.user.establishment.name,'Nome fantasia teste');
  assert.equal((await send('/auth/me',null,first.token)).data.data.mustChangePassword,true);
  const denied=await send('/products',null,first.token);assert.equal(denied.status,403);assert.equal(denied.data.code,'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await send('/auth/change-password',{currentPassword:'errada',newPassword},first.token)).status,400);
  assert.equal((await send('/auth/change-password',{currentPassword:password,newPassword:'curta'},first.token)).status,400);
  assert.equal((await send('/auth/change-password',{currentPassword:password,newPassword,userId:first.user.id},first.token)).status,400);
  const changed=await send('/auth/change-password',{currentPassword:password,newPassword},first.token);assert.equal(changed.status,200);assert.equal(changed.data.data.requiresLogin,true);
  assert.equal((await send('/auth/me',null,first.token)).status,401);assert.equal((await send('/auth/me',null,second.token)).status,401);
  assert.equal((await send('/auth/login',{email,password})).status,401);
  const fresh=(await send('/auth/login',{email,password:newPassword})).data.data;assert.equal(fresh.user.mustChangePassword,false);assert.equal((await send('/products',null,fresh.token)).status,200);
  const row=(await admin.query('SELECT legal_name,document_id FROM bansir.establishments WHERE tenant_id=$1',[tenant.id])).rows[0];assert.equal(row.legal_name,'Empresa Teste LTDA');assert.equal(row.document_id,'00000000000000');
  await assert.rejects(db.transaction({userId:fresh.user.id,tenantId:tenant.id,establishmentId:tenant.establishmentId},c=>c.query("UPDATE bansir.users SET password_hash='forged' WHERE id=$1",[fresh.user.id])),e=>e.code==='42501');
 }finally{if(server)await new Promise(r=>server.close(r));await db.close();await admin.end();}
});
