import {
  getFinancialSummary,
  getAllTransactions,
  createTransaction,
  updateTransactionStatus
} from './financial.service.js';
import {
  getPricingIntelligenceData,
  updatePricingIntelligenceData,
  applySuggestedPriceToProduct
} from './pricing-intelligence.service.js';

export async function getSummary(req, res, next) {
  try {
    const summary = await getFinancialSummary();
    return res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

export async function listTransactions(req, res, next) {
  try {
    const { type, status } = req.query;
    const transactions = await getAllTransactions({ type, status });
    return res.json({
      success: true,
      data: transactions
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

export async function create(req, res, next) {
  try {
    const { title, type, category, amount, sellerName, artisanName, paymentMethod, notes, status, date, dueDate } = req.body;
    const tx = await createTransaction({ title, type, category, amount, sellerName: sellerName || artisanName || req.user.name,
      paymentMethod, notes, status, date, dueDate }, req.user._id || req.user.id);

    return res.status(201).json({
      success: true,
      message: 'Lançamento financeiro registrado com sucesso!',
      data: tx
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export async function updateStatus(req, res, next) {
  try {
    const { status } = req.body;
    const updated = await updateTransactionStatus(req.params.id, status);
    return res.json({
      success: true,
      message: 'Status da transação atualizado com sucesso!',
      data: updated
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export async function getPricingIntelligence(req, res, next) {
  try {
    const data = await getPricingIntelligenceData();
    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

export async function updatePricingIntelligence(req, res, next) {
  try {
    const data = await updatePricingIntelligenceData(req.body);
    return res.json({
      success: true,
      message: 'Configurações de inteligência de precificação salvas com sucesso!',
      data
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export async function applyPrice(req, res, next) {
  try {
    const { productId, newPrice } = req.body;
    const updatedProduct = await applySuggestedPriceToProduct(productId, newPrice);
    return res.json({
      success: true,
      message: `Preço atualizado com sucesso no catálogo para R$ ${Number(newPrice).toFixed(2)}!`,
      data: updatedProduct
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}
