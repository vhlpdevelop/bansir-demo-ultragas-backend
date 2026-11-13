import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { escapeLike } from '../src/postgres/database.js';
import { seal, secretContext } from '../src/postgres/secrets.js';
import { settingsModule } from '../src/postgres/settings-permissions.js';
import { hasPermission, requireAnyPermission, requirePermission } from '../src/postgres/catalog.js';
import { mountSaleEditing } from '../src/postgres/sale-editing.js';
import { mountSales, saleFiscalDraft } from '../src/postgres/sales.js';

function fakeApp() {
  const routes = new Map();
  return {
    routes,
    get(path, fn) { routes.set(`GET ${path}`, fn); },
    post(path, fn) { routes.set(`POST ${path}`, fn); },
    put(path, fn) { routes.set(`PUT ${path}`, fn); },
    patch(path, fn) { routes.set(`PATCH ${path}`, fn); },
    delete(path, fn) { routes.set(`DELETE ${path}`, fn); }
  };
}

test('settingsModule maps IBPT and worker job routes to expected settings modules', () => {
  assert.equal(settingsModule('/api/v1/fiscal/ibpt/sync'), 'settings-fiscal');
  assert.equal(settingsModule('/api/v1/fiscal/settings'), 'settings-fiscal');
  assert.equal(settingsModule('/api/v1/workers/jobs'), 'settings-infrastructure');
  assert.equal(settingsModule('/api/v1/workers/jobs/job-123'), 'settings-infrastructure');
});

test('hasPermission excludes sensitive modules from legacy settings wildcard and limits module-prefix grants', () => {
  const legacySettings = { role: 'user', allowed_routes: ['settings'] };
  assert.equal(hasPermission(legacySettings, 'settings-fiscal', true), true);
  assert.equal(hasPermission(legacySettings, 'settings-infrastructure', true), true);
  assert.equal(hasPermission(legacySettings, 'settings-terminals', true), false);
  assert.equal(hasPermission(legacySettings, 'settings-whatsapp', true), false);

  assert.equal(hasPermission({ role: 'user', allowed_routes: ['settings-terminals'] }, 'settings-terminals', false), true);
  assert.equal(hasPermission({ role: 'user', allowed_routes: ['settings-whatsapp'] }, 'settings-whatsapp', false), true);

  const customersReader = { role: 'user', allowed_routes: ['customers-view'] };
  assert.equal(hasPermission(customersReader, 'customers', true), true);
  assert.equal(hasPermission(customersReader, 'customers', false), false);

  const fleetReader = { role: 'user', allowed_routes: ['fleet-view'] };
  assert.equal(hasPermission(fleetReader, 'fleet', true), true);
  assert.equal(hasPermission(fleetReader, 'fleet', false), false);
  assert.equal(hasPermission({ role: 'user', allowed_routes: ['fleet'] }, 'fleet', false), true);

  const salesManager = { role: 'user', allowed_routes: ['sales-manage'] };
  assert.equal(hasPermission(salesManager, 'sales', true), true);
  assert.equal(hasPermission(salesManager, 'sales', false), true);

  const admin = { role: 'admin', allowed_routes: [] };
  assert.equal(hasPermission(admin, 'settings-terminals', false), true);
  assert.equal(hasPermission(admin, 'customers', false), true);
});

test('requireAnyPermission allows any matching module and rejects insufficient permissions with 403', () => {
  assert.doesNotThrow(() => requireAnyPermission({ role: 'user', allowed_routes: ['sales'] }, ['customers', 'sales'], false));
  assert.doesNotThrow(() => requireAnyPermission({ role: 'user', allowed_routes: ['customers'] }, ['customers', 'sales'], false));

  assert.throws(
    () => requireAnyPermission({ role: 'user', allowed_routes: ['settings'] }, ['customers', 'sales'], false),
    err => err.status === 403 && err.code === 'FORBIDDEN'
  );
  assert.throws(
    () => requireAnyPermission({ role: 'user', allowed_routes: ['customers-view'] }, ['customers', 'sales'], false),
    err => err.status === 403 && err.code === 'FORBIDDEN'
  );
  assert.throws(
    () => requirePermission({ role: 'user', allowed_routes: ['settings'] }, 'settings-whatsapp', false),
    err => err.status === 403 && err.code === 'FORBIDDEN'
  );
});

test('escapeLike escapes SQL LIKE wildcards and backslash characters', () => {
  assert.equal(escapeLike('100%_a\\b'), '100\\%\\_a\\\\b');
  assert.equal(escapeLike('gas p13'), 'gas p13');
  assert.equal(escapeLike(''), '');
});

