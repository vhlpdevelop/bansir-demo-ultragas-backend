import { createHash } from 'node:crypto';

export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
export function integrationMode(env = process.env) {
  const mode = env.INTEGRATION_MODE || 'demo';
  // Production is deliberately unavailable until merchant-specific homologation is complete.
  if (!['demo', 'homologation'].includes(mode)) fail('Modo inválido. Use demo ou homologation; produção ainda não liberada.', 503);
  return mode;
}
export function checkoutInput(input) {
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId || '')) fail('Identificador de operação inválido.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 30) fail('Informe de 1 a 30 produtos.');
  const items = input.items.map(i => {
    if (!/^[a-f0-9]{24}$/i.test(i.productId || '') || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 999) fail('Produto ou quantidade inválidos.');
    return { productId: i.productId, quantity: i.quantity };
  }).sort((a, b) => a.productId.localeCompare(b.productId));
  if (new Set(items.map(i => i.productId)).size !== items.length) fail('Agrupe as quantidades de produtos repetidos.');
  if (!['credit', 'debit'].includes(input.method)) fail('Escolha crédito ou débito.');
  const installments = Number(input.installments || 1);
  if (!Number.isInteger(installments) || installments < 1 || installments > 12 || (input.method === 'debit' && installments !== 1)) fail('Parcelamento inválido.');
  const model = String(input.model || '65');
  if (!['55', '65'].includes(model)) fail('Modelo fiscal inválido.');
  return { items, method: input.method, installments, model };
}
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function paymentEvidence(order, transactions, op) {
  if (String(order.id) !== op.providerOrderId || order.reference !== op.id || Number(order.price) !== op.totalCents) fail('Pedido Cielo não corresponde à operação.', 409);
  if (!Array.isArray(transactions)) fail('Resposta Cielo sem transações verificáveis.', 502);
  let net = 0;
  const seen = new Set(); const payments = [];
  for (const t of transactions) {
    if (t.status !== 'CONFIRMED') continue;
    if (!t.id || seen.has(t.id)) fail('Transação Cielo duplicada ou sem identificador.', 502);
    seen.add(t.id);
    const amount = Number(t.amount);
    if (!Number.isSafeInteger(amount) || amount < 0) fail('Valor Cielo inválido.', 502);
    if (t.transaction_type === 'CANCELLATION') net -= amount;
    else if (t.transaction_type === 'PAYMENT') {
      net += amount;
      const fields = t.payment_fields || {};
      const quotas = fields.number_of_quotas ?? fields.numberOfQuotas;
      payments.push({ id: String(t.id), amount, nsu: String(t.number || ''), authorization: String(t.authorization_code || ''),
        installments: quotas == null ? null : Math.max(1, Number(quotas)),
        method: fields.primary_product_name ?? fields.primaryProductName ?? null });
    } else fail('Tipo de transação Cielo desconhecido.', 502);
  }
  if (net < 0 || net > op.totalCents) fail('Pagamento divergente; requer conciliação.', 409);
  const paid = net === op.totalCents;
  const mismatch = payments.some(t => t.installments !== op.installments || t.method !== (op.method === 'credit' ? 'CREDITO' : 'DEBITO'));
  return { status: paid ? (mismatch ? 'review' : 'paid') : (net > 0 ? 'partial' : 'pending'), net, payments };
}

export function fiscalResult(result, key) {
  // Library success=true means that the request completed, not fiscal authorization.
  const body = result?.xmls?.[0] || (Array.isArray(result?.response) ? result.response[0] : result?.response || result);
  const protocol = body?.protNFe?.infProt;
  const code = String(protocol?.cStat ?? body?.cStat ?? '');
  if (['101', '151', '155'].includes(code)) return { status: 'cancelled', code, reason: 'Nota cancelada na SEFAZ. Não reenviar.' };
  if (['110', '301', '302'].includes(code)) return { status: 'denied', code, reason: 'Uso denegado pela SEFAZ. Numeração não pode ser reutilizada.' };
  if (['100', '150'].includes(code)) {
    if (!protocol?.nProt || String(protocol.chNFe) !== key || Number(protocol.tpAmb) !== 2) fail('Protocolo fiscal não corresponde à nota de homologação.', 502);
    return { status: 'authorized', code, protocol: String(protocol.nProt), reason: String(protocol.xMotivo || 'Autorizada em homologação'), data: body };
  }
  const uncertain = !code || ['103', '104', '105', '106', '108', '109', '204', '217', '539', '656'].includes(code);
  return { status: uncertain ? 'unknown' : 'rejected', code, reason: String(protocol?.xMotivo || body?.xMotivo || 'Retorno inconclusivo; consulte a chave antes de reenviar.').slice(0, 400) };
}

export function accessKey({ cnpj, model, series, number, code, issuedAt }) {
  const date = issuedAt.slice(2, 7).replace('-', '');
  const base = `50${date}${cnpj}${model}${String(series).padStart(3, '0')}${String(number).padStart(9, '0')}1${code}`;
  if (!/^\d{43}$/.test(base)) fail('Dados inválidos para a chave fiscal.');
  let sum = 0; let weight = 2;
  for (let i = base.length - 1; i >= 0; i--) { sum += Number(base[i]) * weight; weight = weight === 9 ? 2 : weight + 1; }
  const remainder = sum % 11;
  return base + (remainder < 2 ? 0 : 11 - remainder);
}
