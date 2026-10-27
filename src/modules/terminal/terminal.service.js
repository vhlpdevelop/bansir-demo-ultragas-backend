import mongoose from 'mongoose';
import { Product } from '../products/product.model.js';
import { Sale } from '../sales/sale.model.js';
import { Transaction } from '../financial/transaction.model.js';
import { TerminalAdjustment, TerminalPayment } from './terminal.model.js';

const toCents = value => Math.round(Number(value) * 100);
const fromCents = value => value / 100;

function cleanOrderNumber(value) {
  const orderNumber = String(value || '').trim();
  if (!orderNumber || orderNumber.length > 100) throw new Error('Número do pedido inválido.');
  return orderNumber;
}

function validateAudit(audit) {
  if (!audit?.terminalId || !audit?.operatorId || !audit?.operatorName) throw new Error('Auditoria do terminal incompleta.');
  return audit;
}

async function orderSales(orderNumber, session = null) {
  const query = Sale.find({
    $or: [{ orderNumber }, { saleNumber: orderNumber }],
    deliveryMode: 'delivery',
    status: 'completed'
  }).sort({ date: 1, _id: 1 });
  if (session) query.session(session);
  const sales = await query.lean();
  if (!sales.length) throw new Error('Pedido de entrega não encontrado.');
  return sales;
}

async function paymentSummary(orderNumber, session = null) {
  const paymentQuery = TerminalPayment.find({ orderNumber }).sort({ approvedAt: 1, _id: 1 });
  const adjustmentQuery = TerminalAdjustment.find({ orderNumber }).sort({ approvedAt: 1, _id: 1 });
  if (session) {
    paymentQuery.session(session);
    adjustmentQuery.session(session);
  }
  const [payments, adjustments] = await Promise.all([paymentQuery.lean(), adjustmentQuery.lean()]);
  return { payments, adjustments };
}

export function buildTerminalOrder(sales, payments = [], adjustments = []) {
  const originalTotalCents = sales.reduce((sum, sale) => sum + toCents(sale.totalAmount), 0);
  const paidCents = payments.reduce((sum, payment) => sum + Number(payment.amountCents), 0);
  const adjustmentCents = adjustments.reduce((sum, adjustment) => sum + Number(adjustment.amountCents), 0);
  const payableCents = Math.max(0, originalTotalCents - adjustmentCents);
  const balanceCents = Math.max(0, payableCents - paidCents);
  const first = sales[0];
  return {
    orderNumber: first.orderNumber || first.saleNumber,
    status: balanceCents === 0 ? 'paid' : paidCents > 0 || adjustmentCents > 0 ? 'partial' : 'pending',
    originalTotalCents,
    adjustmentCents,
    payableCents,
    paidCents,
    balanceCents,
    customer: {
      name: first.customerName || '',
      phone: first.customerPhone || '',
      address: first.deliveryAddress || first.customerAddress || '',
      neighborhood: first.customerNeighborhood || '',
      notes: first.customerNotes || ''
    },
    delivery: {
      employeeId: first.deliveryEmployeeId || '',
      employeeName: first.deliveryEmployeeName || '',
      feeCents: sales.reduce((sum, sale) => sum + toCents(sale.deliveryFee || 0), 0)
    },
    seller: { id: first.sellerId || '', name: first.sellerName || '' },
    createdAt: first.date || first.createdAt,
    items: sales.map(sale => ({
      saleId: String(sale._id),
      name: sale.productName,
      quantity: sale.quantity,
      unitPriceCents: toCents(sale.unitPrice),
      subtotalCents: toCents(sale.subtotal),
      totalCents: toCents(sale.totalAmount)
    })),
    payments: payments.map(payment => ({
      paymentId: payment.paymentId,
      amountCents: payment.amountCents,
      method: payment.method,
      installments: payment.installments,
      provider: payment.provider,
      providerTransactionId: payment.providerTransactionId,
      authorizationCode: payment.authorizationCode,
      nsu: payment.nsu,
      terminalId: payment.terminalId,
      operatorId: payment.operatorId,
      operatorName: payment.operatorName,
      approvedAt: payment.approvedAt
    })),
    adjustments: adjustments.map(adjustment => ({
      adjustmentId: adjustment.adjustmentId,
      amountCents: adjustment.amountCents,
      reason: adjustment.reason,
      terminalId: adjustment.terminalId,
      operatorId: adjustment.operatorId,
      operatorName: adjustment.operatorName,
      approvedAt: adjustment.approvedAt
    }))
  };
}

export async function listTerminalOrders() {
  const sales = await Sale.find({
    deliveryMode: 'delivery',
    status: 'completed',
    $or: [{ isPaid: false }, { paymentStatus: { $in: ['pagar_na_entrega', 'pendente'] } }]
  }).sort({ date: 1 }).lean();
  const grouped = new Map();
  for (const sale of sales) {
    const key = sale.orderNumber || sale.saleNumber;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(sale);
  }
  return Promise.all([...grouped.entries()].map(async ([orderNumber, orderItems]) => {
    const { payments, adjustments } = await paymentSummary(orderNumber);
    return buildTerminalOrder(orderItems, payments, adjustments);
  }));
}

export async function getTerminalOrder(orderNumber, session = null) {
  const clean = cleanOrderNumber(orderNumber);
  const sales = await orderSales(clean, session);
  const summary = await paymentSummary(clean, session);
  return buildTerminalOrder(sales, summary.payments, summary.adjustments);
}

