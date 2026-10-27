import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
process.env.NODE_ENV = 'test';
const uri = process.env.RECEIPT_TEST_URI;
test('UltraGás: receipt persistence, delivery debt and stock atomicity', { skip: !uri, timeout: 90000 }, async () => {
  const database = new URL(uri).pathname.slice(1);
  assert.match(database, /^bansir_test_[a-f0-9]+$/);
  const { Sale } = await import('../src/modules/sales/sale.model.js');
  const { Product } = await import('../src/modules/products/product.model.js');
  const { StoreSettings } = await import('../src/modules/settings/settings.model.js');
  const { Transaction } = await import('../src/modules/financial/transaction.model.js');
  const { registerSale } = await import('../src/modules/sales/sale.service.js');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    assert.equal((await mongoose.connection.db.listCollections().toArray()).length, 0);
    await StoreSettings.create({ _id: 'store', storeName: 'UltraGás teste', contact: '555', address: 'Rua de teste' });
    await Promise.all([Sale.init(), Transaction.init()]);
    const product = await Product.create({ name: 'Botijão teste', barcode: 'RECEIPT-TEST', price: 14, stock: 3 });
    const user = { _id: new mongoose.Types.ObjectId(), name: 'Teste', role: 'admin' };
    const data = { productId: product._id, productName: product.name, quantity: 1, unitPrice: 14, deliveryFee: 2, discountValue: 1, sellerName: 'Balcão Geral', customerName: 'Cliente', customerPhone: '123', customerNotes: 'Ligar', customerNeighborhood: 'Centro', paymentMethod: 'dinheiro', isPaid: true, receivedAmount: 20 };
    await assert.rejects(registerSale({ ...data, receivedAmount: 5 }, user), /cobrir/);
    assert.equal((await Product.findById(product._id)).stock, 3);
    assert.equal(await Sale.countDocuments(), 0);
    const sale = await registerSale(data, user);
    const stored = await Sale.findById(sale._id).lean();
    assert.equal(stored.totalAmount, 15); assert.equal(stored.changeAmount, 5); assert.equal(stored.outstandingAmount, 0);
    assert.equal(stored.customerNotes, 'Ligar'); assert.equal(stored.customerPhone, '123');
    await StoreSettings.updateOne({ _id: 'store' }, { contact: 'changed' });
    assert.equal((await Sale.findById(sale._id)).receiptStore.contact, '555');
    const paidEntry = await Transaction.findOne({ saleId: String(sale._id) });
    assert.equal(paidEntry.amount, 15); assert.equal(paidEntry.status, 'completed');
    const delivery = await registerSale({ ...data, isPaid: false, paymentStatus: 'pagar_na_entrega', receivedAmount: undefined, changeFor: 20, deliveryMode: 'delivery', deliveryAddress: 'Rua teste 2' }, user);
    assert.equal(delivery.receivedAmount, 0); assert.equal(delivery.changeAmount, 0);
    assert.equal(delivery.plannedChangeAmount, 5); assert.equal(delivery.outstandingAmount, 15);
    assert.equal(delivery.customerAddress, 'Rua teste 2');
    assert.equal((await Transaction.findOne({ saleId: String(delivery._id) })).status, 'pending');
    assert.equal((await Product.findById(product._id)).stock, 1);
    await assert.rejects(registerSale({ ...data, quantity: 2, receivedAmount: 100 }, user), /estoque/);
    assert.equal(await Sale.countDocuments(), 2);
  } finally {
    if (mongoose.connection.name === database && /^bansir_test_[a-f0-9]+$/.test(database)) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
