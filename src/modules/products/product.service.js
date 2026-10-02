import mongoose from 'mongoose';
import { Product, Category } from './product.model.js';
import { StockMovement } from './stock-movement.model.js';
import { requireDatabase } from '../../config/db.js';

export async function getAllProducts() {
  requireDatabase();
  return Product.find({ active: true }).sort({ name: 1 });
}
export async function searchProducts(queryText) {
  requireDatabase();
  const query = String(queryText || '').trim();
  if (!query) return getAllProducts();
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  return Product.find({ active: true, $or: [{ barcode: query }, { name: regex }, { category: regex }, { sku: regex }] }).limit(30);
}
export async function getProductByBarcode(barcode) {
  requireDatabase();
  return Product.findOne({ barcode: String(barcode).trim(), active: true });
}
const fields = ['name', 'barcode', 'category', 'price', 'costPrice', 'stock', 'sku', 'unit', 'brand', 'specs', 'ncm', 'supplierId', 'active'];
function productFields(data) {
  const result = Object.fromEntries(fields.filter(k => data[k] !== undefined).map(k => [k, data[k]]));
  if (result.stock !== undefined && (!Number.isInteger(Number(result.stock)) || Number(result.stock) < 0)) throw new Error('Estoque deve ser um inteiro não negativo.');
  return result;
}
async function movement(product, delta, data, session) {
  if (!delta) return;
  const [entry] = await StockMovement.create([{ productId: product._id, productName: product.name,
    type: delta > 0 ? 'in' : 'out', quantity: Math.abs(delta), unitPrice: product.price,
    reason: data.reason || 'Ajuste de cadastro', notes: data.notes || '', userName: data.user?.name || 'Sistema' }], { session });
  return entry;
}
export async function createProduct(data) {
  requireDatabase();
  return mongoose.connection.transaction(async session => {
    const [product] = await Product.create([productFields(data)], { session });
    await movement(product, product.stock, { reason: 'Estoque inicial' }, session);
    return product;
  });
}
export async function updateProduct(id, data) {
  requireDatabase();
  return mongoose.connection.transaction(async session => {
    const product = await Product.findById(id).session(session);
    if (!product) throw new Error('Produto não encontrado.');
    const previous = product.stock;
    Object.assign(product, productFields(data));
    await product.save({ session });
    await movement(product, product.stock - previous, {}, session);
    return product;
  });
}
export async function deleteProduct(id) {
  requireDatabase();
  const product = await Product.findByIdAndUpdate(id, { $set: { active: false } });
  if (!product) throw new Error('Produto não encontrado.');
  return true;
}
export async function getAllCategories() {
  requireDatabase();
  const categories = await Category.find().sort({ name: 1 }).lean();
  const counts = await Product.aggregate([{ $match: { active: true } }, { $group: { _id: '$category', count: { $sum: 1 } } }]);
  return categories.map(c => ({ ...c, productCount: counts.find(x => x._id === c.name)?.count || 0 }));
}
export async function createCategory(data) {
  requireDatabase();
  return Category.create({ name: data.name, description: data.description, color: data.color });
}
export async function deleteCategory(id) {
  requireDatabase();
  const category = await Category.findById(id);
  if (!category) return false;
  if (await Product.exists({ category: category.name, active: true })) throw new Error('Categoria possui produtos ativos.');
  await category.deleteOne();
  return true;
}
export async function decrementStock({ productId, barcode, productName, quantity = 1 }, session = null) {
  requireDatabase();
  if (!session) return mongoose.connection.transaction(s => decrementStock({ productId, barcode, productName, quantity }, s));
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantidade inválida.');
  const identity = productId ? { _id: productId } : barcode ? { barcode } : productName ? { name: productName } : null;
  if (!identity) throw new Error('Produto obrigatório.');
  const product = await Product.findOneAndUpdate({ ...identity, active: true, stock: { $gte: qty } },
    { $inc: { stock: -qty } }, { new: true, session });
  if (!product) throw new Error('Produto indisponível ou estoque insuficiente.');
  await movement(product, -qty, { reason: 'Venda PDV' }, session);
  return { success: true, decrementedBy: qty, remainingStock: product.stock, product };
}
export async function registerStockMovement({ productId, type, quantity, reason, notes, user }) {
  requireDatabase();
  const qty = Number(quantity);
  if (!['in', 'out'].includes(type) || !Number.isInteger(qty) || qty < 1) throw new Error('Movimentação inválida.');
  return mongoose.connection.transaction(async session => {
    const query = { _id: productId, active: true, ...(type === 'out' ? { stock: { $gte: qty } } : {}) };
    const delta = type === 'in' ? qty : -qty;
    const product = await Product.findOneAndUpdate(query, { $inc: { stock: delta } }, { new: true, session });
    if (!product) throw new Error('Produto indisponível ou estoque insuficiente.');
    return { product, movement: await movement(product, delta, { reason, notes, user }, session) };
  });
}
export async function getStockSummary() {
  const products = await getAllProducts();
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthly = await StockMovement.find({ date: { $gte: start, $lt: end } }).lean();
  const totals = type => monthly.filter(m => m.type === type).reduce((a,m) => ({ units: a.units + m.quantity, value: a.value + m.quantity * m.unitPrice }), { units: 0, value: 0 });
  const entries = totals('in'), exits = totals('out');
  const low = products.filter(p => p.stock <= 5).sort((a,b) => a.stock-b.stock);
  return { totalProducts: products.length, totalStockUnits: products.reduce((a,p) => a+p.stock, 0),
    totalStockCost: products.reduce((a,p) => a+p.stock*p.costPrice, 0), totalStockRetail: products.reduce((a,p) => a+p.stock*p.price, 0),
    monthEntriesUnits: entries.units, monthEntriesValue: entries.value, monthExitsUnits: exits.units, monthExitsValue: exits.value,
    lowStockCount: low.length, lowStockProducts: low, recentMovements: await StockMovement.find().sort({ date: -1 }).limit(15) };
}
