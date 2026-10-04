import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTerminalOrder } from '../src/modules/terminal/terminal.service.js';
import { protectTerminal } from '../src/modules/terminal/terminal.auth.js';

test('terminal order groups items and keeps any number of partial payments auditable', () => {
  const sales = [
    { _id: 'sale-1', orderNumber: 'PED-1', productName: 'P13', quantity: 1, unitPrice: 100, subtotal: 100, totalAmount: 100, deliveryFee: 0, customerName: 'Ana', date: new Date('2026-10-04T10:00:00Z') },
    { _id: 'sale-2', orderNumber: 'PED-1', productName: 'Água', quantity: 2, unitPrice: 10, subtotal: 20, totalAmount: 20, deliveryFee: 0, customerName: 'Ana', date: new Date('2026-10-04T10:00:00Z') }
  ];
  const payments = [
    { paymentId: 'p1', amountCents: 2000, method: 'dinheiro', operatorName: 'João' },
    { paymentId: 'p2', amountCents: 3000, method: 'pix', operatorName: 'João' },
    { paymentId: 'p3', amountCents: 1000, method: 'vale', operatorName: 'João' },
    { paymentId: 'p4', amountCents: 2000, method: 'cartao_debito', operatorName: 'João' },
    { paymentId: 'p5', amountCents: 3000, method: 'cartao_credito', operatorName: 'João' }
  ];
  const adjustments = [{ adjustmentId: 'a1', amountCents: 1000, reason: 'Acordo autorizado' }];

  const order = buildTerminalOrder(sales, payments, adjustments);
  assert.equal(order.originalTotalCents, 12000);
  assert.equal(order.adjustmentCents, 1000);
  assert.equal(order.paidCents, 11000);
  assert.equal(order.balanceCents, 0);
  assert.equal(order.status, 'paid');
  assert.equal(order.items.length, 2);
  assert.equal(order.payments.length, 5);
});

test('terminal authentication restores UTF-8 operator names from ASCII-safe headers', () => {
  const previous = process.env.TERMINAL_API_TOKEN;
  process.env.TERMINAL_API_TOKEN = 'a'.repeat(64);
  try {
    const req = { headers: {
      authorization: `Bearer ${'a'.repeat(64)}`,
      'x-terminal-id': 'terminal-1',
      'x-operator-id': 'operator-1',
      'x-operator-name': 'Jo%C3%A3o%20da%20Silva'
    } };
    let nextCalled = false;
    protectTerminal(req, { status: () => ({ json: value => value }) }, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.terminalAudit.operatorName, 'João da Silva');
  } finally {
    if (previous === undefined) delete process.env.TERMINAL_API_TOKEN;
    else process.env.TERMINAL_API_TOKEN = previous;
  }
});
