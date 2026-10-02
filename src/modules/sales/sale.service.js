import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Sale } from './sale.model.js';
import { Employee } from '../employees/employee.model.js';
import { buildSaleReceivables, recordSaleReceivables } from '../financial/financial.service.js';
import { decrementStock } from '../products/product.service.js';
import { requireDatabase } from '../../config/db.js';

export async function getAllSales() { requireDatabase(); return Sale.find().sort({ date: -1 }); }
export async function registerSale(data, currentUser) {
  requireDatabase();
  const quantity = Number(data.quantity ?? 1), unitPrice = Number(data.unitPrice);
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('Quantidade e preço inválidos.');
  if (data.invoiceIssued) throw new Error('Emissão fiscal real ainda não configurada. Registre a venda sem NFC-e.');
  const discountType = data.discountType || 'fixed', discountValue = Number(data.discountValue ?? 0);
  if (!['fixed', 'percentage'].includes(discountType) || !Number.isFinite(discountValue) || discountValue < 0) throw new Error('Desconto inválido.');
  const round = value => Math.round(value * 100) / 100;
  const subtotal = round(unitPrice * quantity);
  const discountAmount = round(discountType === 'percentage' ? subtotal * discountValue / 100 : discountValue);
  const totalAmount = round(subtotal - discountAmount);
  if (totalAmount <= 0) throw new Error('Desconto deve ser menor que o valor da venda.');
  const admin = ['admin', 'superadmin'].includes(currentUser?.role);
  const counter = ['Balcão', 'Balcão Geral'].includes(data.sellerName);
  const sellerName = counter ? 'Balcão Geral' : admin ? data.sellerName || currentUser.name : currentUser.name;
  const sellerId = counter ? '' : admin ? data.sellerId || String(currentUser._id) : String(currentUser._id);
  const payload = { saleNumber: `VND-${new Date().getFullYear()}-${randomUUID()}`, quantity, unitPrice, subtotal,
    discountType, discountValue, discountAmount, totalAmount, sellerId, sellerName,
    customerName: data.customerName || '', customerCpf: data.customerCpf || '',
    paymentMethod: data.paymentMethod || 'pix', installments: Number(data.installments ?? 1),
    paymentFeeRate: Number(data.paymentFeeRate ?? 0), firstReceiptDate: data.firstReceiptDate || undefined,
    receivedAmount: Number(data.receivedAmount || 0), changeAmount: Number(data.changeAmount || 0),
    invoiceIssued: false, financialStatus: 'posted', date: new Date() };
  buildSaleReceivables({ ...payload, _id: 'validation' });
  return mongoose.connection.transaction(async session => {
    const { product } = await decrementStock({ productId: data.productId, barcode: data.barcode, productName: data.productName, quantity }, session);
    const [sale] = await Sale.create([{ ...payload, productId: product._id, barcode: product.barcode, productName: product.name }], { session });
    await recordSaleReceivables(sale, currentUser._id || currentUser.id, session);
    const employee = counter ? null : await Employee.findOne({ name: sellerName, active: true }).session(session);
    if (employee) {
      employee.totalSalesCount += 1;
      employee.totalSalesAmount += totalAmount;
      employee.totalCommissionsEarned += round(employee.commissionType === 'percentage' ? totalAmount * employee.commissionValue / 100 : employee.commissionValue);
      employee.gamificationPoints += 10 + Math.floor(totalAmount / 10);
      if (!employee.badges.includes('Primeira Venda')) employee.badges.push('Primeira Venda');
      await employee.save({ session });
    }
    return sale;
  });
}
export async function retrySaleFinancial(id, userId) {
  requireDatabase();
  return mongoose.connection.transaction(async session => {
    const sale = await Sale.findById(id).session(session);
    if (!sale) throw new Error('Venda não encontrada.');
    await recordSaleReceivables(sale, userId, session);
    sale.financialStatus = 'posted';
    await sale.save({ session });
    return sale;
  });
}
