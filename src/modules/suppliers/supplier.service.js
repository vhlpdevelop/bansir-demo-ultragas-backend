import { Supplier } from './supplier.model.js';
import { requireDatabase } from '../../config/db.js';

/**
 * Get all suppliers with optional search and category filter
 */
export async function getAllSuppliers(filters = {}) {
  requireDatabase();
  const query = {};

  if (filters.search) {
    const searchRegex = new RegExp(filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { name: searchRegex },
      { tradeName: searchRegex },
      { document: searchRegex },
      { email: searchRegex },
      { 'address.city': searchRegex }
    ];
  }

  if (filters.category && filters.category !== 'all') {
    query.category = filters.category;
  }

  if (filters.active !== undefined) {
    query.active = filters.active === 'true' || filters.active === true;
  }

  return Supplier.find(query).sort({ name: 1 });
}

/**
 * Get supplier by ID
 */
export async function getSupplierById(id) {
  requireDatabase();
  const supplier = await Supplier.findById(id);
  if (!supplier) throw new Error('Fornecedor não encontrado.');
  return supplier;
}

/**
 * Get supplier by Document (CNPJ or CPF)
 */
export async function getSupplierByDocument(document) {
  requireDatabase();
  const cleanDoc = String(document || '').replace(/\D/g, '');
  return Supplier.findOne({
    $or: [
      { document: cleanDoc },
      { document: String(document || '').trim() }
    ]
  });
}

const allowedFields = [
  'name',
  'tradeName',
  'document',
  'stateRegistration',
  'email',
  'phone',
  'contactPerson',
  'category',
  'address',
  'bankDetails',
  'notes',
  'active'
];

function sanitizeSupplierData(data) {
  const result = {};
  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      result[field] = data[field];
    }
  }

  // Clean document (digits only if standard CNPJ/CPF)
  if (result.document) {
    result.document = String(result.document).trim();
  }

  return result;
}

/**
 * Create a new supplier
 */
export async function createSupplier(data) {
  requireDatabase();
  if (!data.name || !data.document) {
    throw new Error('Razão Social / Nome e CNPJ/CPF são obrigatórios.');
  }

  const existing = await getSupplierByDocument(data.document);
  if (existing) {
    throw new Error(`Já existe um fornecedor cadastrado com o documento ${data.document}.`);
  }

  const sanitized = sanitizeSupplierData(data);
  return Supplier.create(sanitized);
}

/**
 * Update an existing supplier
 */
export async function updateSupplier(id, data) {
  requireDatabase();
  const supplier = await Supplier.findById(id);
  if (!supplier) throw new Error('Fornecedor não encontrado.');

  if (data.document && data.document !== supplier.document) {
    const existing = await getSupplierByDocument(data.document);
    if (existing && String(existing._id) !== String(id)) {
      throw new Error(`Já existe outro fornecedor cadastrado com o documento ${data.document}.`);
    }
  }

  const sanitized = sanitizeSupplierData(data);
  Object.assign(supplier, sanitized);
  await supplier.save();
  return supplier;
}

/**
 * Delete / deactivate supplier
 */
export async function deleteSupplier(id) {
  requireDatabase();
  const supplier = await Supplier.findByIdAndUpdate(id, { $set: { active: false } }, { new: true });
  if (!supplier) throw new Error('Fornecedor não encontrado.');
  return supplier;
}

/**
 * Find or auto-create supplier from NF-e <emit> payload
 */
export async function findOrCreateSupplierFromNFe(emitData) {
  requireDatabase();
  if (!emitData || (!emitData.CNPJ && !emitData.CPF)) {
    return null;
  }

  const doc = String(emitData.CNPJ || emitData.CPF || '').trim();
  let supplier = await getSupplierByDocument(doc);

  if (!supplier) {
    const addressData = emitData.enderEmit || {};
    supplier = await Supplier.create({
      name: emitData.xNome || 'Fornecedor NF-e',
      tradeName: emitData.xFant || emitData.xNome || '',
      document: doc,
      stateRegistration: emitData.IE ? String(emitData.IE) : '',
      phone: addressData.fone ? String(addressData.fone) : '',
      email: emitData.email || '',
      category: 'Materia-Prima',
      address: {
        street: addressData.xLgr || '',
        number: addressData.nro || '',
        complement: addressData.xCpl || '',
        neighborhood: addressData.xBairro || '',
        city: addressData.xMun || '',
        state: addressData.UF || '',
        zipCode: addressData.CEP ? String(addressData.CEP) : ''
      },
      notes: 'Cadastrado automaticamente via importação de NF-e.'
    });
  }

  return supplier;
}
