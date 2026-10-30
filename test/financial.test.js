import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculatePricing } from '../src/shared/pricing-calculator.js';
test('pricing: formula parity, correct contribution and term fee, invalid inputs', async () => {
  const serverSource = await readFile(new URL('../src/shared/pricing-calculator.js', import.meta.url), 'utf8');
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


