import { Transaction, TRANSACTION_TYPES, TRANSACTION_CATEGORIES } from './transaction.model.js';
import { requireDatabase } from '../../config/db.js';

const statuses = ['completed', 'pending', 'cancelled'];
const methods = ['pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'transferencia', 'boleto', 'vale', 'outro', 'pagar_na_entrega', 'pix_entrega', 'maquininha_cartao'];
const cents = value => Math.round(Number(value) * 100);
const money = value => value / 100;
function dateValue(value, label) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} inválida.`);
  return date;
}
export function normalizeTransaction(data) {
  if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('Título obrigatório.');
  if ((typeof data.amount !== 'number' && typeof data.amount !== 'string') || !Number.isFinite(Number(data.amount)) || cents(data.amount) <= 0 || !Number.isSafeInteger(cents(data.amount))) throw new Error('Valor deve ser positivo e finito.');
  const type = data.type ?? 'income';
  const category = data.category ?? 'outros';
  const status = data.status ?? 'completed';
  const paymentMethod = data.paymentMethod ?? 'pix';
  if (!Object.values(TRANSACTION_TYPES).includes(type)) throw new Error('Tipo inválido.');
  if (!Object.values(TRANSACTION_CATEGORIES).includes(category)) throw new Error('Categoria inválida.');
  if (!statuses.includes(status)) throw new Error('Status inválido.');
  if (!methods.includes(paymentMethod)) throw new Error('Pagamento inválido.');
  const date = dateValue(data.date ?? Date.now(), 'Data');
  return { title: data.title.trim(), amount: money(cents(data.amount)), type, category, status, paymentMethod,
    sellerName: data.sellerName || data.artisanName || 'Loja Bansir', notes: data.notes || '', date,
    settledAt: status === 'completed' ? dateValue(data.settledAt ?? date, 'Data de liquidação') : null,
    dueDate: data.dueDate ? dateValue(data.dueDate, 'Vencimento') : null,
    saleId: data.saleId || undefined, installment: data.installment || undefined };
}
export async function getAllTransactions(filter = {}) {
  const query = {};
  if (filter.type) { if (!Object.values(TRANSACTION_TYPES).includes(filter.type)) throw new Error('Tipo inválido.'); query.type = filter.type; }
  if (filter.status) { if (!statuses.includes(filter.status)) throw new Error('Status inválido.'); query.status = filter.status; }
  requireDatabase(); return Transaction.find(query).sort({ date: -1 });
}
export async function createTransaction(data, userId) {
  requireDatabase(); return Transaction.create({ ...normalizeTransaction(data), createdBy: userId });
}
export async function updateTransactionStatus(id, status) {
  requireDatabase();
  if (!statuses.includes(status)) throw new Error('Status inválido.');
  const tx = await Transaction.findById(id);
  if (!tx) throw new Error('Transação não encontrada.');
  if (tx.status === 'cancelled' && status !== 'cancelled') throw new Error('Lançamento cancelado não pode ser reaberto.');
  if (tx.status !== status) { tx.status = status; tx.settledAt = status === 'completed' ? new Date() : null; }
  await tx.save(); return tx;
}

export async function getFinancialSummary() {
  const transactions = await getAllTransactions();
  let income = 0, expenses = 0, receivable = 0, payable = 0;
  const categoryCents = {};
  const months = new Map();
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = date.toISOString().slice(0, 7);
    months.set(key, { month: date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }), period: key, receita: 0, despesa: 0 });
  }
  for (const tx of transactions) {
    const value = cents(tx.amount);
    if (tx.status === 'pending') { if (tx.type === 'income') receivable += value; else payable += value; }
    if (tx.status !== 'completed') continue;
    if (tx.type === 'income') income += value; else expenses += value;
    categoryCents[tx.category] = (categoryCents[tx.category] || 0) + value;
    const key = new Date(tx.settledAt || tx.date).toISOString().slice(0, 7);
    const month = months.get(key);
    if (month) month[tx.type === 'income' ? 'receita' : 'despesa'] += value;
  }
  const { indicators, pricingRules } = await import('./pricing-intelligence.service.js').then(m => m.getPricingIntelligenceData()).catch(() => ({ pricingRules: { expectedMonthlyRevenue: 0 } }));
  return { kpis: { totalRevenue: money(income), totalExpenses: money(expenses), netIncome: money(income - expenses),
    profitMargin: income ? Number(((income - expenses) / income * 100).toFixed(1)) : 0,
    totalTransactions: transactions.length, receivable: money(receivable), payable: money(payable),
    expectedMonthlyRevenue: pricingRules?.expectedMonthlyRevenue || 0 },
    monthlyFlow: [...months.values()].map(m => ({ ...m, receita: money(m.receita), despesa: money(m.despesa), lucro: money(m.receita - m.despesa) })),
    categoryTotals: Object.fromEntries(Object.entries(categoryCents).map(([k, v]) => [k, money(v)])), recentTransactions: transactions.slice(0, 8) };
}

export function buildSaleReceivables(sale) {
  const count = Number(sale.installments ?? 1);
  const feeRate = Number(sale.paymentFeeRate ?? 0);
  if (!Number.isInteger(count) || count < 1 || count > 24 || (sale.paymentMethod !== 'cartao_credito' && count !== 1)) throw new Error('Quantidade de parcelas inválida.');
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate >= 100) throw new Error('Taxa de pagamento inválida.');
  const gross = cents(sale.totalAmount);
  const fee = Math.round(gross * feeRate / 100);
  const net = gross - fee;
  if (!Number.isSafeInteger(net) || net < count) throw new Error('Valor líquido insuficiente para as parcelas.');
  const awaitingSettlement = ['cartao_credito', 'cartao_debito', 'boleto'].includes(sale.paymentMethod);
  const pending = awaitingSettlement || sale.isPaid === false || ['pagar_na_entrega', 'pendente'].includes(sale.paymentStatus);
  const baseDate = dateValue(sale.date ?? Date.now(), 'Data da venda');
  if (sale.firstReceiptDate) baseDate.setTime(dateValue(sale.firstReceiptDate, 'Primeiro recebimento').getTime());
  else if (awaitingSettlement) baseDate.setUTCDate(baseDate.getUTCDate() + (sale.paymentMethod === 'cartao_debito' ? 1 : 30));
  return Array.from({ length: count }, (_, i) => {
    // Clamp to the last day of the month, preserving Jan 31 -> Feb 28 -> Mar 31.
    const due = new Date(baseDate);
    due.setUTCDate(1); due.setUTCMonth(due.getUTCMonth() + i);
    const last = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
    due.setUTCDate(Math.min(baseDate.getUTCDate(), last));
    return normalizeTransaction({ title: `Venda ${sale.saleNumber} - ${sale.productName} (${i + 1}/${count})`, type: 'income', category: 'venda_artesanato',
      amount: money(Math.floor(net / count) + (i < net % count ? 1 : 0)), sellerName: sale.sellerName,
      paymentMethod: sale.paymentMethod, status: pending ? 'pending' : 'completed', date: sale.date,
      dueDate: pending ? due : null, saleId: String(sale._id || sale.id), installment: i + 1,
      notes: `Venda bruta R$ ${money(gross).toFixed(2)}; taxa total R$ ${money(fee).toFixed(2)}. Lançamento pelo valor líquido.` });
  });
}
export async function recordSaleReceivables(sale, userId, session = null) {
  requireDatabase();
  const entries = buildSaleReceivables(sale);
  await Transaction.bulkWrite(entries.map(entry => ({ updateOne: {
    filter: { saleId: entry.saleId, installment: entry.installment },
    update: { $setOnInsert: { ...entry, createdBy: userId } }, upsert: true
  } })), { session });
  return entries;
}
