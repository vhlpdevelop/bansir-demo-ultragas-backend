import { XMLParser } from 'fast-xml-parser';
import mongoose from 'mongoose';
import { Product } from './product.model.js';
import { StockMovement } from './stock-movement.model.js';
import { Supplier } from '../suppliers/supplier.model.js';
import { findOrCreateSupplierFromNFe, getSupplierByDocument } from '../suppliers/supplier.service.js';
import { requireDatabase } from '../../config/db.js';

/**
 * Configure XML Parser for NF-e (XML SEFAZ padrão brasileiro)
 */
function createNFeParser() {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
    parseTagValue: false // keep strings so codes and numbers don't lose formatting
  });
}

/**
 * Helper to locate the <infNFe> root within various standard NF-e XML wrappers
 */
function extractInfNFe(parsedXml) {
  if (!parsedXml) return null;

  // Case 1: <nfeProc><NFe><infNFe> (authorized NF-e file)
  if (parsedXml.nfeProc?.NFe?.infNFe) {
    return parsedXml.nfeProc.NFe.infNFe;
  }

  // Case 2: <NFe><infNFe>
  if (parsedXml.NFe?.infNFe) {
    return parsedXml.NFe.infNFe;
  }

  // Case 3: <infNFe> directly
  if (parsedXml.infNFe) {
    return parsedXml.infNFe;
  }

  // Case 4: Deep search for infNFe key
  for (const key of Object.keys(parsedXml)) {
    if (parsedXml[key]?.infNFe) {
      return parsedXml[key].infNFe;
    }
  }

  return null;
}

/**
 * Clean barcode value from NF-e cEAN tag
 */
function sanitizeBarcode(cEAN, defaultFallback = '') {
  const val = String(cEAN || '').trim();
  if (!val || val.toUpperCase() === 'SEM GTIN' || val.toUpperCase() === 'SEM_GTIN') {
    return defaultFallback;
  }
  return val;
}

/**
 * Parse and preview NF-e XML content
 */
