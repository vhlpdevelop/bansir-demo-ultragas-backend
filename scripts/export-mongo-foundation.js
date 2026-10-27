import '../src/config/env.js';
import mongoose from 'mongoose';
import { writeFile } from 'node:fs/promises';
import { foundationSnapshot } from '../src/postgres/provision.js';

// Offline export only. Reads raw collections, without models/index creation/seeds.
const path = process.argv[2];
let connection;
try {
  if (!path || !process.env.MONGODB_URI) throw new Error();
  connection = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, autoIndex: false, autoCreate: false }).asPromise();
  const collection = name => connection.db.collection(mongoose.pluralize()(name.toLowerCase()));
  const users = await collection('UltragasUser').find({}).toArray();
  const products = await collection('UltragasProduct').find({}).toArray();
  const categories = await collection('UltragasCategory').find({}).toArray();
  const store = await collection('UltragasStoreSettings').findOne({ _id: 'store' }) || {};
  const supported = new Set(['UltragasUser', 'UltragasProduct', 'UltragasCategory', 'UltragasStoreSettings'].map(name => mongoose.pluralize()(name.toLowerCase())));
  const pendingCollections = [];
  for (const { name } of await connection.db.listCollections({}, { nameOnly: true }).toArray()) {
    if (!supported.has(name) && !name.startsWith('system.')) {
      const count = await connection.db.collection(name).countDocuments();
      if (count) pendingCollections.push({ name, count });
    }
  }
  const snapshot = foundationSnapshot.parse({ version: 1, foundationOnly: true,
    tenant: { slug: process.env.MIGRATION_TENANT_SLUG, name: process.env.MIGRATION_TENANT_NAME },
    users: users.map(u => ({ legacyId: String(u._id), name: u.name, email: u.email, passwordHash: u.password,
      role: u.role, allowedRoutes: u.allowedRoutes || [], active: u.active !== false, phone: u.phone || '' })),
    categories: categories.map(c => ({ name: c.name, description: c.description || '', color: c.color || '#000fff' })),
    products: products.map(p => ({ legacyId: String(p._id), name: p.name, barcode: p.barcode, price: p.price,
      costPrice: p.costPrice || 0, stock: p.stock || 0, category: p.category, sku: p.sku || '', unit: p.unit || 'UN',
      brand: p.brand || '', specs: p.specs || '', ncm: p.ncm || '', active: p.active !== false })),
    settings: { storeName: store.storeName || '', pixKey: store.pixKey || '', documentId: store.documentId || '', address: store.address || '', merchantCity: store.merchantCity || '' }, pendingCollections
  });
  await writeFile(path, JSON.stringify(snapshot, null, 2), { flag: 'wx', mode: 0o600 });
  console.log('Snapshot inicial exportado. Contém hashes e dados pessoais: mantenha privado. Não é a migração completa.');
  console.log(`Coleções pendentes: ${pendingCollections.length}. A exportação deve ser feita com escritas suspensas para consistência.`);
} catch { console.error('Exportação não concluída. Confira dados, tenant, acesso somente leitura e caminho novo para o snapshot.'); process.exitCode = 1; }
finally { if (connection) await connection.close(); }
