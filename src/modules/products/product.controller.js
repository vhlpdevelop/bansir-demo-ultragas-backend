import { 
  getAllProducts, 
  searchProducts, 
  getProductByBarcode, 
  createProduct,
  updateProduct,
  deleteProduct,
  getAllCategories,
  createCategory,
  deleteCategory,
  registerStockMovement,
  getStockSummary
} from './product.service.js';

export async function list(req, res, next) {
  try {
    const { q, barcode } = req.query;

    if (barcode) {
      const product = await getProductByBarcode(barcode);
      return res.json({
        success: true,
        data: product ? [product] : []
      });
    }

    if (q) {
      const results = await searchProducts(q);
      return res.json({
        success: true,
        data: results
      });
    }

    const all = await getAllProducts();
    return res.json({
      success: true,
      data: all
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

export async function getByBarcode(req, res, next) {
  try {
    const product = await getProductByBarcode(req.params.barcode);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Nenhum produto encontrado com este código de barras.'
      });
    }
    return res.json({
      success: true,
      data: product
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

export async function create(req, res, next) {
  try {
    const { name, barcode, price, category, stock, costPrice, artisan, specs, sku } = req.body;
    if (!name || !barcode || !price) {
      return res.status(400).json({
        success: false,
        message: 'Nome, código de barras e preço de venda são obrigatórios.'
      });
    }

    const prod = await createProduct({
      name,
      barcode,
      price: Number(price),
      category: category || 'Cerâmica & Barro',
      stock: Number(stock) || 1,
      costPrice: Number(costPrice) || 0,
      artisan: artisan || 'Ateliê Bansir Bonito',
      specs: specs || '',
      sku: sku || ''
    });

    return res.status(201).json({
      success: true,
      message: 'Peça artesanal cadastrada com sucesso!',
      data: prod
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function listCategories(req, res, next) {
  try {
    const categories = await getAllCategories();
    return res.json({
      success: true,
      data: categories
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

export async function addCategory(req, res, next) {
  try {
    const { name, description, color } = req.body;
    if (!name || name.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'O nome da categoria é obrigatório.'
      });
    }

    const cat = await createCategory({
      name: name.trim(),
      description: description || '',
      color: color || '#c85a32'
    });

    return res.status(201).json({
      success: true,
      message: 'Categoria criada com sucesso!',
      data: cat
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function removeCategory(req, res, next) {
  try {
    const { id } = req.params;
    const ok = await deleteCategory(id);
    if (!ok) {
      return res.status(404).json({
        success: false,
        message: 'Categoria não encontrada.'
      });
    }

    return res.json({
      success: true,
      message: 'Categoria removida com sucesso!'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

// Product Update
export async function update(req, res, next) {
  try {
    const updated = await updateProduct(req.params.id, req.body);
    return res.json({
      success: true,
      message: 'Produto atualizado com sucesso!',
      data: updated
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

// Product Delete
export async function remove(req, res, next) {
  try {
    await deleteProduct(req.params.id);
    return res.json({
      success: true,
      message: 'Produto removido com sucesso!'
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

// Stock Summary & Low Stock Dashboard
export async function stockSummary(req, res, next) {
  try {
    const summary = await getStockSummary();
    return res.json({
      success: true,
      data: summary
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

// Record Stock Movement (In / Out)
export async function recordStockMovement(req, res, next) {
  try {
    const { productId, type, quantity, reason, notes } = req.body;
    if (!productId || !quantity) {
      return res.status(400).json({
        success: false,
        message: 'Produto e quantidade são obrigatórios.'
      });
    }

    const result = await registerStockMovement({
      productId,
      type,
      quantity,
      reason,
      notes,
      user: req.user
    });

    return res.status(201).json({
      success: true,
      message: type === 'out' 
        ? `Saída de ${quantity} unidade(s) registrada com sucesso.`
        : `Entrada de ${quantity} unidade(s) registrada no estoque.`,
      data: result
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

// Preview NF-e XML import
export async function previewNFe(req, res, next) {
  try {
    const xmlContent = typeof req.body === 'string' ? req.body : req.body?.xmlContent;
    if (!xmlContent || typeof xmlContent !== 'string' || !xmlContent.trim()) {
      return res.status(400).json({
        success: false,
        message: 'O conteúdo XML da NF-e é obrigatório.'
      });
    }

    const preview = await (await import('./nfe-import.service.js')).previewNFeXML(xmlContent);
    return res.json({
      success: true,
      data: preview
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

// Confirm and process batch NF-e import
export async function confirmNFe(req, res, next) {
  try {
    const importData = req.body;
    if (!importData || !importData.items) {
      return res.status(400).json({
        success: false,
        message: 'Dados da importação e lista de itens são obrigatórios.'
      });
    }

    const result = await (await import('./nfe-import.service.js')).confirmNFeImport(importData, req.user);
    return res.json({
      success: true,
      message: `Importação concluída com sucesso! ${result.createdCount} peças cadastradas e ${result.updatedCount} estoques atualizados.`,
      data: result
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}