export async function previewNFeXML(xmlContent) {
  requireDatabase();

  if (!xmlContent || typeof xmlContent !== 'string') {
    throw new Error('Conteúdo do arquivo XML não informado ou inválido.');
  }

  const parser = createNFeParser();
  let parsed;
  try {
    parsed = parser.parse(xmlContent);
  } catch (err) {
    throw new Error(`Falha ao ler XML da NF-e: ${err.message}`);
  }

  const infNFe = extractInfNFe(parsed);
  if (!infNFe) {
    throw new Error('Estrutura de NF-e inválida. A tag <infNFe> não foi encontrada no arquivo.');
  }

  // 1. Extract Invoice Details
  const ide = infNFe.ide || {};
  const total = infNFe.total?.ICMSTot || {};
  const invoice = {
    nNF: String(ide.nNF || ''),
    serie: String(ide.serie || '1'),
    dhEmi: ide.dhEmi || ide.dEmi || new Date().toISOString(),
    natOp: ide.natOp || 'Compra para Comercialização / Industrialização',
    vNF: parseFloat(total.vNF || '0') || 0,
    vProd: parseFloat(total.vProd || '0') || 0
  };

  // 2. Extract Supplier Details from <emit>
  const emit = infNFe.emit || {};
  const emitDoc = String(emit.CNPJ || emit.CPF || '').trim();
  const emitAddress = emit.enderEmit || {};

  const supplierData = {
    CNPJ: emit.CNPJ ? String(emit.CNPJ) : '',
    CPF: emit.CPF ? String(emit.CPF) : '',
    document: emitDoc,
    name: emit.xNome || 'Fornecedor da NF-e',
    tradeName: emit.xFant || emit.xNome || '',
    stateRegistration: emit.IE ? String(emit.IE) : '',
    email: emit.email || '',
    phone: emitAddress.fone ? String(emitAddress.fone) : '',
    enderEmit: emitAddress,
    address: {
      street: emitAddress.xLgr || '',
      number: emitAddress.nro || '',
      complement: emitAddress.xCpl || '',
      neighborhood: emitAddress.xBairro || '',
      city: emitAddress.xMun || '',
      state: emitAddress.UF || '',
      zipCode: emitAddress.CEP ? String(emitAddress.CEP) : ''
    }
  };

  // Check if supplier already exists in database
  let existingSupplier = null;
  if (emitDoc) {
    existingSupplier = await getSupplierByDocument(emitDoc);
  }

  // 3. Extract and Map Items from <det>
  const rawDet = infNFe.det;
  const detList = Array.isArray(rawDet) ? rawDet : rawDet ? [rawDet] : [];

  if (detList.length === 0) {
    throw new Error('A NF-e informada não contém itens de produto na tag <det>.');
  }

  // Fetch all active products once for fast matching
  const allActiveProducts = await Product.find({ active: true }).lean();

  const previewItems = [];
  let itemIndex = 1;

  for (const det of detList) {
    const prod = det.prod || {};
    const cProd = String(prod.cProd || '').trim();
    const xProd = String(prod.xProd || '').trim();
    const cEAN = sanitizeBarcode(prod.cEAN);
    const ncm = String(prod.NCM || '').trim();
    const uCom = String(prod.uCom || 'UN').trim().toUpperCase();
    const qCom = parseFloat(prod.qCom || '1') || 1;
    const vUnCom = parseFloat(prod.vUnCom || '0') || 0;
    const vProd = parseFloat(prod.vProd || String(qCom * vUnCom)) || (qCom * vUnCom);

    // Try matching with existing products in Bansir:
    // 1. By barcode (GTIN)
    // 2. By SKU / cProd
    // 3. By exact name
    let matched = null;
    if (cEAN) {
      matched = allActiveProducts.find(p => p.barcode === cEAN);
    }
    if (!matched && cProd) {
      matched = allActiveProducts.find(p => p.sku === cProd);
    }
    if (!matched && xProd) {
      const xProdNorm = xProd.toLowerCase().trim();
      matched = allActiveProducts.find(p => p.name.toLowerCase().trim() === xProdNorm);
    }

    // Default markup recommendation: 60% or existing product markup
    let defaultMarkup = 60;
    let initialPrice = Number((vUnCom * 1.6).toFixed(2));

    if (matched) {
      if (matched.costPrice > 0 && matched.price > matched.costPrice) {
        defaultMarkup = Number((((matched.price - matched.costPrice) / matched.costPrice) * 100).toFixed(1));
      }
      initialPrice = matched.price;
    }

    if (initialPrice < vUnCom) {
      initialPrice = Number((vUnCom * 1.5).toFixed(2));
    }

    previewItems.push({
      itemIndex,
      cProd,
      xProd,
      cEAN: cEAN || '',
      ncm,
      uCom,
      qCom,
      vUnCom,
      vProd,
      action: matched ? 'update' : 'create', // 'update' (atualizar estoque) | 'create' (novo produto)
      matchedProduct: matched ? {
        _id: matched._id,
        name: matched.name,
        barcode: matched.barcode,
        sku: matched.sku,
        stock: matched.stock,
        costPrice: matched.costPrice,
        price: matched.price,
        category: matched.category
      } : null,
      suggestedPrice: initialPrice,
      markupPercent: defaultMarkup,
      category: matched ? matched.category : 'Materia-Prima',
      barcodeToUse: cEAN || (matched ? matched.barcode : `BSR-${cProd || Date.now()}-${itemIndex}`)
    });

    itemIndex++;
  }

  return {
    invoice,
    supplier: {
      ...supplierData,
      isRegistered: !!existingSupplier,
      registeredId: existingSupplier ? existingSupplier._id : null
    },
    items: previewItems,
    totalItems: previewItems.length
  };
}

/**
 * Confirm and batch import NF-e items into Products & Inventory
 */
