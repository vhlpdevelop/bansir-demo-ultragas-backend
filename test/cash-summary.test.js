import test from 'node:test';
import assert from 'node:assert/strict';
import { cashProductTotals, cashFullSummary } from '../src/postgres/cash-summary.js';
import { mountSales } from '../src/postgres/sales.js';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const EST_ID = '22222222-2222-4222-8222-222222222222';
const CASH_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ID = '55555555-5555-4555-8555-555555555555';

test('cashProductTotals excludes cancelled sales and formats sold product quantities', async () => {
  const queries = [];
  const c = {
    async query(sql, params) {
      queries.push({ sql, params });
      return {
        rows: [
          {
            productId: 'prod-1',
            productName: 'Botijão P13',
            unit: 'un',
            quantity: '14',
            grossCents: '168000',
            discountCents: '2000',
            netCents: '166000',
            salesCount: 9
          }
        ]
      };
    }
  };
  const cutoff = new Date('2026-11-14T22:00:00Z');
  const result = await cashProductTotals(c, CASH_ID, cutoff);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /HAVING sum\(i\.quantity\) > 0/i);
  assert.match(queries[0].sql, /NOT EXISTS/i);
  assert.deepEqual(result, [
    {
      productId: 'prod-1',
      productName: 'Botijão P13',
      unit: 'un',
      quantity: 14,
      grossCents: 168000,
      discountCents: 2000,
      netCents: 166000,
      salesCount: 9
    }
  ]);
});

