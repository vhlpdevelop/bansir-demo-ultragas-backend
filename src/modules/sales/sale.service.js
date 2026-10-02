import mongoose from 'mongoose';
import { whatsappService } from '../../services/whatsapp.service.js';
import { randomUUID } from 'node:crypto';
import { Sale } from './sale.model.js';
import { Employee, calculateGasLevel } from '../employees/employee.model.js';
import { buildSaleReceivables, recordSaleReceivables } from '../financial/financial.service.js';
import { decrementStock } from '../products/product.service.js';
import { requireDatabase } from '../../config/db.js';
import { Voucher } from '../vouchers/voucher.model.js';
import { Customer } from '../customers/customer.model.js';
import qrcode from 'qrcode';

export async function getAllSales() { requireDatabase(); return Sale.find().sort({ date: -1 }); }
export async function registerSale(data, currentUser) {
  requireDatabase();
  const quantity = Number(data.quantity ?? 1), unitPrice = Number(data.unitPrice);
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('Quantidade e preço inválidos.');
  const discountType = data.discountType || 'fixed', discountValue = Number(data.discountValue ?? 0);
  if (!['fixed', 'percentage'].includes(discountType) || !Number.isFinite(discountValue) || discountValue < 0) throw new Error('Desconto inválido.');
  const round = value => Math.round(value * 100) / 100;
  const subtotal = round(unitPrice * quantity);
  const discountAmount = round(discountType === 'percentage' ? subtotal * discountValue / 100 : discountValue);
  const deliveryFee = Number(data.deliveryFee ?? 0);
  const totalAmount = round(subtotal - discountAmount + deliveryFee);
  if (totalAmount <= 0) throw new Error('Desconto deve ser menor que o valor da venda.');
  const admin = ['admin', 'superadmin'].includes(currentUser?.role);
  const counter = ['Balcão', 'Balcão Geral'].includes(data.sellerName);
  const sellerName = counter ? 'Balcão Geral' : admin ? data.sellerName || currentUser.name : currentUser.name;
  const sellerId = counter ? '' : admin ? data.sellerId || String(currentUser._id) : String(currentUser._id);
  const isPaid = data.isPaid !== undefined ? Boolean(data.isPaid) : data.paymentMethod !== 'pagar_na_entrega';
  const paymentStatus = data.paymentStatus || (isPaid ? 'pago' : 'pagar_na_entrega');
  const orderNumber = data.orderNumber || data.saleNumber || `PED-${Date.now().toString().slice(-6)}`;
  const saleNumber = data.saleNumber || data.orderNumber || `VND-${new Date().getFullYear()}-${randomUUID().slice(0, 8)}`;
  const orderDate = data.orderDate ? new Date(data.orderDate) : (data.date ? new Date(data.date) : new Date());
  const invoiceIssued = Boolean(data.invoiceIssued);
  const invoiceNumber = invoiceIssued ? (data.invoiceNumber || `NFCe-${Math.floor(1000 + Math.random() * 9000)}`) : '';

  const payload = { 
    orderNumber,
    saleNumber, 
    quantity, unitPrice, subtotal,
    discountType, discountValue, discountAmount, totalAmount, sellerId, sellerName,
    customerName: data.customerName || '', customerCpf: data.customerCpf || '',
    deliveryMode: data.deliveryMode || 'local',
    deliveryAddress: data.deliveryAddress || '',
    deliveryFee,
    deliveryTime: data.deliveryTime || '',
    deliveryEmployeeId: data.deliveryEmployeeId || '',
    deliveryEmployeeName: data.deliveryEmployeeName || '',
    deliveryEmployeePhone: data.deliveryEmployeePhone || '',
    paymentMethod: data.paymentMethod || (isPaid ? 'pix' : 'pagar_na_entrega'), 
    isPaid,
    paymentStatus,
    installments: Number(data.installments ?? 1),
    paymentFeeRate: Number(data.paymentFeeRate ?? 0), 
    firstReceiptDate: data.firstReceiptDate || undefined,
    receivedAmount: Number(data.receivedAmount || 0), 
    changeAmount: Number(data.changeAmount || 0),
    invoiceIssued, 
    invoiceNumber,
    financialStatus: isPaid ? 'posted' : 'pending', 
    date: orderDate 
  };
  buildSaleReceivables({ ...payload, _id: 'validation' });
  const saleResult = await mongoose.connection.transaction(async session => {
    const { product } = await decrementStock({ productId: data.productId, barcode: data.barcode, productName: data.productName, quantity }, session);
    const [sale] = await Sale.create([{ ...payload, productId: product._id, barcode: product.barcode, productName: product.name }], { session });
    await recordSaleReceivables(sale, currentUser._id || currentUser.id, session);
    const employee = counter ? null : await Employee.findOne({ name: sellerName, active: true }).session(session);
    if (employee) {
      employee.totalSalesCount += 1;
      employee.totalSalesAmount += totalAmount;
      employee.totalCommissionsEarned += round(employee.commissionType === 'percentage' ? totalAmount * employee.commissionValue / 100 : employee.commissionValue);
      employee.gamificationPoints += 10 + Math.floor(totalAmount / 10);
      employee.gamificationLevel = calculateGasLevel(employee.gamificationPoints, employee.totalSalesCount, employee.roleTitle);
      if (!employee.badges.includes('Primeira Venda')) employee.badges.push('Primeira Venda');
      await employee.save({ session });
    }
    return sale;
  });

  if (payload.deliveryMode === 'delivery' && payload.deliveryEmployeePhone) {
    const msg = `🛵 *Nova Entrega!*\n\n*Pedido:* ${payload.saleNumber}\n*Produto:* ${data.productName} (${quantity}x)\n*Cliente:* ${payload.customerName}\n*Endereço:* ${payload.deliveryAddress}\n*Horário:* ${payload.deliveryTime || 'Não informado'}\n*Cobrar:* R$ ${payload.totalAmount.toFixed(2)}\n*Pagamento:* ${payload.paymentMethod}\n*Troco:* R$ ${payload.changeAmount.toFixed(2)}\n\n*Bom trabalho!*`;
    whatsappService.sendMessage(payload.deliveryEmployeePhone, msg).then(async success => {
      if (success && saleResult) {
        await Sale.findByIdAndUpdate(saleResult._id || saleResult.id, { deliveryRouteSent: true });
      }
    }).catch(err => console.error('Erro ao notificar entregador', err));
  }

  if (data.emitVoucherForSale && data.customerPhone) {
    try {
      const voucher = new Voucher({
        customerName: payload.customerName || 'Cliente PDV',
        customerPhone: data.customerPhone,
        totalAmount: payload.totalAmount,
        items: [{
          product: data.productId,
          productName: data.productName,
          quantity: quantity,
          price: unitPrice
        }]
      });
      await voucher.save();
      
      const cleanPhone = data.customerPhone.replace(/\D/g, '');
      const qrBase64 = await qrcode.toDataURL(voucher.code);
      let itemsList = `${quantity}x ${data.productName}`;
      const msg = `🔥 *Seu Vale Gás Chegou!*\n\nOlá ${voucher.customerName}, seu vale foi emitido com sucesso!\n\n*Produtos:*\n${itemsList}\n*Total:* R$ ${Number(payload.totalAmount).toFixed(2)}\n*Código:* ${voucher.code}\n\n⚠️ *ATENÇÃO:* O QR Code acima é de uso exclusivo para a retirada. *NÃO COMPARTILHE COM NINGUÉM*, pois quem tiver acesso a ele poderá retirar o seu botijão.`;
      
      whatsappService.sendMessageWithImage(cleanPhone, msg, qrBase64).catch(err => console.error('Erro enviando WA voucher PDV', err));
      
      // Save voucher code back to the sale
      await Sale.findByIdAndUpdate(saleResult._id || saleResult.id, { voucherCode: voucher.code });
    } catch (err) {
      console.error('Erro ao emitir voucher via PDV:', err);
    }
  }

  return saleResult;
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
export async function resendDeliveryWhatsApp(saleId) {
  const sale = await Sale.findById(saleId);
  if (!sale) throw new Error('Venda não encontrada');
  if (sale.deliveryMode !== 'delivery' || !sale.deliveryEmployeePhone) {
    throw new Error('Venda não é do tipo entrega ou entregador não possui telefone cadastrado');
  }

  const payLabelMap = {
    pix: 'PIX Instantâneo',
    cartao_credito: 'Cartão de Crédito',
    cartao_debito: 'Cartão de Débito',
    dinheiro: 'Dinheiro em Espécie',
    vale: 'Vale Gás',
    maquininha_cartao: 'Maquininha de Cartão',
    pix_entrega: 'PIX na Entrega',
    pagar_na_entrega: 'Pagar na Entrega'
  };
  const payLabel = payLabelMap[sale.paymentMethod] || sale.paymentMethod;
  const isPaidSale = sale.isPaid !== false && sale.paymentStatus !== 'pagar_na_entrega';

  const paymentText = isPaidSale 
    ? `Já Pago (${payLabel})` 
    : `Cobrar na Entrega: ${payLabel}${sale.changeAmount ? ' | Levar troco de R$ ' + sale.changeAmount.toFixed(2) : ''}`;

  const msg = `🛵 *Reenvio de Rota!*\n\n*Pedido:* ${sale.saleNumber || sale._id.toString().slice(-6)}\n*Produto:* ${sale.productName} (${sale.quantity}x)\n*Cliente:* ${sale.customerName}\n*Endereço:* ${sale.deliveryAddress}\n*Horário:* ${sale.deliveryTime || 'Não informado'}\n*Cobrar:* R$ ${sale.totalAmount.toFixed(2)}\n*Pagamento:* ${paymentText}\n\n*Bom trabalho!*`;
  
  const success = await whatsappService.sendMessage(sale.deliveryEmployeePhone, msg);
  if (!success) {
    throw new Error('O Bot do WhatsApp está offline ou o número é inválido.');
  }
  sale.deliveryRouteSent = true;
  await sale.save();
  return true;
}