export async function confirmNFeImport(importData, operatorUser) {
  requireDatabase();

  const { supplier, invoice, items } = importData;
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('Nenhum item selecionado para importação.');
  }

  // 1. Ensure Supplier exists or create
  let targetSupplier = null;
  if (supplier?.registeredId) {
    targetSupplier = await Supplier.findById(supplier.registeredId);
  } else if (supplier?.document) {
    targetSupplier = await findOrCreateSupplierFromNFe(supplier);
  }

  const results = {
    createdCount: 0,
    updatedCount: 0,
    totalProcessed: 0,
    createdProducts: [],
    updatedProducts: [],
    supplier: targetSupplier ? { id: targetSupplier._id, name: targetSupplier.name } : null
  };

  // 2. Process each item
  for (const item of items) {
    const qty = Math.max(1, Math.round(Number(item.qCom || 1)));
    const costPrice = Math.max(0, parseFloat(item.vUnCom || 0));
    const salePrice = Math.max(0.01, parseFloat(item.price || item.suggestedPrice || costPrice * 1.5));
    const barcode = String(item.barcode || item.barcodeToUse || '').trim();
    const productName = String(item.name || item.xProd || 'Produto sem nome').trim();
    const category = item.category || 'Materia-Prima';
    const unit = item.uCom || item.unit || 'UN';
    const sku = item.cProd || item.sku || '';
    const ncm = item.ncm || '';

    if (item.action === 'update' && item.productId) {
      // UPDATE EXISTING PRODUCT STOCK AND COST
      const product = await Product.findById(item.productId);
      if (product) {
        const previousStock = product.stock;
        product.stock = previousStock + qty;
        product.costPrice = costPrice;
        if (salePrice && salePrice > 0) {
          product.price = salePrice;
        }
        if (targetSupplier && !product.supplierId) {
          product.supplierId = targetSupplier._id;
        }
        if (ncm && !product.ncm) {
          product.ncm = ncm;
        }
        await product.save();

        // Register Stock Movement
        await StockMovement.create({
          productId: product._id,
          productName: product.name,
          type: 'in',
          quantity: qty,
          unitPrice: costPrice,
          reason: `Entrada NF-e nº ${invoice?.nNF || 'S/N'} (${targetSupplier?.name || 'Fornecedor'})`,
          notes: `NF-e Série ${invoice?.serie || '1'} | Custo Un.: R$ ${costPrice.toFixed(2)} | Novo Estoque: ${product.stock}`,
          userName: operatorUser?.name || 'Importador NF-e'
        });

        results.updatedCount++;
        results.updatedProducts.push({
          id: product._id,
          name: product.name,
          previousStock,
          newStock: product.stock
        });
      }
    } else {
      // CREATE NEW PRODUCT
      // Ensure unique barcode
      let finalBarcode = barcode;
      if (!finalBarcode) {
        finalBarcode = `BSR-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
      }

      // Check if barcode already exists; if so, append random suffix to avoid collision
      const existingWithBarcode = await Product.findOne({ barcode: finalBarcode });
      if (existingWithBarcode) {
        finalBarcode = `${finalBarcode}-${Math.floor(Math.random() * 1000)}`;
      }

      const newProduct = await Product.create({
        name: productName,
        barcode: finalBarcode,
        category,
        price: salePrice,
        costPrice,
        stock: qty,
        unit,
        sku,
        ncm,
        artisan: targetSupplier?.name || 'Fornecedor Externo',
        supplierId: targetSupplier ? targetSupplier._id : null,
        specs: `Importado via NF-e nº ${invoice?.nNF || 'S/N'} - Série ${invoice?.serie || '1'}`
      });

      // Register Stock Movement for initial inventory
      await StockMovement.create({
        productId: newProduct._id,
        productName: newProduct.name,
        type: 'in',
        quantity: qty,
        unitPrice: costPrice,
        reason: `Cadastro & Entrada NF-e nº ${invoice?.nNF || 'S/N'} (${targetSupplier?.name || 'Fornecedor'})`,
        notes: `Cadastro via XML NF-e | Custo Un.: R$ ${costPrice.toFixed(2)} | Preço Venda: R$ ${salePrice.toFixed(2)}`,
        userName: operatorUser?.name || 'Importador NF-e'
      });

      results.createdCount++;
      results.createdProducts.push({
        id: newProduct._id,
        name: newProduct.name,
        stock: newProduct.stock,
        barcode: newProduct.barcode
      });
    }

    results.totalProcessed++;
  }

  return results;
}
