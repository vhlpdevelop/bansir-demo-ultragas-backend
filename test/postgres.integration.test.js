import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createDatabase } from '../src/postgres/database.js';
import { createPostgresApp } from '../src/postgres/app.js';
import { importFoundation, provisionTenant,assignPlan,createEstablishment } from '../src/postgres/provision.js';
import {createAuth} from '../src/postgres/auth.js';
import {readFile} from 'node:fs/promises';

const runtimeUrl = process.env.TEST_POSTGRES_URL;
test('PostgreSQL: tenant isolation, SQL constraints, auth and catalog HTTP', { skip: !runtimeUrl, timeout: 60000 }, async t => {
  assert.match(new URL(runtimeUrl).pathname, /^\/bansir_test_[a-f0-9]+$/);
  assert.match(new URL(process.env.TEST_POSTGRES_ADMIN_URL).pathname, /^\/bansir_test_[a-f0-9]+$/);
  const admin = new pg.Client({ connectionString: process.env.TEST_POSTGRES_ADMIN_URL });
  const db = createDatabase({ connectionString: runtimeUrl, max: 3 });
  const reused = createDatabase({ connectionString: runtimeUrl, max: 1 });
  const password = randomBytes(20).toString('hex');
  const secret = randomBytes(48).toString('hex');
  const a = randomUUID(), b = randomUUID(), user = randomUUID(), other = randomUUID(), operator = randomUUID();
  const a1=randomUUID(),a2=randomUUID(),b1=randomUUID();
  let server;
  await admin.connect();
  try {
    await db.ready();
    await admin.query(`INSERT INTO bansir.tenants(id,slug,name) VALUES($1,'test-a','Tenant A'),($2,'test-b','Tenant B')`, [a, b]);
    await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:'test-a',code:'test-two',name:'Test only',maxEstablishments:2});
    await admin.query(`INSERT INTO bansir.establishments(tenant_id,id,name) VALUES($1,$3,'A1'),($1,$4,'A2'),($2,$5,'B1')`,[a,b,a1,a2,b1]);
    const hash = await bcrypt.hash(password, 10);
    await admin.query(`INSERT INTO bansir.users(id,email,name,password_hash) VALUES
      ($1,'shared@test.invalid','Shared',$4),($2,'other@test.invalid','Other',$4),($3,'operator@test.invalid','Operator',$4)`, [user, other, operator, hash]);
    await admin.query(`INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes) VALUES
      ($1,$3,'admin',ARRAY['products','settings']),($2,$3,'admin',ARRAY['products','settings']),
      ($2,$4,'admin',ARRAY['products']),($1,$5,'operador',ARRAY['sales'])`, [a, b, user, other, operator]);
    await admin.query(`INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes) VALUES
      ($1,$3,$6,'admin',ARRAY['products','settings']),($1,$4,$6,'operador',ARRAY['sales']),
      ($2,$5,$6,'admin',ARRAY['products','settings']),($2,$5,$7,'admin',ARRAY['products']),($1,$3,$8,'operador',ARRAY['sales'])`,
    [a,b,a1,a2,b1,user,other,operator]);
    const productA2=randomUUID();
    await admin.query(`INSERT INTO bansir.products(tenant_id,establishment_id,id,name,barcode,price_cents,stock)
      VALUES($1,$2,$3,'Gas A2','SAME-EAN',12045,1)`,[a,a2,productA2]);
    const app = createPostgresApp({ database: db, jwtSecret: secret, nodeEnv: 'test' });
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/v1`;
    const send = async (path, { token, body, method = 'GET' } = {}) => {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const login = await send('/auth/login', { method: 'POST', body: { email: 'shared@test.invalid', password } });
    assert.equal(login.status, 200); assert.equal(login.body.data.requiresEstablishmentSelection, true);
    const ticket = login.body.data.selectionToken;
    const auth=createAuth(db,{jwtSecret:secret});
    const choose=async (tenantId,establishmentId)=>{
      const selection=await auth.login({email:'shared@test.invalid',password});
      return (await auth.select({selectionToken:selection.selectionToken,tenantId,establishmentId})).token;
    };
    const tokenA = await choose(a,a1), tokenB = await choose(b,b1),tokenA2=await choose(a,a2);
    let productA, productB;

    await t.test('login requires membership and selection tickets cannot access tenant routes', async () => {
      assert.equal((await send('/products', { token: ticket })).status, 401);
      assert.equal((await send('/auth/select-establishment', { method: 'POST', body: { selectionToken: ticket, tenantId: randomUUID(),establishmentId:a1 } })).status, 403);
      const own = await send('/auth/login', { method: 'POST', body: { email: 'other@test.invalid', password } });
      assert.equal(own.body.data.tenant.id, b);
      assert.equal((await send('/auth/switch-tenant', { method: 'POST', token: own.body.data.token, body: { tenantId: a } })).status, 410);
      assert.equal((await send('/auth/login', { method: 'POST', body: { email: 'shared@test.invalid', password: 'wrong' } })).status, 401);
      const payload = jwt.decode(tokenA);
      const tampered = jwt.sign({ id: payload.id, tenantId: b, purpose: 'access' }, 'wrong-secret', { audience: 'bansir-ultragas-postgres', issuer: 'bansir' });
      assert.equal((await send('/products', { token: tampered })).status, 401);
    });
    await t.test('same barcode in two tenants, list/search and identifier mutations are isolated', async () => {
      const input = { name: 'Gas A', barcode: 'SAME-EAN', price: 120.45, costPrice: 90, stock: 1 };
      const first = await send('/products', { method: 'POST', token: tokenA, body: input });
      const second = await send('/products', { method: 'POST', token: tokenB, body: { ...input, name: 'Gas B' } });
      assert.equal(first.status, 201); assert.equal(second.status, 201);
      productA = first.body.data; productB = second.body.data;
      assert.equal((await send('/products', { token: tokenA })).body.data[0].name, 'Gas A');
      assert.equal((await send('/products/barcode/SAME-EAN', { token: tokenB })).body.data.name, 'Gas B');
      assert.equal((await send(`/products/${productB.id}`, { method: 'PUT', token: tokenA, body: { name: 'Intrusion' } })).status, 404);
      assert.equal((await send(`/products/${productB.id}`, { method: 'DELETE', token: tokenA })).status, 404);
      assert.equal((await send('/products', { method: 'POST', token: tokenA, body: input })).status, 409);
      assert.equal((await send('/products', { method: 'POST', token: tokenA, body: { ...input, tenant_id: b } })).status, 400);
      assert.equal((await send('/products?q=%25', { token: tokenA })).body.data.length, 0);
      assert.equal((await send('/products',{token:tokenA2})).body.data[0].name,'Gas A2');
      assert.equal((await send(`/products/${productA2}`,{method:'PUT',token:tokenA,body:{name:'Wrong unit'}})).status,404);
      assert.equal((await send('/auth/me',{token:tokenA2})).body.data.role,'operador');
      assert.equal((await send('/products',{token:tokenA2})).body.data[0].costPrice,undefined);
      assert.equal((await send('/products/stock/summary',{token:tokenA2})).status,403);
      assert.equal((await send('/products',{method:'POST',token:tokenA2,body:input})).status,403);
      assert.equal((await send('/products',{method:'POST',token:tokenA,body:{...input,establishmentId:a2}})).status,400);
    });
    await t.test('RLS also blocks unfiltered SQL, no context, forged writes and cross-tenant foreign keys', async () => {
      assert.equal((await db.pool.query('SELECT * FROM bansir.products')).rowCount, 0);
      await db.transaction({ userId: user, tenantId: a,establishmentId:a1 }, async client => {
        assert.deepEqual((await client.query('SELECT name FROM bansir.products')).rows.map(p => p.name), ['Gas A']);
      });
      await assert.rejects(db.transaction({ userId: user, tenantId: a,establishmentId:a1 }, client => client.query(`INSERT INTO bansir.products(tenant_id,name,barcode,price_cents,establishment_id) VALUES($1,'Wrong','WRONG',1,$2)`, [b,b1])), error => error.code === '42501');
      await assert.rejects(db.transaction({ userId: user, tenantId: a,establishmentId:a1 }, client => client.query(`INSERT INTO bansir.stock_movements(tenant_id,product_id,quantity,type,unit_price_cents,reason,user_id,establishment_id) VALUES($1,$2,1,'out',1,'cross-tenant',$3,$4)`, [a, productB.id, user,a1])), error => error.code === '23503');
      await assert.rejects(db.transaction({userId:user,tenantId:a,establishmentId:a1},client=>client.query(`INSERT INTO bansir.stock_movements(tenant_id,establishment_id,product_id,quantity,type,unit_price_cents,reason,user_id)
        VALUES($1,$2,$3,1,'out',1,'cross-unit',$4)`,[a,a1,productA2,user])),e=>e.code==='23503');
      await assert.rejects(db.transaction({ userId: other, tenantId: a,establishmentId:a1 }, () => null), /acesso/);
      const elevated = createDatabase({ connectionString: process.env.TEST_POSTGRES_ADMIN_URL });
      try { await assert.rejects(elevated.ready(), /papel de execução/); } finally { await elevated.close(); }
    });
    await t.test('tenant context is cleared on commit and rollback when a pooled connection is reused', async () => {
      const names = async (tenantId,establishmentId=tenantId===a?a1:b1) => reused.transaction({ userId: user, tenantId,establishmentId }, async client => (await client.query('SELECT name FROM bansir.products')).rows.map(r => r.name));
      assert.deepEqual(await names(a), ['Gas A']); assert.deepEqual(await names(b), ['Gas B']);
      await assert.rejects(reused.transaction({ userId: user, tenantId: a,establishmentId:a1 }, async () => { throw new Error('rollback'); }), /rollback/);
      assert.equal((await reused.pool.query('SELECT * FROM bansir.products')).rowCount, 0);
      assert.deepEqual(await names(b), ['Gas B']);
      assert.deepEqual(await names(a,a2),['Gas A2']);
      await reused.transaction({userId:user,tenantId:a},async client=>assert.equal((await client.query('SELECT * FROM bansir.products')).rowCount,0));
    });
    await t.test('RBAC, atomic last unit withdrawal and history stay inside the tenant', async () => {
      const loginOperator = await send('/auth/login', { method: 'POST', body: { email: 'operator@test.invalid', password } });
      const operatorToken = loginOperator.body.data.token;
      assert.equal((await send('/products', { token: operatorToken })).status, 200);
      assert.equal((await send('/products', { method: 'POST', token: operatorToken, body: { name: 'Bad', barcode: 'BAD', price: 1 } })).status, 403);
      const request = () => send('/products/stock/movement', { method: 'POST', token: tokenA, body: { productId: productA.id, type: 'out', quantity: 1, reason: 'Last unit' } });
      const outcomes = await Promise.all([request(), request()]);
      assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
      const stockA = await send('/products/stock/summary', { token: tokenA });
      const stockB = await send('/products/stock/summary', { token: tokenB });
      assert.equal(stockA.body.data.totalStockUnits, 0); assert.equal(stockB.body.data.totalStockUnits, 1);
      assert.equal(stockA.body.data.recentMovements.filter(m => m.type === 'out').length, 1);
    });
    await t.test('foundation import rolls back the entire batch, is repeatable and never overwrites live balances', async () => {
      const snapshot = { version: 1, foundationOnly: true, tenant: { slug: 'imported-tenant', name: 'Imported' },
        users: [{ legacyId: 'user-1', name: 'Imported admin', email: 'imported@test.invalid', passwordHash: hash, role: 'admin', allowedRoutes: ['products'] }],
        categories: [{ name: 'Gas' }], products: [{ legacyId: 'old-product', name: 'Imported gas', barcode: 'IMPORT', price: 123.45, stock: 5 }], settings: { storeName: 'Imported store' },
        pendingCollections: [{ name: 'ultragassales', count: 10 }] };
      const broken = structuredClone(snapshot);
      broken.products.push({ ...broken.products[0], legacyId: 'another-product' });
      await assert.rejects(importFoundation(process.env.TEST_POSTGRES_ADMIN_URL, broken), e => e.code === '23505');
      assert.equal((await admin.query("SELECT * FROM bansir.tenants WHERE slug='imported-tenant'")).rowCount, 0);
      assert.equal((await admin.query("SELECT * FROM bansir.users WHERE email='imported@test.invalid'")).rowCount, 0);
      const first = await importFoundation(process.env.TEST_POSTGRES_ADMIN_URL, snapshot);
      assert.equal(first.alreadyApplied, false); assert.equal(first.pendingCollections[0].count, 10);
      assert.equal((await admin.query('SELECT legacy_user_id FROM bansir.tenant_memberships WHERE tenant_id=$1', [first.tenantId])).rows[0].legacy_user_id, 'user-1');
      await admin.query('UPDATE bansir.products SET stock=2 WHERE tenant_id=$1', [first.tenantId]);
      const replay = await importFoundation(process.env.TEST_POSTGRES_ADMIN_URL, snapshot);
      assert.equal(replay.alreadyApplied, true);
      assert.equal((await admin.query('SELECT stock FROM bansir.products WHERE tenant_id=$1', [first.tenantId])).rows[0].stock, 2);
      await assert.rejects(importFoundation(process.env.TEST_POSTGRES_ADMIN_URL, { ...snapshot, tenant: { ...snapshot.tenant, name: 'Changed' } }), /outra origem/);
    });
    await t.test('bootstrap has no default password and runtime cannot create memberships or bypass policies', async () => {
      await assert.rejects(provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL, { slug: 'invalid-seed', name: 'Invalid', adminName: 'Admin', email: 'seed@test.invalid', password: 'short' }));
      const tenant = await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL, { slug: 'new-business', name: 'New business', adminName: 'Owner', email: 'owner@test.invalid', password });
      assert.ok(tenant.id);
      const login = await send('/auth/login', { method: 'POST', body: { email: 'owner@test.invalid', password } });
      assert.equal(login.body.data.user.role, 'admin'); assert.equal(login.body.data.tenant.id, tenant.id);
      await assert.rejects(db.transaction({ userId: user, tenantId: b }, client => client.query("UPDATE bansir.tenant_memberships SET role='superadmin' WHERE user_id=$1", [user])), e => e.code === '42501');
    });
    await t.test('returning to selection revokes the previous unit session and selection tickets are single-use',async()=>{
      const previous=await choose(a,a2);
      const back=await send('/auth/return-to-selection',{method:'POST',token:previous,body:{}});
      assert.equal(back.status,200);
      assert.equal(back.body.data.requiresEstablishmentSelection,true);
      assert.equal((await send('/products',{token:previous})).status,401);
      assert.equal((await send('/auth/return-to-selection',{method:'POST',token:previous,body:{}})).status,401);
      const selectionToken=back.body.data.selectionToken;
      const selected=await send('/auth/select-establishment',{method:'POST',body:{selectionToken,tenantId:a,establishmentId:a1}});
      assert.equal(selected.status,200);
      assert.equal(selected.body.data.user.establishment.id,a1);
      assert.equal(selected.body.data.user.role,'admin');
      assert.equal((await send('/auth/select-establishment',{method:'POST',body:{selectionToken,tenantId:a,establishmentId:a2}})).status,401);
      assert.equal((await send('/auth/select-establishment',{method:'POST',body:{selectionToken:ticket,tenantId:a,establishmentId:b1}})).status,403);
    });
    await t.test('plan limits are enforced in concurrent creation and an incompatible downgrade is rejected',async()=>{
      const input={tenantSlug:'test-a',name:'Additional',memberships:[{userId:user,role:'admin',allowedRoutes:['products']}]};
      await assert.rejects(createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,input),e=>e.code==='23514');
      await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:'test-a',code:'test-three',name:'Test capacity',maxEstablishments:3});
      const attempts=await Promise.allSettled([1,2,3].map(i=>createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,{...input,name:`New ${i}`})));
      assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(attempts.filter(r=>r.status==='rejected' && r.reason.code==='23514').length,2);
      assert.equal((await admin.query('SELECT count(*)::integer AS count FROM bansir.establishments WHERE tenant_id=$1',[a])).rows[0].count,3);
      await assert.rejects(assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:'test-a',code:'test-two',name:'Test only',maxEstablishments:2}),e=>e.code==='23514');
      await assert.rejects(admin.query("UPDATE bansir.plans SET max_establishments=1 WHERE code='test-three'"),e=>e.code==='23514');
    });
    await t.test('migration 002 preserves existing single-unit data and converts its permissions',async()=>{
      const upgradeName=new URL(runtimeUrl).pathname.slice(1)+'_upgrade';
      await admin.query(`CREATE DATABASE "${upgradeName}"`);
      const url=new URL(process.env.TEST_POSTGRES_ADMIN_URL);url.pathname='/'+upgradeName;
      const legacy=new pg.Client({connectionString:url.toString()});await legacy.connect();
      try {
        await legacy.query(await readFile(new URL('../migrations/postgres/001_tenant_foundation.sql',import.meta.url),'utf8'));
        const tenantId=randomUUID(),unitId=randomUUID(),userId=randomUUID();
        await legacy.query("INSERT INTO bansir.tenants(id,slug,name) VALUES($1,'legacy-upgrade','Legacy')",[tenantId]);
        await legacy.query("INSERT INTO bansir.users(id,email,name,password_hash) VALUES($1,'legacy@test.invalid','Legacy',$2)",[userId,hash]);
        await legacy.query("INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenantId,userId]);
        await legacy.query("INSERT INTO bansir.establishments(tenant_id,id,name) VALUES($1,$2,'Original unit')",[tenantId,unitId]);
        await legacy.query("INSERT INTO bansir.products(tenant_id,name,barcode,price_cents,stock) VALUES($1,'Existing','UPGRADE',12345,3)",[tenantId]);
        await legacy.query("INSERT INTO bansir.store_settings(tenant_id,store_name) VALUES($1,'Original settings')",[tenantId]);
        await legacy.query('BEGIN');
        await legacy.query(await readFile(new URL('../migrations/postgres/002_establishment_access.sql',import.meta.url),'utf8'));
        await legacy.query('COMMIT');
        const product=(await legacy.query('SELECT establishment_id,stock,price_cents FROM bansir.products')).rows[0];
        assert.equal(product.establishment_id,unitId);assert.equal(product.stock,3);assert.equal(product.price_cents,'12345');
        assert.equal((await legacy.query('SELECT role FROM bansir.establishment_memberships')).rows[0].role,'admin');
        assert.equal((await legacy.query('SELECT establishment_id FROM bansir.store_settings')).rows[0].establishment_id,unitId);
      } finally {await legacy.end();}
    });
    await t.test('store settings and revoked memberships are isolated; legacy modules never fall back', async () => {
      assert.equal((await send('/settings', { method: 'PUT', token: tokenA, body: { storeName: 'Store A' } })).status, 200);
      assert.equal((await send('/settings', { method: 'PUT', token: tokenB, body: { storeName: 'Store B' } })).status, 200);
      assert.equal((await send('/settings', { token: tokenA })).body.data.storeName, 'Store A');
      const stillA2=await choose(a,a2);
      assert.equal((await send('/settings',{token:stillA2})).status,403);
      await admin.query('UPDATE bansir.establishment_memberships SET active=false WHERE tenant_id=$1 AND establishment_id=$2 AND user_id=$3',[a,a1,user]);
      assert.equal((await send('/products',{token:tokenA})).status,403);
      assert.equal((await send('/products',{token:stillA2})).status,200);
      assert.equal((await send('/financial', { token: tokenA })).body.code, 'MODULE_MIGRATION_PENDING');
      assert.equal((await send('/fleet/vehicles')).status, 401);
      await admin.query('UPDATE bansir.tenant_memberships SET active=false WHERE tenant_id=$1 AND user_id=$2', [a, user]);
      assert.equal((await send('/products', { token: tokenA })).status, 403);
      assert.equal((await send('/products', { token: tokenB })).status, 200);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await Promise.all([db.close(), reused.close(), admin.end()]);
  }
});

