import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutInput, integrationMode, paymentEvidence, fiscalResult, accessKey } from '../src/modules/operations/operation.policy.js';
import { executeOperation } from '../src/modules/operations/operation.engine.js';
import { preparePayload, draftFor } from '../src/modules/operations/fiscal.adapter.js';

const productId = '123456789012345678901234';
const input = { requestId: 'test-request-123456', items: [{ productId, quantity: 2 }], method: 'credit', installments: 3, model: '65' };
const key = accessKey({ cnpj: '12345678000195', model: '65', series: 1, number: 1, code: '12345678', issuedAt: '2026-09-28T12:00:00-04:00' });
const base = () => ({ _id: 'order-123', mode: 'demo', totalCents: 1000, method: 'credit', installments: 3, model: '65', paymentStatus: 'created', fiscalStatus: 'waiting', events: [], job: 'start', scenario: 'success' });
const save = async () => {};

test('production blocked, checkout quantities and installments validated', () => {
  assert.equal(integrationMode({}), 'demo');
  assert.throws(() => integrationMode({ INTEGRATION_MODE: 'production' }));
  assert.deepEqual(checkoutInput(input).items, input.items);
  assert.throws(() => checkoutInput({ ...input, items: [{ productId, quantity: 0.5 }] }));
  assert.throws(() => checkoutInput({ ...input, items: [...input.items, ...input.items] }));
  assert.throws(() => checkoutInput({ ...input, method: 'debit' }));
});
test('payment evidence checks amount, reference, duplicates, cancellation and actual installments', () => {
  const op = { id: 'order-123', providerOrderId: 'cielo-1', totalCents: 1000, installments: 3, method: 'credit' };
  const order = { id: 'cielo-1', reference: op.id, price: 1000, status: 'PAID' };
  const tx = { id: 'tx', status: 'CONFIRMED', amount: '1000', transaction_type: 'PAYMENT', payment_fields: { primary_product_name: 'CREDITO', number_of_quotas: 3 } };
  assert.equal(paymentEvidence(order, [], op).status, 'pending', 'PAID alone is insufficient');
  assert.equal(paymentEvidence(order, [tx], op).status, 'paid');
  assert.equal(paymentEvidence(order, [{ ...tx, payment_fields: {} }], op).status, 'review');
  assert.equal(paymentEvidence(order, [{ ...tx, amount: 500 }], op).status, 'partial');
  assert.equal(paymentEvidence(order, [tx, { ...tx, id: 'cancel', transaction_type: 'CANCELLATION' }], op).status, 'pending');
  assert.throws(() => paymentEvidence({ ...order, reference: 'other' }, [tx], op));
  assert.throws(() => paymentEvidence(order, [tx, tx], op));
  assert.throws(() => paymentEvidence(order, [{ ...tx, amount: 1001 }], op));
});
test('NFeWizard success is not authorization; protocol/environment/key must match', () => {
  assert.equal(key.length, 44);
  assert.equal(fiscalResult({ success: true }, key).status, 'unknown');
  const infProt = { cStat: 100, tpAmb: 2, nProt: 'protocol', chNFe: key };
  assert.equal(fiscalResult({ xmls: [{ protNFe: { infProt } }] }, key).status, 'authorized');
  assert.throws(() => fiscalResult({ protNFe: { infProt: { ...infProt, tpAmb: 1 } } }, key));
  assert.throws(() => fiscalResult({ protNFe: { infProt: { ...infProt, chNFe: 'other' } } }, key));
  assert.equal(fiscalResult({ cStat: 204 }, key).status, 'unknown');
  assert.equal(fiscalResult({ cStat: 217 }, key).status, 'unknown');
  assert.equal(fiscalResult({ cStat: 539 }, key).status, 'unknown');
  assert.equal(fiscalResult({ cStat: 101 }, key).status, 'cancelled');
  assert.equal(fiscalResult({ cStat: 301 }, key).status, 'denied');
});
test('declined payment never generates an invoice', async () => {
  const op = { ...base(), scenario: 'declined' };
  await executeOperation(op, save);
  assert.equal(op.paymentStatus, 'declined'); assert.equal(op.fiscalStatus, 'waiting');
});
test('fiscal retry never creates another payment; reconcile never resends rejected invoices', async () => {
  const op = { ...base(), scenario: 'fiscal_rejected' };
  await executeOperation(op, save);
  assert.equal(op.paymentStatus, 'paid'); assert.equal(op.fiscalStatus, 'rejected');
  op.job = 'reconcile'; await executeOperation(op, save);
  assert.equal(op.fiscalStatus, 'rejected');
  op.job = 'retry-fiscal'; await executeOperation(op, save);
  assert.equal(op.fiscalStatus, 'authorized');
  assert.equal(op.events.filter(e => e.message === 'Iniciando simulação.').length, 1);
});
test('timeouts reconcile without resubmitting charge or invoice', async () => {
  const op = { ...base(), scenario: 'payment_timeout' };
  await executeOperation(op, save);
  assert.equal(op.paymentStatus, 'unknown'); assert.equal(op.fiscalStatus, 'waiting');
  op.job = 'reconcile'; await executeOperation(op, save); assert.equal(op.fiscalStatus, 'authorized');
  const fiscal = { ...base(), scenario: 'fiscal_timeout' };
  await executeOperation(fiscal, save); assert.equal(fiscal.fiscalStatus, 'unknown');
  fiscal.job = 'retry-fiscal'; await executeOperation(fiscal, save); assert.equal(fiscal.fiscalStatus, 'unknown');
  fiscal.job = 'consult-fiscal'; await executeOperation(fiscal, save); assert.equal(fiscal.fiscalStatus, 'authorized');
});
test('sandbox validates payment before invoking fiscal and preserves paid on SEFAZ timeout', async () => {
  const op = { ...base(), mode: 'homologation', job: 'reconcile', providerOrderId: 'cielo-1', fiscalKey: key, fiscalPayload: {}, fiscalStatus: 'waiting' };
  let calls = 0; const checkpoints = [];
  const adapters = {
    findOrder: async () => ({ id: 'cielo-1', reference: op._id, price: 1000 }),
    getTransactions: async () => [{ id: 'tx', amount: 1000, status: 'CONFIRMED', transaction_type: 'PAYMENT', payment_fields: { primary_product_name: 'CREDITO', number_of_quotas: 3 } }],
    runWizard: async () => { calls++; throw new Error('timeout'); }
  };
  await executeOperation(op, async current => checkpoints.push(structuredClone(current)), adapters);
  assert.equal(op.paymentStatus, 'paid'); assert.equal(op.fiscalStatus, 'unknown'); assert.equal(calls, 1);
  assert.ok(checkpoints.some(o => o.fiscalStatus === 'submitting'), 'intent persisted before emission');
  await executeOperation(op, save, adapters); assert.equal(calls, 1, 'reconciliation cannot re-emit uncertain invoice');
});
test('fiscal draft preserves paid totals and forces the stored identity and homologation', () => {
  const oldCnpj = process.env.FISCAL_CNPJ; process.env.FISCAL_CNPJ = '12345678000195';
  try {
    const op = { ...base(), items: [{ productId, name: 'Produto teste', unitCents: 1000, quantity: 1 }], fiscalKey: key, fiscalNumber: 1, fiscalSeries: 1, fiscalCode: '12345678', fiscalIssuedAt: '2026-09-28T12:00:00-04:00' };
    const draft = draftFor(op);
    assert.throws(() => preparePayload(op, draft));
    draft.emit.xNome = 'Emitente de teste'; draft.emit.IE = '123456789';
    draft.det[0].prod.NCM = '69139000'; draft.det[0].prod.CFOP = '5102';
    draft.det[0].imposto = { ICMS: { ICMSSN102: { orig: '0', CSOSN: '102' } }, PIS: { PISNT: { CST: '08' } }, COFINS: { COFINSNT: { CST: '08' } } };
    draft.ide = { tpAmb: 1, nNF: 99 }; draft.pag = { detPag: [{ vPag: 0.01 }] };
    const payload = preparePayload(op, draft);
    assert.equal(payload.NFe.infNFe.ide.tpAmb, 2); assert.equal(payload.NFe.infNFe.ide.nNF, 1);
    assert.equal(payload.NFe.infNFe.Id, key); assert.equal(payload.NFe.infNFe.pag.detPag[0].vPag, 10);
    draft.total.ICMSTot.vNF = 0.01;
    assert.throws(() => preparePayload(op, draft));
  } finally { if (oldCnpj === undefined) delete process.env.FISCAL_CNPJ; else process.env.FISCAL_CNPJ = oldCnpj; }
});
