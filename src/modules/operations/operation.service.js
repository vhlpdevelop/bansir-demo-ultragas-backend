import { randomUUID } from 'node:crypto';
import { Product } from '../products/product.model.js';
import { Operation, FiscalSequence, present } from './operation.model.js';
import { checkoutInput, fingerprint, fail, integrationMode } from './operation.policy.js';
import { cieloReady } from './cielo.adapter.js';
import { fiscalReady, fiscalIdentity, draftFor, preparePayload } from './fiscal.adapter.js';
import { executeOperation } from './operation.engine.js';

export const isAdmin = user => ['admin', 'superadmin'].includes(user.role);
export const scope = user => isAdmin(user) ? {} : { ownerId: String(user._id) };
export function readiness() {
  return { mode: integrationMode(), testOnly: true, productionEnabled: false,
    payment: { provider: 'Cielo Smart • Sandbox', missing: cieloReady() },
    fiscal: { provider: 'NFeWizard • SEFAZ MS homologação', missing: fiscalReady() },
    message: 'Ambiente de testes. Não movimenta estoque, vendas nem financeiro reais.' };
}
export async function createOperation(user, input) {
  const normalized = checkoutInput(input); const mode = integrationMode();
  const scenario = input.scenario || 'success';
  if (!['success', 'declined', 'payment_timeout', 'fiscal_rejected', 'fiscal_timeout'].includes(scenario)) fail('Cenário inválido.');
  if (mode !== 'demo' && scenario !== 'success') fail('Cenários artificiais disponíveis somente em demonstração.');
  const hash = fingerprint({ ...normalized, scenario, mode });
  const identity = { ownerId: String(user._id), requestId: input.requestId };
  const existing = await Operation.findOne(identity);
  if (existing) { if (existing.fingerprint !== hash) fail('Identificador já utilizado com outros dados.', 409); return present(existing); }
  if (mode === 'homologation' && cieloReady().length) fail('Configure Cielo Sandbox antes de criar o teste.', 503);
  const products = await Product.find({ _id: { $in: normalized.items.map(i => i.productId) }, active: true }).lean();
  const items = normalized.items.map(i => {
    const product = products.find(p => String(p._id) === i.productId);
    if (!product) fail('Produto indisponível. Atualize o catálogo.');
    const unitCents = Math.round(product.price * 100);
    if (!Number.isSafeInteger(unitCents) || unitCents < 1) fail('Preço inválido no catálogo.');
    return { ...i, name: product.name, unitCents };
  });
  const totalCents = items.reduce((sum, i) => sum + i.unitCents * i.quantity, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents > 100000000) fail('Valor de teste acima do limite.');
  try {
    return present(await Operation.create({ _id: randomUUID(), ...identity, fingerprint: hash, mode, ...normalized, items, totalCents, scenario,
      job: 'start', message: 'Teste na fila de processamento.', events: [{ at: new Date(), message: 'Operação de teste criada. Estoque e financeiro preservados.' }] }));
  } catch (error) {
    if (error.code !== 11000) throw error;
    const repeated = await Operation.findOne(identity);
    if (!repeated || repeated.fingerprint !== hash) fail('Identificador em conflito.', 409);
    return present(repeated);
  }
}
export async function getOperation(user, id, internal = false) {
  const query = Operation.findOne({ _id: id, ...scope(user) });
  if (internal) query.select('+fiscalPayload +fiscalData +xml');
  const op = await query;
  if (!op) fail('Operação não encontrada.', 404);
  return op;
}
export async function queueAction(user, id, action) {
  const op = await getOperation(user, id, true);
  if (op.busy || op.job) fail('Operação em processamento. Aguarde a atualização.', 409);
  const permitted = {
    reconcile: ['pending', 'unknown', 'partial', 'review', 'paid'].includes(op.paymentStatus),
    'sandbox-pay': op.mode === 'homologation' && op.providerOrderId && op.paymentStatus === 'pending' && isAdmin(user),
    'retry-fiscal': op.paymentStatus === 'paid' && op.fiscalStatus === 'rejected' && (op.mode === 'demo' || op.fiscalPayload),
    emit: op.paymentStatus === 'paid' && op.fiscalStatus === 'ready',
    'consult-fiscal': op.paymentStatus === 'paid' && ['unknown', 'authorized', 'rejected'].includes(op.fiscalStatus)
  };
  if (!permitted[action]) fail('Ação indisponível para o estado atual.', 409);
  const updated = await Operation.findOneAndUpdate({ _id: id, busy: false, job: null, updatedAt: op.updatedAt }, { $set: { job: action } }, { new: true });
  if (!updated) fail('Operação mudou; atualize o painel.', 409);
  return present(updated);
}
export async function getDraft(user, id) {
  if (!isAdmin(user)) fail('Apenas administradores podem preparar a tributação.', 403);
  const op = await getOperation(user, id, true);
  return op.fiscalPayload?.NFe?.infNFe || draftFor(op);
}
export async function saveDraft(user, id, draft) {
  if (!isAdmin(user)) fail('Apenas administradores podem preparar a tributação.', 403);
  const op = await getOperation(user, id, true);
  if (op.mode !== 'homologation' || op.paymentStatus !== 'paid' || !['needs_data', 'ready', 'rejected'].includes(op.fiscalStatus) || op.busy || op.job) fail('Rascunho indisponível; consulte operações incertas antes de editar.', 409);
  if (fiscalReady(op.model).length) fail('Complete a configuração fiscal no Render.', 503);
  // Reserve a unique number atomically; gaps are retained, never recycled after a crash.
  if (!op.fiscalKey) {
    const counter = await FiscalSequence.findByIdAndUpdate(`homologation:${process.env.FISCAL_CNPJ}:${op.model}:${process.env.FISCAL_SERIES || 1}`, { $inc: { value: 1 } }, { upsert: true, new: true });
    Object.assign(op, fiscalIdentity(op, counter.value));
  }
  const payload = preparePayload(op, draft);
  const updated = await Operation.findOneAndUpdate({ _id: id, busy: false, job: null, updatedAt: op.updatedAt }, { $set: {
    fiscalNumber: op.fiscalNumber, fiscalSeries: op.fiscalSeries, fiscalIssuedAt: op.fiscalIssuedAt, fiscalCode: op.fiscalCode,
    fiscalKey: op.fiscalKey, fiscalPayload: payload, fiscalStatus: 'ready', message: 'Rascunho salvo. Pronto para emissão de homologação.'
  }, $push: { events: { at: new Date(), message: `Rascunho fiscal preparado por ${user.name || 'administrador'}.` } } }, { new: true });
  if (!updated) fail('Operação mudou durante a edição. Reabra o rascunho.', 409);
  return present(updated);
}
export async function tickOperations() {
  const now = new Date();
  // Leases protect against multiple Render instances. An interrupted submission is never resent automatically.
  await Operation.updateMany({ busy: true, leaseUntil: { $lt: now } }, [{ $set: {
    busy: false, job: null, lockToken: null,
    paymentStatus: { $cond: [{ $eq: ['$paymentStatus', 'submitting'] }, 'unknown', '$paymentStatus'] },
    fiscalStatus: { $cond: [{ $eq: ['$fiscalStatus', 'submitting'] }, 'unknown', '$fiscalStatus'] },
    message: 'Processamento interrompido. Consulte pagamento e nota antes de repetir.'
  } }]);
  await Operation.updateMany({ busy: false, job: null, mode: 'homologation', paymentStatus: { $in: ['pending', 'unknown', 'partial'] }, nextPollAt: { $lte: now }, polls: { $lt: 20 } }, { $set: { job: 'reconcile', nextPollAt: new Date(Date.now() + 60000) }, $inc: { polls: 1 } });
  const token = randomUUID();
  const op = await Operation.findOneAndUpdate({ busy: false, job: { $type: 'string' } }, { $set: { busy: true, lockToken: token, leaseUntil: new Date(Date.now() + 180000) } }, { new: true, sort: { updatedAt: 1 } }).select('+fiscalPayload +fiscalData +xml').lean();
  if (!op) return;
  const checkpoint = async current => {
    const { _id, __v, createdAt, updatedAt, ...fields } = current;
    const result = await Operation.updateOne({ _id, lockToken: token, busy: true }, { $set: fields });
    if (!result.matchedCount) throw new Error('Lease lost');
  };
  try { await executeOperation(op, checkpoint); }
  catch {
    await Operation.updateOne({ _id: op._id, lockToken: token }, [{ $set: {
      message: 'Falha no processamento. Consulte a operação antes de repetir.',
      paymentStatus: { $cond: [{ $eq: ['$paymentStatus', 'submitting'] }, 'unknown', '$paymentStatus'] },
      fiscalStatus: { $cond: [{ $eq: ['$fiscalStatus', 'submitting'] }, 'unknown', '$fiscalStatus'] }
    } }]);
  } finally {
    await Operation.updateOne({ _id: op._id, lockToken: token }, { $set: { busy: false, job: null, lockToken: null }, $unset: { leaseUntil: 1 } });
  }
}
export async function startOperationsWorker() {
  integrationMode();
  await Promise.all([Operation.init(), FiscalSequence.init()]);
  let stopped = false;
  async function loop() {
    if (stopped) return;
    try { await tickOperations(); } catch { console.error('[operations] Worker indisponível; tarefas permanecem no MongoDB.'); }
    if (!stopped) { const timer = setTimeout(loop, 2000); timer.unref(); }
  }
  void loop();
  return () => { stopped = true; };
}