async function settleOrder(order, session) {
  if (order.balanceCents !== 0) return;
  const saleIds = order.items.map(item => item.saleId);
  const methods = [...new Set(order.payments.map(payment => payment.method))];
  const paymentMethod = methods.length === 1 ? methods[0] : 'outro';
  const settledAt = new Date();
  await Sale.updateMany(
    { _id: { $in: saleIds } },
    { $set: { isPaid: true, paymentStatus: 'pago', outstandingAmount: 0, financialStatus: 'posted', paymentMethod } },
    { session }
  );

  const transactions = await Transaction.find({ saleId: { $in: saleIds }, status: 'pending' }).sort({ saleId: 1, installment: 1 }).session(session);
  if (!transactions.length) return;
  const originalCents = transactions.reduce((sum, transaction) => sum + toCents(transaction.amount), 0);
  let allocatedCents = 0;
  for (let index = 0; index < transactions.length; index += 1) {
    const transaction = transactions[index];
    const amountCents = index === transactions.length - 1
      ? order.payableCents - allocatedCents
      : Math.floor(order.payableCents * toCents(transaction.amount) / originalCents);
    allocatedCents += amountCents;
    transaction.amount = fromCents(amountCents);
    transaction.status = 'completed';
    transaction.settledAt = settledAt;
    transaction.dueDate = null;
    transaction.paymentMethod = paymentMethod;
    if (order.adjustmentCents > 0) {
      transaction.notes = `${transaction.notes || ''} Ajuste autorizado no pedido: R$ ${fromCents(order.adjustmentCents).toFixed(2)}.`.trim();
    }
    await transaction.save({ session });
  }
}

export async function registerTerminalPayment(orderNumber, input, audit) {
  const clean = cleanOrderNumber(orderNumber);
  validateAudit(audit);
  const amountCents = Number(input.amountCents);
  const installments = Number(input.installments || 1);
  const methods = ['pix', 'cartao_debito', 'cartao_credito', 'dinheiro', 'vale', 'outro'];
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) throw new Error('Valor do pagamento inválido.');
  if (!methods.includes(input.method)) throw new Error('Forma de pagamento inválida.');
  if (!Number.isInteger(installments) || installments < 1 || installments > 24) throw new Error('Parcelamento inválido.');
  if (input.method !== 'cartao_credito' && installments !== 1) throw new Error('Apenas crédito permite parcelamento.');
  if (!input.paymentId || !input.idempotencyKey) throw new Error('Identificadores do pagamento são obrigatórios.');

  return mongoose.connection.transaction(async session => {
    const existing = await TerminalPayment.findOne({ idempotencyKey: input.idempotencyKey }).session(session).lean();
    if (existing) {
      if (existing.orderNumber !== clean || existing.amountCents !== amountCents || existing.method !== input.method) {
        const error = new Error('Chave de idempotência já usada com outros dados.');
        error.statusCode = 409;
        throw error;
      }
      return { order: await getTerminalOrder(clean, session), payment: existing, replayed: true };
    }
    const order = await getTerminalOrder(clean, session);
    if (order.balanceCents === 0) throw new Error('Pedido já está liquidado.');
    if (amountCents > order.balanceCents) throw new Error('Pagamento maior que o saldo. Registre em dinheiro apenas o valor aplicado e trate o troco no terminal.');

    const [payment] = await TerminalPayment.create([{
      orderNumber: clean,
      paymentId: String(input.paymentId),
      idempotencyKey: String(input.idempotencyKey),
      amountCents,
      method: input.method,
      installments,
      provider: String(input.provider || ''),
      providerTransactionId: String(input.providerTransactionId || ''),
      authorizationCode: String(input.authorizationCode || ''),
      nsu: String(input.nsu || ''),
      ...audit
    }], { session });
    const updatedOrder = await getTerminalOrder(clean, session);
    await settleOrder(updatedOrder, session);
    return { order: updatedOrder, payment: payment.toObject(), replayed: false };
  });
}

export async function registerTerminalAdjustment(orderNumber, input, audit) {
  const clean = cleanOrderNumber(orderNumber);
  validateAudit(audit);
  const amountCents = Number(input.amountCents);
  const reason = String(input.reason || '').trim();
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) throw new Error('Valor do ajuste inválido.');
  if (reason.length < 5 || reason.length > 500) throw new Error('Informe um motivo de ajuste com pelo menos 5 caracteres.');
  if (!input.adjustmentId || !input.idempotencyKey) throw new Error('Identificadores do ajuste são obrigatórios.');

  return mongoose.connection.transaction(async session => {
    const existing = await TerminalAdjustment.findOne({ idempotencyKey: input.idempotencyKey }).session(session).lean();
    if (existing) return { order: await getTerminalOrder(clean, session), adjustment: existing, replayed: true };
    const order = await getTerminalOrder(clean, session);
    if (order.balanceCents === 0) throw new Error('Pedido já está liquidado.');
    if (amountCents > order.balanceCents) throw new Error('O ajuste não pode ser maior que o saldo do pedido.');
    if (order.payableCents - amountCents < order.items.length) {
      throw new Error('O ajuste não pode reduzir o pedido a zero. Cancele o pedido quando não houver valor a receber.');
    }
    const [adjustment] = await TerminalAdjustment.create([{
      orderNumber: clean,
      adjustmentId: String(input.adjustmentId),
      idempotencyKey: String(input.idempotencyKey),
      amountCents,
      reason,
      ...audit
    }], { session });
    const updatedOrder = await getTerminalOrder(clean, session);
    await settleOrder(updatedOrder, session);
    return { order: updatedOrder, adjustment: adjustment.toObject(), replayed: false };
  });
}

export async function listTerminalProducts() {
  const products = await Product.find({ active: true }).sort({ name: 1 }).lean();
  return products.map(product => ({
    id: String(product._id),
    name: product.name,
    barcode: product.barcode,
    category: product.category,
    priceCents: toCents(product.price),
    stock: product.stock,
    unit: product.unit
  }));
}
