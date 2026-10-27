import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptPaymentValues } from '../src/modules/sales/receipt-values.js';
import { createSaleSchema } from '../src/modules/sales/sale.validator.js';
import { buildSaleReceivables } from '../src/modules/financial/financial.service.js';
test('paid cash receipt records tender, change and zero balance', () => {
  assert.deepEqual(receiptPaymentValues({ paymentMethod: 'dinheiro', receivedAmount: 20 }, 14, true), { receivedAmount: 20, changeAmount: 6, outstandingAmount: 0, changeFor: 0, plannedChangeAmount: 0 });
  assert.equal(receiptPaymentValues({ paymentMethod: 'pix' }, 14, true).receivedAmount, 14);
});
test('delivery cash to collect never counts the planned tender as received', () => {
  assert.deepEqual(receiptPaymentValues({ paymentMethod: 'dinheiro', changeFor: 20 }, 14, false), { receivedAmount: 0, changeAmount: 0, outstandingAmount: 14, changeFor: 20, plannedChangeAmount: 6 });
  const entries = buildSaleReceivables({ _id: '1', totalAmount: 14, date: new Date(), paymentMethod: 'dinheiro', isPaid: false, paymentStatus: 'pagar_na_entrega' });
  assert.equal(entries[0].status, 'pending'); assert.equal(entries[0].amount, 14);
});
test('reject underpayment, noncash change, inconsistent delivery tender and invalid input', () => {
  assert.throws(() => receiptPaymentValues({ receivedAmount: 13, paymentMethod: 'dinheiro' }, 14, true), /cobrir/);
  assert.throws(() => receiptPaymentValues({ receivedAmount: 20, paymentMethod: 'pix' }, 14, true), /Troco/);
  assert.throws(() => receiptPaymentValues({ changeFor: 10, paymentMethod: 'dinheiro' }, 14, false), /Troco/);
  assert.throws(() => receiptPaymentValues({ receivedAmount: 20, paymentMethod: 'dinheiro' }, 14, false), /parcial/);
  assert.throws(() => receiptPaymentValues({ receivedAmount: NaN }, 14, true), /inválidos/);
  const data = { productName: 'Gás', unitPrice: 14, customerAddress: ' Rua ', customerNeighborhood: 'Centro', customerNotes: 'Ligar', customerPhone: '123' };
  assert.equal(createSaleSchema.parse(data).customerAddress, 'Rua');
  assert.equal(createSaleSchema.safeParse({ ...data, customerNotes: 'x'.repeat(1001) }).success, false);
});