test('migration 080 adds encrypted_ibpt_token and removes plaintext ibptToken from JSONB', () => {
  const sql = readFileSync(new URL('../migrations/postgres/080_encrypt_ibpt_token.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS encrypted_ibpt_token text/i);
  assert.match(sql, /data\s*-\s*'ibptToken'/);
});

test('mountSales does not register duplicate POST /api/v1/customers and enforces tributary fields on fiscal draft emission', async () => {
  const prevKey = process.env.FISCAL_ENCRYPTION_KEY;
  process.env.FISCAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  try {
    const app = fakeApp();
    const saleId = randomUUID();
    const productId = randomUUID();
    const identity = { tenantId: randomUUID(), establishmentId: randomUUID(), userId: randomUUID() };
    const sale = {
      id: saleId,
      status: 'paid',
      document_id: null,
      fiscal_status: null,
      subtotal_cents: 11000,
      delivery_fee_cents: 0,
      discount_cents: 0,
      total_cents: 11000,
      customer_document: '',
      customer_name: 'Cliente',
      customer_details: { name: 'Cliente', document: '', fiscal: {} },
      items: [{
        product_id: productId,
        product_name: 'AGUA MINERAL 20L',
        ncm: '22011000',
        unit: 'UN',
        quantity: 1,
        unit_price_cents: 11000,
        gross_cents: 11000,
        discount_cents: 0,
        fiscal_profile: { '65': { ncm: '22011000', cfop: '5102', taxes: { ICMS: {}, PIS: {}, COFINS: {} } } }
      }],
      payments: [{ method: 'cash', received_cents: 11000, amount_cents: 11000 }]
    };

    const fiscalConfig = {
      cnpj: '11222333000181',
      legalName: 'Test',
      tradeName: 'Test',
      ie: '123456789',
      crt: 1,
      environment: 2,
      series: 1,
      nextNumber: 1,
      nfeSeries: 1,
      nfeNextNumber: 1,
      timeZone: 'America/Cuiaba',
      cscId: '1',
      address: { street: 'Rua', number: '1', district: 'Centro', city: 'Cuiaba', cityCode: '5103403', uf: 'MT', cep: '78000000', phone: '65999999999' }
    };

    let capturedInsert = null;
    const mockDb = {
      async query(sql, params = []) {
        if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM bansir.sales')) {
          return {
            rows: [{
              id: saleId,
              created_by: identity.userId,
              coupon_number: 1,
              customer_snapshot: sale.customer_details,
              customer_document: '',
              customer_name: 'Cliente',
              delivery_address: '',
              subtotal_cents: 11000,
              delivery_fee_cents: 0,
              discount_cents: 0,
              total_cents: 11000,
              cancelled_at: null,
              document_id: null,
              fiscal_status: null
            }],
            rowCount: 1
          };
        }
        if (sql.includes('FROM bansir.sale_items')) return { rows: sale.items, rowCount: sale.items.length };
        if (sql.includes('FROM bansir.active_sale_payments')) return { rows: sale.payments, rowCount: sale.payments.length };
        if (sql.includes('FROM bansir.fiscal_settings')) {
          return {
            rows: [{ data: fiscalConfig, encrypted_csc: seal('TEST CSC', secretContext(identity, 'csc')) }],
            rowCount: 1
          };
        }
        if (sql.includes('bansir.fiscal_numbering')) {
          return { rows: [{ series: 1, next_number: 1, nfe_series: 1, nfe_next_number: 1, model_55_next: 1 }], rowCount: 1 };
        }
        if (sql.includes('FROM bansir.fiscal_certificates')) {
          return { rows: [{ id: randomUUID(), cnpj: '11222333000181', valid_until: '2028-01-01T00:00:00Z' }], rowCount: 1 };
        }
        if (sql.includes('FROM bansir.fiscal_documents')) return { rows: [], rowCount: 0 };
        if (sql.includes('FROM bansir.smartpos_charges')) return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO bansir.fiscal_documents')) {
          capturedInsert = params;
          return { rows: [{ id: randomUUID(), status: 'queued' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    };

    mountSales(app, {
      scoped: (_mod, _read, fn) => (req, res) => fn(mockDb, req, req.member, res)
    });

    assert.equal(app.routes.has('POST /api/v1/customers'), false);
    const fiscalHandler = app.routes.get('POST /api/v1/sales/:id/fiscal');
    assert.ok(fiscalHandler);

    const member = { role: 'admin', allowed_routes: [] };

    // Tampering qTrib must be rejected with FISCAL_SALE_MISMATCH
    const badDraft = saleFiscalDraft(sale, '65');
    badDraft.det[0].prod.qTrib = 2;
    await assert.rejects(
      fiscalHandler({
        identity,
        member,
        params: { id: saleId },
        body: { requestKey: randomUUID(), model: '65', operation: { finalConsumer: true, presence: 1 }, draft: badDraft }
      }),
      err => err.status === 400 && err.code === 'FISCAL_SALE_MISMATCH'
    );

    // Accountant override of NCM/CFOP/imposto passes and persists fiscalOverrides in payload
    const overrideDraft = saleFiscalDraft(sale, '65');
    overrideDraft.det[0].prod.CFOP = '5405';
    overrideDraft.det[0].imposto = { ICMS: { testOnly: true }, PIS: { testOnly: true }, COFINS: { testOnly: true } };
    const result = await fiscalHandler({
      identity,
      member,
      params: { id: saleId },
      body: { requestKey: randomUUID(), model: '65', operation: { finalConsumer: true, presence: 1 }, draft: overrideDraft }
    });
    assert.equal(result.status, 202);
    assert.ok(capturedInsert);
    const payloadParam = capturedInsert.find(p => p && typeof p === 'object' && Array.isArray(p.fiscalOverrides));
    assert.ok(payloadParam, 'expected fiscalOverrides to be persisted in fiscal_documents payload');
    assert.equal(payloadParam.fiscalOverrides[0].nItem, 1);
    assert.deepEqual(
      payloadParam.fiscalOverrides[0].changed.map(c => c.field),
      ['CFOP', 'imposto']
    );
  } finally {
    if (prevKey === undefined) delete process.env.FISCAL_ENCRYPTION_KEY;
    else process.env.FISCAL_ENCRYPTION_KEY = prevKey;
  }
});

test('mountSaleEditing locks delivery changes during en_route/delivered while allowing unrelated edits without resetting task', async () => {
  const app = fakeApp();
  const saleId = randomUUID();
  const driverId = randomUUID();
  const baseSale = {
    id: saleId,
    revision: 1,
    cancelled_at: null,
    document_id: null,
    delivery_mode: 'delivery',
    delivery_address: 'Rua das Flores, 100',
    delivery_employee_id: driverId,
    delivery_employee_name: 'Carlos',
    delivery_employee_phone: '67999990000',
    agreement: null,
    financial_status: 'paid',
    payments: [{ method: 'cash', amount_cents: 10000, received_cents: 10000 }],
    items: [{ position: 1, ncm: '27111910', fiscal_profile: {} }],
    customer_details: { name: 'Ana', document: '', phone: '', address: 'Rua das Flores, 100', email: '', notes: '', fiscal: {} }
  };

  let taskStatus = 'en_route';
  const queries = [];
  const mockDb = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes('FROM bansir.delivery_tasks WHERE sale_id=$1 FOR UPDATE')) {
        return { rows: [{ id: randomUUID(), status: taskStatus, version: 2 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  };

  mountSaleEditing(app, {
    scoped: (_mod, _read, fn) => (req, res) => fn(mockDb, req, req.member, res),
    ownedSale: async () => {},
    saleView: async () => structuredClone(baseSale)
  });

  const editHandler = app.routes.get('PATCH /api/v1/sales/:id/edit');
  assert.ok(editHandler);

  const reqBase = {
    identity: { tenantId: randomUUID(), establishmentId: randomUUID(), userId: randomUUID() },
    member: { role: 'admin', allowed_routes: [] },
    params: { id: saleId }
  };

  // Mode change from delivery -> pickup while en_route must fail 409 SALE_DELIVERY_LOCKED
  await assert.rejects(
    editHandler({
      ...reqBase,
      body: {
        requestKey: randomUUID(),
        revision: 1,
        reason: 'Cliente pediu retirada',
        customer: baseSale.customer_details,
        deliveryAddress: baseSale.delivery_address,
        deliveryMode: 'pickup'
      }
    }),
    err => err.status === 409 && err.code === 'SALE_DELIVERY_LOCKED'
  );

  // Driver change while delivered must fail 409 SALE_DELIVERY_LOCKED
  taskStatus = 'delivered';
  await assert.rejects(
    editHandler({
      ...reqBase,
      body: {
        requestKey: randomUUID(),
        revision: 1,
        reason: 'Troca de entregador',
        customer: baseSale.customer_details,
        deliveryAddress: baseSale.delivery_address,
        deliveryEmployeeId: randomUUID()
      }
    }),
    err => err.status === 409 && err.code === 'SALE_DELIVERY_LOCKED'
  );

  // Unrelated edit (customer notes) while en_route must succeed without resetting delivery_tasks
  taskStatus = 'en_route';
  queries.length = 0;
  await editHandler({
    ...reqBase,
    body: {
      requestKey: randomUUID(),
      revision: 1,
      reason: 'Atualizando observacao do cliente',
      customer: { ...baseSale.customer_details, notes: 'Portao azul' },
      deliveryAddress: baseSale.delivery_address
    }
  });
  assert.equal(queries.some(sql => sql.includes('UPDATE bansir.delivery_tasks')), false);
  assert.equal(queries.some(sql => sql.includes('INSERT INTO bansir.delivery_tasks')), false);
  assert.equal(queries.some(sql => sql.includes('UPDATE bansir.sales')), true);
});
