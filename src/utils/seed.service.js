import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import { seedCategories, seedProducts, seedEmployees, seedPricing } from './seed-data.js';
import { User } from '../modules/users/user.model.js';
import { Product, Category } from '../modules/products/product.model.js';
import { StockMovement } from '../modules/products/stock-movement.model.js';
import { Employee } from '../modules/employees/employee.model.js';
import { PricingConfig } from '../modules/financial/pricing-config.model.js';
import { Sale } from '../modules/sales/sale.model.js';
import { Transaction } from '../modules/financial/transaction.model.js';
import { recordSaleReceivables } from '../modules/financial/financial.service.js';
import { requireDatabase } from '../config/db.js';
const idFor = key => new mongoose.Types.ObjectId(createHash('sha256').update(`bansir-seed-v1:${key}`).digest('hex').slice(0,24));
const routes = ['dashboard', 'sales', 'products', 'products-catalog', 'products-categories', 'products-stock', 'financial', 'financial-overview', 'financial-intelligence', 'employees', 'settings', 'rbac'];
export function seedAccounts(env = process.env) {
  return [
    { name: 'Karen', email: 'karen@ultragas.com', role: 'superadmin', password: 'KarenUltragas123', allowedRoutes: routes },
    { name: 'Sibele', email: 'sibele@ultragas.com', role: 'superadmin', password: 'SibeleUltragas123', allowedRoutes: routes },
    { name: 'Operador de Caixa', email: 'operador@ultragas.com', role: 'operador', password: 'OperadorUltragas123', allowedRoutes: ['sales'] }
  ].map(u => ({ ...u, email: u.email.trim().toLowerCase(), active: true, notificationPreferences: { sales: u.role !== 'operador', system: u.role !== 'operador', financial: u.role !== 'operador', stock: true } }));
}
export { seedPlan } from './seed-data.js';
export async function seedDatabase({ demo = false, accounts = seedAccounts() } = {}) {
  requireDatabase();
  for (const user of accounts) {
    if (!user.password || user.password.length < 12) throw new Error('Configure SEED_ADMIN_PASSWORD, SEED_MANAGER_PASSWORD e SEED_OPERATOR_PASSWORD no .env (mínimo 12 caracteres).');
  }
  // Create indexes before beginning the atomic seed, including unique ledger keys.
  for (const model of [User, Category, Product, StockMovement, Employee, PricingConfig, Sale, Transaction]) await model.init();
  return mongoose.connection.transaction(async session => {
    const inserted = { users: 0, categories: 0, products: 0, employees: 0, pricingConfigurations: 0, demoSales: 0, demoExpenses: 0 };
    for (const account of accounts) {
      if (!await User.exists({ email: account.email }).session(session)) {
        await User.create([{ ...account, _id: idFor(account.email) }], { session }); inserted.users++;
      }
    }
    for (const { _id, id, ...category } of seedCategories) {
      const result = await Category.updateOne({ name: category.name }, { $setOnInsert: { ...category, _id: idFor(_id) } }, { upsert: true, session });
      inserted.categories += result.upsertedCount;
    }
    for (const { _id, id, totalSalesCount, totalSalesAmount, totalCommissionsEarned, gamificationPoints, gamificationLevel, badges, ...employee } of seedEmployees) {
      const result = await Employee.updateOne({ email: employee.email }, { $setOnInsert: { ...employee, _id: idFor(_id), totalSalesCount: 0, totalSalesAmount: 0, totalCommissionsEarned: 0, gamificationPoints: 0, badges: [] } }, { upsert: true, session });
      inserted.employees += result.upsertedCount;
    }
    for (const { _id, id, ...data } of seedProducts) {
      const result = await Product.updateOne({ barcode: data.barcode }, { $setOnInsert: { ...data, _id: idFor(_id) } }, { upsert: true, session });
      if (result.upsertedCount) {
        inserted.products++;
        await StockMovement.create([{ productId: result.upsertedId, productName: data.name, type: 'in', quantity: data.stock, unitPrice: data.price, reason: 'Seed: estoque inicial', userName: 'Seed' }], { session });
      }
    }
    const pricing = await PricingConfig.updateOne({ _id: 'store' }, { $setOnInsert: { settings: seedPricing } }, { upsert: true, session });
    inserted.pricingConfigurations += pricing.upsertedCount;
    if (demo) {
      const admin = await User.findOne({ email: accounts[0].email }).session(session);
      for (let i = 0; i < 2; i++) {
        const saleId = idFor(`demo-sale-${i}`);
        if (await Sale.exists({ _id: saleId }).session(session)) continue;
        const product = await Product.findOneAndUpdate({ barcode: seedProducts[i].barcode, active: true, stock: { $gte: 1 } }, { $inc: { stock: -1 } }, { new: true, session });
        if (!product) throw new Error('Estoque insuficiente para os exemplos. Execute a seed sem --demo.');
        const [sale] = await Sale.create([{ _id: saleId, saleNumber: `SEED-DEMO-${i+1}`, productId: product._id, productName: product.name, barcode: product.barcode, unitPrice: product.price, quantity: 1, subtotal: product.price, totalAmount: product.price, sellerName: 'Balcão Geral', paymentMethod: i ? 'cartao_credito' : 'pix', installments: i ? 3 : 1, paymentFeeRate: i ? 2.99 : 0, financialStatus: 'posted', invoiceIssued: false }], { session });
        await StockMovement.create([{ productId: product._id, productName: product.name, type: 'out', quantity: 1, unitPrice: product.price, reason: 'Seed demo: venda de exemplo', userName: 'Seed' }], { session });
        await recordSaleReceivables(sale, admin._id, session);
        inserted.demoSales++;
      }
      const result = await Transaction.updateOne({ _id: idFor('demo-expense') }, { $setOnInsert: { title: '[Seed demo] Material de embalagem', amount: 50, type: 'expense', category: 'outros', status: 'completed', paymentMethod: 'pix', date: new Date(), settledAt: new Date(), createdBy: admin._id } }, { upsert: true, session });
      inserted.demoExpenses += result.upsertedCount;
    }
    return inserted;
  });
}
