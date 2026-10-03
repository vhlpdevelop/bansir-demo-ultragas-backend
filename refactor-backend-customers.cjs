const fs = require('fs');

// 1. Update voucher.controller.js
const vPath = 'c:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/modules/vouchers/voucher.controller.js';
let vContent = fs.readFileSync(vPath, 'utf8');

const vOld = `    let customer = await Customer.findOne({ phone: cleanPhone });
    if (!customer) {
      await Customer.create({ name: customerName, phone: cleanPhone });
    } else if (customer.name !== customerName) {
      customer.name = customerName;
      await customer.save();
    }`;

const vNew = `    let customer = await Customer.findOne({ phone: cleanPhone });
    if (!customer) {
      customer = await Customer.create({ name: customerName, phone: cleanPhone, issuedVouchersCount: 1 });
    } else {
      if (customer.name !== customerName) {
        customer.name = customerName;
      }
      customer.issuedVouchersCount = (customer.issuedVouchersCount || 0) + 1;
      await customer.save();
    }`;

vContent = vContent.replace(vOld, vNew);
fs.writeFileSync(vPath, vContent, 'utf8');


// 2. Update sale.service.js
const sPath = 'c:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/modules/sales/sale.service.js';
let sContent = fs.readFileSync(sPath, 'utf8');

// Add customer update in registerSale inside or outside transaction
const sTargetOld = `    const [sale] = await Sale.create([{ ...payload, productId: product._id, barcode: product.barcode, productName: product.name }], { session });
    await recordSaleReceivables(sale, currentUser._id || currentUser.id, session);`;

const sTargetNew = `    const [sale] = await Sale.create([{ ...payload, productId: product._id, barcode: product.barcode, productName: product.name }], { session });
    await recordSaleReceivables(sale, currentUser._id || currentUser.id, session);
    
    // Increment ordersCompleted for customer
    if (payload.customerPhone) {
      const cleanPhone = payload.customerPhone.replace(/\\D/g, '');
      let customer = await Customer.findOne({ phone: cleanPhone }).session(session);
      if (customer) {
        customer.ordersCompleted = (customer.ordersCompleted || 0) + 1;
        if (!customer.name && payload.customerName) customer.name = payload.customerName;
        await customer.save({ session });
      } else if (payload.customerName) {
        await Customer.create([{ name: payload.customerName, phone: cleanPhone, ordersCompleted: 1 }], { session });
      }
    }`;

sContent = sContent.replace(sTargetOld, sTargetNew);

// Also increment issuedVouchersCount if emitVoucherForSale
const sVoucherOld = `      const voucher = new Voucher({
        customerName: payload.customerName || 'Cliente PDV',
        customerPhone: data.customerPhone,
        totalAmount: payload.totalAmount,`;

const sVoucherNew = `      const voucher = new Voucher({
        customerName: payload.customerName || 'Cliente PDV',
        customerPhone: data.customerPhone,
        totalAmount: payload.totalAmount,`;

// Wait, we can just add the increment right after voucher.save()
const sSaveVoucherOld = `      await voucher.save();
      
      const cleanPhone = data.customerPhone.replace(/\\D/g, '');`;

const sSaveVoucherNew = `      await voucher.save();
      
      const cleanPhone = data.customerPhone.replace(/\\D/g, '');
      const cust = await Customer.findOne({ phone: cleanPhone });
      if (cust) {
        cust.issuedVouchersCount = (cust.issuedVouchersCount || 0) + 1;
        await cust.save();
      }`;

sContent = sContent.replace(sSaveVoucherOld, sSaveVoucherNew);

fs.writeFileSync(sPath, sContent, 'utf8');
console.log('Backend updated');
