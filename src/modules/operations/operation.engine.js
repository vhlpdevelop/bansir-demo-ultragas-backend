import * as cielo from './cielo.adapter.js';
import { runWizard } from './fiscal.adapter.js';
import { fiscalResult, paymentEvidence } from './operation.policy.js';

const defaultAdapters = { ...cielo, runWizard };
export async function executeOperation(op, checkpoint, adapters = defaultAdapters) {
  const job = op.job;
  async function update(values, message) {
    Object.assign(op, values);
    if (message) { op.message = message; op.events = [...(op.events || []), { at: new Date(), message }].slice(-100); }
    await checkpoint(op);
  }
  async function fiscal() {
    if (op.paymentStatus !== 'paid') return;
    if (['authorized', 'unknown', 'cancelled', 'denied'].includes(op.fiscalStatus)) return;
    if (op.fiscalStatus === 'rejected' && job !== 'retry-fiscal') return;
    if (op.fiscalStatus === 'ready' && !['emit', 'retry-fiscal'].includes(job)) return;
    if (op.mode === 'demo') {
      const failure = op.scenario === 'fiscal_rejected' && job !== 'retry-fiscal';
      const timeout = op.scenario === 'fiscal_timeout' && job !== 'retry-fiscal';
      await update({ fiscalStatus: failure ? 'rejected' : timeout ? 'unknown' : 'authorized' }, failure ? 'Pagamento simulado confirmado; rejeição fiscal simulada. Corrija e tente somente a nota.' : timeout ? 'Pagamento simulado confirmado; retorno fiscal incerto. Consulte a nota.' : 'Teste concluído: pagamento e nota simulados. Sem valor fiscal.');
      return;
    }
    if (!op.fiscalPayload) { await update({ fiscalStatus: 'needs_data' }, 'Pagamento de teste confirmado. Preencha os dados fiscais para emitir em homologação.'); return; }
    await update({ fiscalStatus: 'submitting' }, 'Enviando nota à SEFAZ de homologação.');
    try {
      const { result, xml } = await adapters.runWizard('emit', op);
      const parsed = fiscalResult(result, op.fiscalKey);
      await update({ fiscalStatus: parsed.status, sefazCode: parsed.code, protocol: parsed.protocol,
        ...(parsed.data ? { fiscalData: parsed.data } : {}), ...(xml ? { xml, xmlAvailable: true } : {}) }, parsed.reason);
    } catch (error) {
      await update({ fiscalStatus: error.notSubmitted ? 'rejected' : 'unknown' }, error.notSubmitted
        ? 'Pagamento confirmado. Não houve envio fiscal: revise certificado e configuração NFeWizard antes de tentar somente a nota.'
        : `${error.rejection ? error.rejection + '. ' : ''}Pagamento confirmado; emissão sem resposta conclusiva. Consulte a chave antes de reenviar.`);
    }
  }
  if (job === 'start') {
    await update({ paymentStatus: 'submitting' }, op.mode === 'demo' ? 'Iniciando simulação.' : 'Criando pedido Cielo Sandbox.');
    if (op.mode === 'demo') {
      if (op.scenario === 'declined') { await update({ paymentStatus: 'declined' }, 'Pagamento recusado na simulação. Nenhuma nota gerada.'); return; }
      if (op.scenario === 'payment_timeout') { await update({ paymentStatus: 'unknown' }, 'Pagamento simulado sem resposta. Consulte antes de repetir.'); return; }
      await update({ paymentStatus: 'paid', paymentEvidence: { simulated: true, payments: [{ installments: op.installments }] } }, 'Pagamento simulado confirmado.');
      await fiscal(); return;
    }
    try {
      const order = await adapters.createOrder(op);
      if (!order?.id || order.reference !== op._id || Number(order.price) !== op.totalCents) throw new Error('Invalid order');
      await update({ providerOrderId: String(order.id), paymentStatus: 'pending', nextPollAt: new Date(Date.now() + 30000) }, 'Pedido criado no Sandbox. Aguardando confirmação Cielo.');
    } catch {
      await update({ paymentStatus: 'unknown', nextPollAt: new Date(Date.now() + 30000) }, 'Criação do pedido sem confirmação. Consulte pela referência; não crie outra cobrança.');
    }
    return;
  }
  if (job === 'sandbox-pay') {
    await update({ paymentStatus: 'unknown' }, 'Solicitando transação de teste no Sandbox; aguardando consulta de confirmação.');
    // Even a successful POST is not evidence of payment; always GET the order and its transactions.
    try { await adapters.sandboxPayment(op); } catch { /* reconciliation below */ }
  }
  if (['reconcile', 'sandbox-pay'].includes(job)) {
    if (op.mode === 'demo') {
      await update({ paymentStatus: 'paid', paymentEvidence: { simulated: true, payments: [{ installments: op.installments }] } }, 'Consulta simulada confirmou o pagamento.');
    } else {
      try {
        const order = await adapters.findOrder(op);
        const transactions = await adapters.getTransactions(order.id);
        const evidence = paymentEvidence(order, transactions, { ...op, id: op._id, providerOrderId: op.providerOrderId || String(order.id) });
        await update({ providerOrderId: String(order.id), paymentStatus: evidence.status, paymentEvidence: evidence }, evidence.status === 'paid' ? 'Cielo Sandbox confirmou valor, modalidade e parcelas.' : evidence.status === 'review' ? 'Valor pago, mas modalidade ou parcelas divergem ou não foram informadas. Confira na Cielo; emissão bloqueada.' : 'Pagamento ainda não confirmado integralmente.');
      } catch {
        await update({}, 'Não foi possível conciliar com a Cielo. O estado anterior foi preservado; não repita a cobrança.');
        return;
      }
    }
    await fiscal(); return;
  }
  if (job === 'emit' || job === 'retry-fiscal') { await fiscal(); return; }
  if (job === 'consult-fiscal') {
    if (op.mode === 'demo') { await update({ fiscalStatus: 'authorized' }, 'Consulta simulada confirmou a nota. Sem valor fiscal.'); return; }
    try {
      const { result } = await adapters.runWizard('consult', op);
      const parsed = fiscalResult(result, op.fiscalKey);
      await update({ fiscalStatus: parsed.status, sefazCode: parsed.code, protocol: parsed.protocol }, parsed.reason);
    } catch { await update({}, 'Consulta fiscal indisponível. Estado preservado; não reenvie a nota.'); }
  }
}
