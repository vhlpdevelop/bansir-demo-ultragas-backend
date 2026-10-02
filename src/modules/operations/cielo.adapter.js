import { fail } from './operation.policy.js';
const BASE = 'https://api.cielo.com.br/sandbox-lio/order-management/v1';
export function cieloReady(env = process.env) {
  return ['CIELO_CLIENT_ID', 'CIELO_ACCESS_TOKEN', 'CIELO_MERCHANT_ID'].filter(k => !env[k]);
}
export async function cieloRequest(path, { method = 'GET', body } = {}, fetcher = fetch) {
  if (cieloReady().length) fail('Configure as credenciais Cielo Sandbox no Render.', 503);
  const response = await fetcher(`${BASE}${path}`, { method, signal: AbortSignal.timeout(25000), headers: {
    'Content-Type': 'application/json', Accept: 'application/json',
    'client-id': process.env.CIELO_CLIENT_ID, 'access-token': process.env.CIELO_ACCESS_TOKEN, 'merchant-id': process.env.CIELO_MERCHANT_ID
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  if (!response.ok) fail(`Cielo respondeu HTTP ${response.status}. Consulte a operação antes de tentar novamente.`, 502);
  try { return JSON.parse(text); } catch { fail('Cielo retornou resposta vazia ou inválida. Consulte a operação.', 502); }
}
export async function createOrder(op) {
  return cieloRequest('/orders', { method: 'POST', body: { number: op._id, reference: op._id, status: 'ENTERED',
    price: String(op.totalCents), remaining: String(op.totalCents), installments: String(op.installments === 1 ? 0 : op.installments),
    items: op.items.map(i => ({ sku: i.productId, name: i.name, description: i.name, unit_price: i.unitCents, quantity: i.quantity, unit_of_measure: 'EACH' })), transactions: [] } });
}
export async function findOrder(op) {
  if (op.providerOrderId) return cieloRequest(`/orders/${encodeURIComponent(op.providerOrderId)}`);
  const found = await cieloRequest(`/orders?reference=${encodeURIComponent(op._id)}&page=0&page_size=100`);
  const items = Array.isArray(found) ? found : found.content || found.orders;
  if (!Array.isArray(items)) fail('Não foi possível localizar o pedido pela referência.', 502);
  const matches = items.filter(i => i.reference === op._id);
  if (matches.length !== 1) fail('Pedido ainda não localizado ou referência duplicada. Não faça nova cobrança; confira no portal Cielo.', 409);
  return matches[0];
}
export async function getTransactions(id) {
  const data = await cieloRequest(`/orders/${encodeURIComponent(id)}/transactions`);
  return Array.isArray(data) ? data : data.transactions;
}
export async function sandboxPayment(op) {
  // Deterministic id: if the request times out, reconciliation finds the same transaction.
  return cieloRequest(`/orders/${encodeURIComponent(op.providerOrderId)}/transactions`, { method: 'POST', body: {
    id: op._id, external_id: op._id, status: 'CONFIRMED', terminal_number: '12345678', authorization_code: '008619', number: '672836',
    amount: String(op.totalCents), transaction_type: 'PAYMENT',
    payment_fields: { primary_product_name: op.method === 'credit' ? 'CREDITO' : 'DEBITO', secondary_product_name: op.installments > 1 ? 'PARCELADO LOJA' : 'A VISTA', number_of_quotas: op.installments === 1 ? 0 : op.installments }
  } });
}
