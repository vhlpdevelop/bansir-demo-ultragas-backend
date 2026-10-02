import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';

test('isolated MongoDB + HTTP checkout lifecycle', { skip: process.env.RUN_OPERATIONS_INTEGRATION !== '1', timeout: 180000 }, async t => {
  // Never read/use the application's MongoDB URI: this binary and database are disposable.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mongo = await MongoMemoryServer.create({ instance: { dbName: 'bansir_operations_test' } });
  const { default: mongoose } = await import('mongoose');
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  process.env.INTEGRATION_MODE = 'demo';
  await mongoose.connect(mongo.getUri());
  const { default: app } = await import('../src/app.js');
  const { User } = await import('../src/modules/users/user.model.js');
  const { Product } = await import('../src/modules/products/product.model.js');
  const { Sale } = await import('../src/modules/sales/sale.model.js');
  const { Operation } = await import('../src/modules/operations/operation.model.js');
  const { tickOperations } = await import('../src/modules/operations/operation.service.js');
  const { generateToken } = await import('../src/modules/auth/auth.service.js');
  await Operation.init();
  const [owner, other, admin] = await User.create([
    { name: 'Owner', email: 'owner@test.invalid', password: 'test-password-only', role: 'operador' },
    { name: 'Other', email: 'other@test.invalid', password: 'test-password-only', role: 'operador' },
    { name: 'Admin', email: 'admin@test.invalid', password: 'test-password-only', role: 'admin' }
  ]);
  const product = await Product.create({ name: 'Peça de teste', barcode: 'test-001', price: 59.9, stock: 8 });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/operations`;
  const headers = user => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${generateToken(user)}` });
  const send = async (path, method = 'GET', body, user = owner) => {
    const response = await fetch(base + path, { method, headers: headers(user), ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const payload = scenario => ({ requestId: randomUUID(), items: [{ productId: String(product._id), quantity: 2 }], method: 'credit', installments: 3, model: '65', scenario });
  try {
    let first;
    await t.test('concurrent creation is idempotent and ignores client amounts', async () => {
      const data = { ...payload('success'), totalCents: 1, unitPrice: 0.01 };
      const responses = await Promise.all(Array.from({ length: 5 }, () => send('/', 'POST', data)));
      responses.forEach(r => assert.equal(r.status, 202));
      first = responses[0].body.data;
      assert.equal(new Set(responses.map(r => r.body.data.id)).size, 1);
      assert.equal(first.totalCents, 11980);
      assert.equal(await Operation.countDocuments(), 1);
      assert.equal((await send('/', 'POST', { ...data, installments: 4 })).status, 409);
    });
    await t.test('two workers cannot run the same payment job; state persists', async () => {
      await Promise.all([tickOperations(), tickOperations()]);
      const op = (await send(`/${first.id}`)).body.data;
      assert.equal(op.paymentStatus, 'paid'); assert.equal(op.fiscalStatus, 'authorized');
      assert.equal(op.events.filter(e => e.message === 'Iniciando simulação.').length, 1);
      assert.equal(op.fiscalPayload, undefined); assert.equal(op.lockToken, undefined);
      assert.equal((await Product.findById(product._id)).stock, 8);
      assert.equal(await Sale.countDocuments(), 0);
    });
    await t.test('operators cannot read other operators documents or change tax data', async () => {
      assert.equal((await send(`/${first.id}`, 'GET', undefined, other)).status, 404);
      assert.equal((await send('/', 'GET', undefined, other)).body.total, 0);
      assert.equal((await send(`/${first.id}/draft`)).status, 403);
      assert.equal((await send(`/${first.id}`, 'GET', undefined, admin)).status, 200);
      assert.equal((await fetch(`${base}/${first.id}/report.pdf`, { headers: headers(other) })).status, 404);
      assert.equal((await fetch(base)).status, 401);
    });
    await t.test('PDF is a report; demo does not expose fake authorized XML', async () => {
      const response = await fetch(`${base}/${first.id}/report.pdf`, { headers: headers(owner) });
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /application\/pdf/);
      const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      assert.equal((await send(`/${first.id}/xml`)).status, 409);
      assert.equal((await send(`/${first.id}/danfe`)).status, 409);
    });
    await t.test('all failure scenarios and safe recovery actions', async () => {
      for (const scenario of ['declined', 'payment_timeout', 'fiscal_rejected', 'fiscal_timeout']) {
        const created = (await send('/', 'POST', payload(scenario))).body.data;
        await tickOperations();
        const op = (await send(`/${created.id}`)).body.data;
        if (scenario === 'declined') { assert.equal(op.paymentStatus, 'declined'); assert.equal(op.fiscalStatus, 'waiting'); continue; }
        const action = scenario === 'payment_timeout' ? 'reconcile' : scenario === 'fiscal_timeout' ? 'consult-fiscal' : 'retry-fiscal';
        if (scenario === 'fiscal_timeout') assert.equal((await send(`/${op.id}/actions`, 'POST', { action: 'retry-fiscal' })).status, 409);
        assert.equal((await send(`/${op.id}/actions`, 'POST', { action })).status, 202);
        assert.equal((await send(`/${op.id}/actions`, 'POST', { action })).status, 409);
        await tickOperations();
        const recovered = (await send(`/${op.id}`)).body.data;
        assert.equal(recovered.paymentStatus, 'paid'); assert.equal(recovered.fiscalStatus, 'authorized');
      }
    });
    await t.test('crashed worker leases become uncertain, never automatically charged again', async () => {
      const op = await Operation.create({ _id: randomUUID(), ownerId: String(owner._id), requestId: randomUUID(), mode: 'demo', paymentStatus: 'submitting', fiscalStatus: 'waiting', busy: true, job: 'start', leaseUntil: new Date(0) });
      await tickOperations();
      const recovered = await Operation.findById(op._id);
      assert.equal(recovered.paymentStatus, 'unknown'); assert.equal(recovered.busy, false); assert.equal(recovered.job, null);
    });
    await t.test('forged notification never marks a payment paid', async () => {
      const op = await Operation.create({ _id: randomUUID(), ownerId: String(owner._id), requestId: randomUUID(), mode: 'homologation', paymentStatus: 'pending', providerOrderId: 'known-sandbox-id', nextPollAt: new Date(Date.now() + 60000) });
      const response = await fetch(base + '/cielo/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'known-sandbox-id', status: 'PAID', price: 100, transactions: [{ status: 'CONFIRMED' }] }) });
      assert.equal(response.status, 202);
      assert.equal((await Operation.findById(op._id)).paymentStatus, 'pending');
    });
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect(); await mongo.stop();
  }
});
