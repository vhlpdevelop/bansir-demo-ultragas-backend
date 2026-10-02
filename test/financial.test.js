import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePricing } from '../src/modules/financial/pricing-calculator.js';
import * as finance from '../src/modules/financial/financial.service.js';
test('pricing: formula parity, correct contribution and term fee, invalid inputs', async () => {
  const serverSource = await readFile(new URL('../src/modules/financial/pricing-calculator.js', import.meta.url), 'utf8');
  // The frontend is a separate repository; compare when both checkouts are available.
  try {
    const clientSource = await readFile(new URL('../../bansir-demo-ultragas-app/src/utils/pricingCalculator.js', import.meta.url), 'utf8');
    assert.equal(serverSource, clientSource);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const input = { taxRate: 6, variableRate: 7.2, commissionRate: 4.63, fixedExpenseRate: 16.5, desiredProfitMargin: 18, creditCardTermRate: 4.8, cost: 45 };
  const result = calculatePricing(input);
  assert.equal(result.contributionMarginPercent, 34.5);
  assert.equal(result.suggestedCashPrice, 94.4);
  assert.equal(result.suggestedTermPrice, 104.97);
  assert.ok(Math.abs(result.suggestedTermPrice * (1 - (52.33 + 4.8) / 100) - 45) < 0.01);
  assert.equal(calculatePricing({ ...input, taxRate: 100 }).valid, false);
  assert.equal(calculatePricing({ ...input, cost: Infinity }).valid, false);
  assert.equal(calculatePricing({ ...input, creditCardTermRate: 60 }).valid, false);
  assert.equal(calculatePricing({ ...input, cost: -1 }).valid, false);

  // Intelligent rateio under low revenue (e.g. fixed rate 120%) does not break mathematics
  const lowRevResult = calculatePricing({ ...input, fixedExpenseRate: 120, cost: 75 });
  assert.equal(lowRevResult.valid, true);
  assert.equal(lowRevResult.isRateioAdjusted, true);
  assert.ok(lowRevResult.suggestedCashPrice > 75 && Number.isFinite(lowRevResult.suggestedCashPrice));
});


test('card receivables preserve cents, fees and month-end dates', () => {
  const sale = { _id: 'audit-sale', saleNumber: 'AUDIT', productName: 'Item', paymentMethod: 'cartao_credito', totalAmount: 100, installments: 3, paymentFeeRate: 2.99, firstReceiptDate: '2027-01-31T12:00:00Z', date: new Date() };
  const entries = finance.buildSaleReceivables(sale);
  assert.deepEqual(entries.map(e => e.amount), [32.34, 32.34, 32.33]);
  assert.deepEqual(entries.map(e => e.dueDate.toISOString().slice(0,10)), ['2027-01-31','2027-02-28','2027-03-31']);
  assert.ok(entries.every(e => e.status === 'pending'));
  assert.throws(() => finance.buildSaleReceivables({ ...sale, installments: 0 }));
  assert.throws(() => finance.buildSaleReceivables({ ...sale, paymentFeeRate: 100 }));
});
test('without MongoDB all business services fail instead of using fixtures or files', async () => {
  const products = await import('../src/modules/products/product.service.js');
  const auth = await import('../src/modules/auth/auth.service.js');
  const sales = await import('../src/modules/sales/sale.service.js');
  const employees = await import('../src/modules/employees/employee.service.js');
  const notifications = await import('../src/modules/notifications/notification.service.js');
  const pricing = await import('../src/modules/financial/pricing-intelligence.service.js');
  for (const operation of [() => products.getAllProducts(), () => auth.loginUser('admin@bansir.com','anything'),
    () => sales.getAllSales(), () => employees.getAllEmployees(), () => finance.getAllTransactions(),
    () => finance.createTransaction({ title: 'No DB', amount: 10 }), () => pricing.getPricingIntelligenceData(),
    () => notifications.getNotificationsForUser({ role: 'admin' })]) await assert.rejects(operation, /MongoDB/);
  const { default: app } = await import('../src/app.js');
  const server = app.listen(0,'127.0.0.1'); await new Promise(r => server.once('listening',r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await (await fetch(base+'/api/health')).json()).dbConnected, false);
    assert.equal((await fetch(base+'/api/v1/products')).status,503);
    assert.equal((await fetch(base+'/api/v1/auth/login',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:'admin@bansir.com',password:'anything'}) })).status,503);
    const cors = await fetch(base+'/api/v1/notifications',{method:'OPTIONS',headers:{ Origin:'https://bansir-demo.netlify.app','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'x-device-id' }});
    assert.equal(cors.status,204); assert.match(cors.headers.get('access-control-allow-headers'),/X-Device-Id/i);
  } finally { await new Promise(r=>server.close(r)); }
});
