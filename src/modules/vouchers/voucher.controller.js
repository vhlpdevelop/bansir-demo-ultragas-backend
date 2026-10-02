import { Voucher } from './voucher.model.js';
import { Customer } from '../customers/customer.model.js';

export async function emitVoucher(req, res) {
  try {
    const { customerName, customerPhone, items, totalAmount } = req.body;
    
    if (!customerName || !customerPhone || !items || !items.length) {
      return res.status(400).json({ success: false, message: 'Dados incompletos para emitir o vale.' });
    }

    const cleanPhone = customerPhone.replace(/\D/g, '');
    let customer = await Customer.findOne({ phone: cleanPhone });
    if (!customer) {
      await Customer.create({ name: customerName, phone: cleanPhone });
    } else if (customer.name !== customerName) {
      customer.name = customerName;
      await customer.save();
    }

    const voucher = new Voucher({
      customerName,
      customerPhone: cleanPhone,
      items,
      totalAmount
    });

    await voucher.save();
    return res.status(201).json({ success: true, data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function listVouchers(req, res) {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const vouchers = await Voucher.find(filter).sort({ issuedAt: -1 }).limit(100);
    return res.status(200).json({ success: true, data: vouchers });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function getVoucherByCode(req, res) {
  try {
    const { code } = req.params;
    const voucher = await Voucher.findOne({ code: code.toUpperCase() });
    
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Vale Gás não encontrado.' });
    }
    
    return res.status(200).json({ success: true, data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function redeemVoucher(req, res) {
  try {
    const { code } = req.params;
    const voucher = await Voucher.findOne({ code: code.toUpperCase() });
    
    if (!voucher) {
      return res.status(404).json({ success: false, message: 'Vale Gás não encontrado.' });
    }
    
    if (voucher.status !== 'ACTIVE') {
      return res.status(400).json({ success: false, message: `Este vale já foi ${voucher.status === 'REDEEMED' ? 'resgatado' : 'cancelado'}.` });
    }
    
    voucher.status = 'REDEEMED';
    voucher.redeemedAt = new Date();
    await voucher.save();
    
    return res.status(200).json({ success: true, data: voucher });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