test('cashFullSummary aggregates sales, items, payments, movements and previous sale receipts', async () => {
  const c = {
    async query(sql) {
      if (sql.includes('FROM bansir.establishments')) {
        return { rows: [{ name: 'Bansir Matriz', document_id: '12345678000199' }] };
      }
      if (sql.includes('FROM bansir.sales s') && sql.includes('LEFT JOIN bansir.sale_cancellations')) {
        return {
          rows: [
            {
              id: 'sale-1',
              coupon_number: 101,
              created_at: '2026-11-14T12:15:00Z',
              customer_name: 'Maria',
              delivery_mode: 'delivery',
              subtotal_cents: '12000',
              discount_cents: '0',
              delivery_fee_cents: '500',
              total_cents: '12500',
              cancelled_at: null,
              cancellation_reason: null
            },
            {
              id: 'sale-2',
              coupon_number: 102,
              created_at: '2026-11-14T13:05:00Z',
              customer_name: 'José',
              delivery_mode: 'pickup',
              subtotal_cents: '11000',
              discount_cents: '0',
              delivery_fee_cents: '0',
              total_cents: '11000',
              cancelled_at: '2026-11-14T13:10:00Z',
              cancellation_reason: 'Desistência'
            }
          ]
        };
      }
      if (sql.includes('FROM bansir.cash_movements')) {
        return {
          rows: [
            { id: 'mov-1', kind: 'deposit', amount_cents: '5000', reason: 'Troco extra', created_at: '2026-11-14T11:00:00Z' },
            { id: 'mov-2', kind: 'withdrawal', amount_cents: '2000', reason: 'Café', created_at: '2026-11-14T14:00:00Z' },
            { id: 'mov-3', kind: 'refund', amount_cents: '11000', reason: 'Estorno venda', created_at: '2026-11-14T13:10:00Z' }
          ]
        };
      }
      if (sql.includes('s.cash_session_id <> $1')) {
        return {
          rows: [
            {
              id: 'pay-prev',
              sale_id: 'sale-old',
              coupon_number: 95,
              customer_name: 'Carlos',
              sale_created_at: '2026-11-13T17:00:00Z',
              method: 'pix',
              amount_cents: '12000',
              paid_at: '2026-11-14T12:40:00Z',
              reference: 'E2E123'
            }
          ]
        };
      }
      if (sql.includes('FROM bansir.sale_items')) {
        return {
          rows: [
            { sale_id: 'sale-1', product_id: 'prod-1', product_name: 'Botijão P13', unit: 'un', quantity: 1, gross_cents: '12000', discount_cents: '0' },
            { sale_id: 'sale-2', product_id: 'prod-1', product_name: 'Botijão P13', unit: 'un', quantity: 1, gross_cents: '11000', discount_cents: '0' }
          ]
        };
      }
      if (sql.includes('FROM bansir.sale_payments')) {
        return {
          rows: [
            { sale_id: 'sale-1', method: 'pix', amount_cents: '12500', paid_at: '2026-11-14T12:15:00Z', reference: '', cash_session_id: CASH_ID }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const summary = await cashFullSummary(c, {
    cash: {
      id: CASH_ID,
      tenant_id: TENANT_ID,
      establishment_id: EST_ID,
      user_id: OWNER_ID,
      operator_name: 'João Operador',
      closed_at: null
    },
    cashViewData: {
      id: CASH_ID,
      opening_cents: 10000,
      expected_cents: 13000,
      sales_cents: 12500,
      receivable_cents: 0,
      paymentTotals: { pix: 24500 },
      refundTotals: { cash: 11000 },
      productSummary: [{ productId: 'prod-1', productName: 'Botijão P13', unit: 'un', quantity: 1, grossCents: 12000, discountCents: 0, netCents: 12000, salesCount: 1 }]
    }
  });

  assert.equal(summary.establishment.name, 'Bansir Matriz');
  assert.equal(summary.cash.operator_name, 'João Operador');
  assert.equal(summary.sales.length, 2);
  assert.equal(summary.sales[0].status, 'paid');
  assert.equal(summary.sales[1].status, 'cancelled');
  assert.equal(summary.movements.length, 2);
  assert.equal(summary.previousSalePayments.length, 1);
  assert.deepEqual(summary.totals, {
    salesCount: 1,
    cancelledCount: 1,
    unitsSold: 1,
    depositCents: 5000,
    withdrawalCents: 2000,
    refundCashCents: 11000
  });
});

test('GET /api/v1/pdv/cash/:id/summary enforces operator ownership unless manager', async () => {
  const routes = new Map();
  const fakeApp = {
    get(path, handler) { routes.set(`GET ${path}`, handler); },
    post(path, handler) { routes.set(`POST ${path}`, handler); },
    patch(path, handler) { routes.set(`PATCH ${path}`, handler); },
    put() {},
    delete() {}
  };
  const makeScoped = (actor) => (_perm, _ro, fn) => (req) => fn({
    async query(sql) {
      if (sql.includes('FROM bansir.cash_sessions s JOIN bansir.users')) {
        return { rows: [{ id: CASH_ID, tenant_id: TENANT_ID, establishment_id: EST_ID, user_id: OWNER_ID, operator_name: 'João', opening_cents: 0, expected_cents: 0, counted_cents: null, difference_cents: null, closed_at: null }] };
      }
      if (sql.includes('FROM bansir.establishments')) return { rows: [{ name: 'Loja', document_id: '' }] };
      if (sql.includes('FROM bansir.cash_movements')) return { rows: [{ delta: 0 }] };
      if (sql.includes('AS sales_cents')) return { rows: [{ sales_cents: 0, cents: 0 }] };
      return { rows: [] };
    }
  }, { ...req, identity: { tenantId: TENANT_ID, establishmentId: EST_ID, userId: actor.id } }, actor.member);

  mountSales(fakeApp, { scoped: makeScoped({ id: OTHER_ID, member: { role: 'operador', allowed_routes: ['sales'] } }) });
  const otherHandler = routes.get('GET /api/v1/pdv/cash/:id/summary');
  await assert.rejects(() => otherHandler({ params: { id: CASH_ID } }), (err) => err.status === 404);

  const routesMgr = new Map();
  mountSales({
    get(path, handler) { routesMgr.set(`GET ${path}`, handler); },
    post() {},
    patch() {},
    put() {},
    delete() {}
  }, { scoped: makeScoped({ id: OTHER_ID, member: { role: 'operador', allowed_routes: ['sales', 'sales-manage'] } }) });
  const mgrRes = await routesMgr.get('GET /api/v1/pdv/cash/:id/summary')({ params: { id: CASH_ID } });
  assert.equal(mgrRes.data.cash.id, CASH_ID);
});
