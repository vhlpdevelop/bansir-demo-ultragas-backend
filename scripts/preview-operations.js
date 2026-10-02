// Disposable UI verification server. Loopback only; never connects to the application's MongoDB.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.INTEGRATION_MODE = 'demo';
const mongo = await MongoMemoryServer.create({ instance: { dbName: 'bansir_operations_preview' } });
await mongoose.connect(mongo.getUri());
const { default: app } = await import('../src/app.js');
const { User } = await import('../src/modules/users/user.model.js');
const { Product } = await import('../src/modules/products/product.model.js');
const { startOperationsWorker, createOperation } = await import('../src/modules/operations/operation.service.js');
const user = await User.create({ name: 'Loja de demonstração', email: 'preview@bansir.test', password: 'Preview-only-2026', role: 'admin' });
const products = await Product.create([
  { name: 'Vaso de cerâmica artesanal', barcode: 'demo-001', price: 129.9, stock: 12 },
  { name: 'Cesto de fibra natural', barcode: 'demo-002', price: 79.5, stock: 8 }
]);
const stop = await startOperationsWorker();
for (const scenario of ['success', 'fiscal_rejected', 'payment_timeout']) {
  await createOperation(user, { requestId: randomUUID(), items: [{ productId: String(products[0]._id), quantity: 1 }], method: 'credit', installments: 3, model: '65', scenario });
}
const server = app.listen(5101, '127.0.0.1', () => console.log('Preview isolado: http://127.0.0.1:5101 • preview@bansir.test / Preview-only-2026'));
async function shutdown() { stop(); server.closeAllConnections(); server.close(); await mongoose.disconnect(); await mongo.stop(); process.exit(0); }
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
