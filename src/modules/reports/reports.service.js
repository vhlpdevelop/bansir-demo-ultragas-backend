import mongoose from 'mongoose';
import { Sale } from '../sales/sale.model.js';
import { Product, Category } from '../products/product.model.js';
import { StockMovement } from '../products/stock-movement.model.js';
import { StoreSettings } from '../settings/settings.model.js';
import { ROLE_HIERARCHY } from '../users/user.model.js';
import { Employee } from '../employees/employee.model.js';
import { Voucher } from '../vouchers/voucher.model.js';
import { requireDatabase } from '../../config/db.js';

// Helper to safely format numbers with 2 decimals
export const round2 = (val) => Math.round((Number(val) || 0) * 100) / 100;

/**
 * Normalizes start and end dates respecting timezone and end of day.
 */
export function normalizeDateRange(startDateStr, endDateStr) {
  const now = new Date();

  function parseDate(str, isEnd = false) {
    if (!str) return null;
    if (typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str.trim())) {
      const [y, m, d] = str.trim().split('-').map(Number);
      return isEnd ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
    }
    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  let start = parseDate(startDateStr, false) || new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  let end = parseDate(endDateStr, true) || new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // If start is after end, swap them
  if (start > end) {
    const temp = start;
    start = end;
    end = temp;
  }

  return { start, end };
}

/**
 * Calculates previous equivalent time period for comparisons.
 */
export function getPreviousPeriod(start, end) {
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { start: prevStart, end: prevEnd };
}

/**
 * Fetches store establishment information.
 */
export async function getStoreEstablishment() {
  try {
    const store = await StoreSettings.findById('store').lean();
    if (store && store.storeName) {
      return {
        name: store.storeName,
        documentId: store.documentId || 'Não informado',
        address: store.address || 'Não informado',
        city: store.merchantCity || 'São Paulo - SP'
      };
    }
  } catch (err) {}
  return {
    name: 'Bansir Ateliê & Varejo',
    documentId: '34.892.102/0001-90',
    address: 'Rua dos Oleiros, 142',
    city: 'São Paulo - SP'
  };
}

/**
 * Generates the complete analytical data and summary for all modalities.
 */
export async function getReportsSummary(filters = {}, currentUser = null) {
  requireDatabase();

  const { start, end } = normalizeDateRange(filters.startDate, filters.endDate);
  const prevPeriod = getPreviousPeriod(start, end);
  const estabelecimento = await getStoreEstablishment();
  const establishment = estabelecimento;

  const dateReference = filters.dateReference === 'dtCaixa' ? 'dtCaixa' : 'dtEmissao';
  const inactiveDays = Math.max(1, parseInt(filters.inactiveDays, 10) || 30);

  // 1. Build Sales MongoDB Query
  const saleQuery = {
    date: { $gte: start, $lte: end }
  };

  if (filters.seller) {
    saleQuery.sellerName = filters.seller;
  }
  if (filters.paymentMethod) {
    saleQuery.paymentMethod = filters.paymentMethod;
  }
  if (filters.saleStatus) {
    saleQuery.status = filters.saleStatus;
  }
  if (filters.product) {
    saleQuery.productName = new RegExp(filters.product.trim(), 'i');
  }

  // Previous period sales query
  const prevSaleQuery = {
    date: { $gte: prevPeriod.start, $lte: prevPeriod.end }
  };
  if (filters.seller) prevSaleQuery.sellerName = filters.seller;
  if (filters.paymentMethod) prevSaleQuery.paymentMethod = filters.paymentMethod;
  if (filters.saleStatus) prevSaleQuery.status = filters.saleStatus;

  // Execute concurrent queries
  const [currentSales, prevSales, allProducts, stockMovementsPeriod, allStockMovements, categoriesList, allEmployees, currentVouchers] = await Promise.all([
    Sale.find(saleQuery).sort({ date: -1 }).lean(),
    Sale.find(prevSaleQuery).lean(),
    Product.find({ active: true }).lean(),
    StockMovement.find({ date: { $gte: start, $lte: end } }).lean(),
    StockMovement.find().sort({ date: -1 }).lean(),
    Category.find().lean(),
    Employee.find().lean(),
    Voucher.find({ issuedAt: { $gte: start, $lte: end } }).sort({ issuedAt: -1 }).lean()
  ]);

  // Product lookup map for quick access
  const productMap = new Map();
  allProducts.forEach(p => {
    productMap.set(String(p._id), p);
    if (p.barcode) productMap.set(p.barcode, p);
    productMap.set(p.name.toLowerCase().trim(), p);
  });

  // Category color / meta map
  const categoryMap = new Map();
  categoriesList.forEach(c => categoryMap.set(c.name, c));

  // ==========================================
  // A. VENDAS (SALES REPORT CALCULATION)
  // ==========================================
  function computeSalesMetrics(salesList) {
    let valorBruto = 0;
    let descontos = 0;
    let cancelamentosDevolucoes = 0;
    let qtdVendasConcluidas = 0;
    let qtdItensVendidos = 0;
    let cmvTotal = 0;

    const sellerBreakdown = {};
    const categoryBreakdown = {};
    const paymentBreakdown = {};
    const productAgg = {};

    salesList.forEach(s => {
      const isCancelled = s.status === 'cancelled';
      const isReturned = s.status === 'returned';

      const subtotal = Number(s.subtotal) || 0;
      const discount = Number(s.discountAmount) || 0;
      const total = Number(s.totalAmount) || (subtotal - discount);
      const qty = Number(s.quantity) || 1;

      if (isCancelled || isReturned) {
        cancelamentosDevolucoes += round2(total);
        return; // Exclude cancelled from gross sales totals
      }

      valorBruto += round2(subtotal);
      descontos += round2(discount);
      qtdVendasConcluidas += 1;
      qtdItensVendidos += qty;

      // Cost of goods sold (CMV) calculation
      const prod = s.productId ? productMap.get(String(s.productId)) : productMap.get(s.productName?.toLowerCase().trim());
      const itemCost = prod && Number(prod.costPrice) > 0 ? Number(prod.costPrice) : 0;
      cmvTotal += round2(qty * itemCost);

      // Seller breakdown
      const seller = s.sellerName || 'Balcão Geral';
      if (!sellerBreakdown[seller]) {
        sellerBreakdown[seller] = { seller, count: 0, valorBruto: 0, descontos: 0, valorLiquido: 0, itens: 0 };
      }
      sellerBreakdown[seller].count += 1;
      sellerBreakdown[seller].valorBruto += round2(subtotal);
      sellerBreakdown[seller].descontos += round2(discount);
      sellerBreakdown[seller].valorLiquido += round2(total);
      sellerBreakdown[seller].itens += qty;

      // Category breakdown
      const cat = prod?.category || 'Cerâmica & Barro';
      if (!categoryBreakdown[cat]) {
        categoryBreakdown[cat] = { category: cat, count: 0, valorLiquido: 0, itens: 0 };
      }
      categoryBreakdown[cat].count += 1;
      categoryBreakdown[cat].valorLiquido += round2(total);
      categoryBreakdown[cat].itens += qty;

      // Payment breakdown
      const pay = s.paymentMethod || 'pix';
      if (!paymentBreakdown[pay]) {
        paymentBreakdown[pay] = { paymentMethod: pay, count: 0, valorTotal: 0 };
      }
      paymentBreakdown[pay].count += 1;
      paymentBreakdown[pay].valorTotal += round2(total);

      // Product sales rank
      const pKey = s.productName || 'Produto Avulso';
      if (!productAgg[pKey]) {
        productAgg[pKey] = {
          name: pKey,
          barcode: s.barcode || prod?.barcode || 'Não informado',
          category: cat,
          quantity: 0,
          revenue: 0,
          unitPrice: Number(s.unitPrice) || 0
        };
      }
      productAgg[pKey].quantity += qty;
      productAgg[pKey].revenue += round2(total);
    });

    const valorLiquido = round2(valorBruto - descontos - cancelamentosDevolucoes);
    const ticketMedio = qtdVendasConcluidas > 0 ? round2(valorLiquido / qtdVendasConcluidas) : 0;
    const lucroBruto = round2(valorLiquido - cmvTotal);
    const margemBrutaPercentual = valorLiquido > 0 ? round2((lucroBruto / valorLiquido) * 100) : 0;

    return {
      valorBruto: round2(valorBruto),
      descontos: round2(descontos),
      cancelamentosDevolucoes: round2(cancelamentosDevolucoes),
      cancelamentosEDevolucoes: round2(cancelamentosDevolucoes),
      valorLiquido: Math.max(0, valorLiquido),
      qtdVendas: qtdVendasConcluidas,
      qtdItens: qtdItensVendidos,
      qtdItensVendidos,
      ticketMedio: round2(ticketMedio),
      cmvTotal: round2(cmvTotal),
      lucroBruto: round2(lucroBruto),
      margemBrutaPercentual,
      sellerBreakdown: Object.values(sellerBreakdown).sort((a, b) => b.valorLiquido - a.valorLiquido),
      porVendedor: Object.values(sellerBreakdown).sort((a, b) => b.valorLiquido - a.valorLiquido).map(s => ({
        nome: s.seller,
        vendas: s.count,
        itens: s.itens,
        total: s.valorLiquido,
        ticketMedio: round2(s.valorLiquido / (s.count || 1))
      })),
      categoryBreakdown: Object.values(categoryBreakdown).sort((a, b) => b.valorLiquido - a.valorLiquido),
      porCategoria: Object.values(categoryBreakdown).sort((a, b) => b.valorLiquido - a.valorLiquido).map(c => ({
        categoria: c.category,
        itens: c.itens,
        total: c.valorLiquido
      })),
      paymentBreakdown: Object.values(paymentBreakdown).sort((a, b) => b.valorTotal - a.valorTotal),
      porFormaPagamento: Object.values(paymentBreakdown).sort((a, b) => b.valorTotal - a.valorTotal).map(p => ({
        metodo: p.paymentMethod,
        qtd: p.count,
        total: p.valorTotal
      })),
      topProductsByQty: Object.values(productAgg).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
      topProdutosQtd: Object.values(productAgg).sort((a, b) => b.quantity - a.quantity).slice(0, 10).map(p => ({
        nome: p.name,
        qtd: p.quantity,
        total: p.revenue
      })),
      topProductsByRevenue: Object.values(productAgg).sort((a, b) => b.revenue - a.revenue).slice(0, 10),
      topProdutosFaturamento: Object.values(productAgg).sort((a, b) => b.revenue - a.revenue).slice(0, 10).map(p => ({
        nome: p.name,
        qtd: p.quantity,
        total: p.revenue
      }))
    };
  }

  const salesMetricsCurrent = computeSalesMetrics(currentSales);
  const salesMetricsPrev = computeSalesMetrics(prevSales);

  // Comparison between current and previous period
  function calcDiff(curr, prev) {
    const diffAbs = round2(curr - prev);
    const diffPct = prev > 0 ? round2(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0);
    return { current: curr, previous: prev, diffAbs, diffPct };
  }

  const comparativoPeriodoAnterior = {
    periodoAtual: { start, end },
    periodoAnterior: { start: prevPeriod.start, end: prevPeriod.end },
    valorLiquido: calcDiff(salesMetricsCurrent.valorLiquido, salesMetricsPrev.valorLiquido),
    qtdVendas: calcDiff(salesMetricsCurrent.qtdVendas, salesMetricsPrev.qtdVendas),
    ticketMedio: calcDiff(salesMetricsCurrent.ticketMedio, salesMetricsPrev.ticketMedio),
    qtdItens: calcDiff(salesMetricsCurrent.qtdItens, salesMetricsPrev.qtdItens)
  };

  // Detailed sales items table
  const vendasDetalhadas = currentSales.map(s => {
    const prod = s.productId ? productMap.get(String(s.productId)) : productMap.get(s.productName?.toLowerCase().trim());
    const isCancelled = s.status === 'cancelled';
    const isReturned = s.status === 'returned';
    const situacaoVenda = isCancelled ? 'Cancelada' : isReturned ? 'Devolução' : 'Concluída';

    let documentoFiscalVinculado = 'Não emitido (Pendente SEFAZ)';
    if (s.invoiceIssued && s.invoiceNumber) {
      documentoFiscalVinculado = `Doc #${s.invoiceNumber}`;
    }

    return {
      id: String(s._id),
      vendaNumero: s.saleNumber,
      identificacao: s.saleNumber,
      dataHora: s.date,
      estabelecimento: establishment.name,
      vendedor: s.sellerName || 'Balcão Geral',
      produto: s.productName,
      sku: prod?.sku || prod?.barcode || s.barcode || 'S/N',
      codigoBarras: s.barcode || prod?.barcode || 'S/N',
      skuBarcode: s.barcode || prod?.barcode || prod?.sku || 'Não informado',
      categoria: prod?.category || 'Geral',
      quantidade: Number(s.quantity) || 1,
      valorUnitario: round2(Number(s.unitPrice) || 0),
      valorBruto: round2(Number(s.subtotal) || 0),
      desconto: round2(Number(s.discountAmount) || 0),
      descontoItem: round2(Number(s.discountAmount) || 0),
      totalLiquido: round2(Number(s.totalAmount) || 0),
      totalItem: round2(Number(s.totalAmount) || 0),
      formaPagamento: s.paymentMethod || 'pix',
      situacaoVenda,
      documentoFiscalVinculado,
      docFiscalVinculado: {
        nrNFCe: (s.invoiceIssued && s.invoiceNumber) ? s.invoiceNumber : null
      },
      financialStatus: s.financialStatus || 'posted'
    };
  });

  // ==========================================
  // B. ESTOQUE (STOCK REPORT CALCULATION)
  // ==========================================
  let totalEstoqueUnidades = 0;
  let valorEstoqueCusto = 0;
  let valorEstoqueVendaEstimado = 0;
  let produtosZerados = 0;
  let produtosAbaixoMinimo = 0;

  // Track latest movement date per product
  const latestMovementMap = new Map();
  allStockMovements.forEach(m => {
    const pId = String(m.productId);
    if (!latestMovementMap.has(pId)) {
      latestMovementMap.set(pId, m);
    }
  });

  // Movements inside the filter period
  const movementsInPeriodMap = new Map();
  stockMovementsPeriod.forEach(m => {
    const pId = String(m.productId);
    if (!movementsInPeriodMap.has(pId)) {
      movementsInPeriodMap.set(pId, { entradasQtd: 0, entradasValor: 0, saidasQtd: 0, saidasValor: 0 });
    }
    const item = movementsInPeriodMap.get(pId);
    if (m.type === 'in') {
      item.entradasQtd += m.quantity;
      item.entradasValor += round2(m.quantity * (m.unitPrice || 0));
    } else {
      item.saidasQtd += m.quantity;
      item.saidasValor += round2(m.quantity * (m.unitPrice || 0));
    }
  });

  const nowMs = Date.now();
  const inactiveThresholdMs = nowMs - (inactiveDays * 24 * 60 * 60 * 1000);
  const produtosParados = [];

  const estoqueDetalhamento = allProducts.map(p => {
    const stock = Number(p.stock) || 0;
    const cost = Number(p.costPrice) || 0;
    const price = Number(p.price) || 0;
    const minStock = 5; // standard minimum threshold

    totalEstoqueUnidades += stock;
    valorEstoqueCusto += round2(stock * cost);
    valorEstoqueVendaEstimado += round2(stock * price);

    let statusEstoque = 'Normal';
    if (stock === 0) {
      statusEstoque = 'Zerado';
      produtosZerados += 1;
    } else if (stock <= minStock) {
      statusEstoque = 'Crítico / Baixo';
      produtosAbaixoMinimo += 1;
    }

    const lastMove = latestMovementMap.get(String(p._id));
    const lastMoveDate = lastMove ? new Date(lastMove.date) : new Date(p.updatedAt || p.createdAt || nowMs);
    const diasSemMovimento = Math.floor((nowMs - lastMoveDate.getTime()) / (1000 * 60 * 60 * 24));

    if (stock > 0 && lastMoveDate.getTime() < inactiveThresholdMs) {
      produtosParados.push({
        name: p.name,
        category: p.category,
        stock,
        costPrice: cost,
        totalCost: round2(stock * cost),
        price,
        diasSemMovimento,
        lastMoveDate
      });
    }

    const periodMoves = movementsInPeriodMap.get(String(p._id)) || { entradasQtd: 0, entradasValor: 0, saidasQtd: 0, saidasValor: 0 };

    return {
      id: String(p._id),
      nome: p.name,
      barcode: p.barcode,
      sku: p.sku || 'Não informado',
      categoria: p.category || 'Geral',
      unidade: p.unit || 'UN',
      saldoAtual: stock,
      estoqueAtual: stock,
      estoqueMinimo: minStock,
      statusEstoque,
      custoUnitario: cost,
      custoTotal: round2(stock * cost),
      valorTotalCusto: round2(stock * cost),
      precoVenda: price,
      precoVendaUnitario: price,
      precoVendaTotalEstimado: round2(stock * price),
      valorTotalVenda: round2(stock * price),
      entradasPeriodo: periodMoves.entradasQtd,
      saidasPeriodo: periodMoves.saidasQtd,
      diasSemMovimento,
      diasSemMovimentacao: diasSemMovimento,
      dataUltimaMovimentacao: lastMoveDate
    };
  });

  const margemPotencialEstoque = valorEstoqueVendaEstimado > 0
    ? round2(((valorEstoqueVendaEstimado - valorEstoqueCusto) / valorEstoqueVendaEstimado) * 100)
    : 0;

  const totalCapitalParadoCusto = produtosParados.reduce((acc, p) => acc + p.totalCost, 0);

  const estoqueMetrics = {
    dataReferenciaSaldo: new Date().toISOString(),
    dataHoraReferenciaSaldo: new Date().toISOString(),
    totalProdutosCadastrados: allProducts.length,
    totalUnidadesEstoque: totalEstoqueUnidades,
    valorTotalEstoqueCusto: round2(valorEstoqueCusto),
    valorPotencialVendaEstoque: round2(valorEstoqueVendaEstimado),
    margemPotencialEstoque,
    produtosZerados,
    produtosAbaixoMinimo,
    criterioDiasParados: inactiveDays,
    totalProdutosParados: produtosParados.length,
    produtosSemMovimentacao: produtosParados.length,
    totalCapitalParadoCusto: round2(totalCapitalParadoCusto),
    capitalParado: round2(totalCapitalParadoCusto),
    produtosParados: produtosParados.sort((a, b) => b.totalCost - a.totalCost)
  };

  // ==========================================
  // C. DOCUMENTOS FISCAIS (EXACT MANDATORY FIELDS)
  // ==========================================
  // As requested:
  // - Estabelecimento
  // - Num. Controle
  // - Nr NFCe/CFe
  // - Série
  // - Modelo
  // - Dt Emissão
  // - Hr Emissão
  // - Dt Caixa
  // - Identificador
  // - Vlr Produtos
  // - Iss
  // - Vlr Desc
  // - Vlr NF
  // - Status CX
  // - Situação
  // - Chave NF
  // - Gerado devolucao

  // Filter sales based on chosen reference (dtEmissao vs dtCaixa)
  const fiscalSales = currentSales.filter(s => {
    if (filters.tipoDocumento && filters.tipoDocumento !== 'todos') {
      // If user filters for specific model
      if (filters.tipoDocumento === '65' && s.invoiceIssued === false) return false;
    }
    if (filters.situacaoFiscal && filters.situacaoFiscal !== 'todos') {
      const currentSit = s.invoiceIssued ? 'Autorizado' : 'Não emitido';
      if (currentSit.toLowerCase() !== filters.situacaoFiscal.toLowerCase()) return false;
    }
    return true;
  });

  let totalVlrProdutosFiscal = 0;
  let totalVlrDescFiscal = 0;
  let totalVlrNFFiscal = 0;
  let docsAutorizados = 0;
  let docsNaoEmitidos = 0;
  let docsCancelados = 0;

  const documentosFiscaisDetalhados = fiscalSales.map(s => {
    const saleDate = new Date(s.date || s.createdAt);
    const dtCaixaStr = saleDate.toLocaleDateString('pt-BR');

    // Emissão date & time
    const dtEmissaoStr = s.invoiceIssued ? saleDate.toLocaleDateString('pt-BR') : 'Não emitida';
    const hrEmissaoStr = s.invoiceIssued ? saleDate.toLocaleTimeString('pt-BR') : 'Não disponível';

    // Model and Series
    // If real SEFAZ invoice was issued, model is 65 (NFC-e) or 55 (NF-e). If not issued, mark explicitly as not informed.
    const modelo = s.invoiceIssued ? '65 - NFC-e' : 'Não informado';
    const serie = s.invoiceIssued ? '1' : 'Não informado';
    const nrDoc = s.invoiceIssued && s.invoiceNumber ? s.invoiceNumber : 'Não informado';

    // Status do Caixa (Status CX)
    const statusCX = s.financialStatus === 'posted' ? 'Recebido / Quitado' : s.financialStatus === 'pending' ? 'Pendente' : 'Estornado';

    // Situação Fiscal
    let situacao = 'Não emitido (Pendente SEFAZ)';
    if (s.status === 'cancelled') {
      situacao = 'Cancelado';
      docsCancelados += 1;
    } else if (s.invoiceIssued) {
      situacao = 'Autorizado';
      docsAutorizados += 1;
    } else {
      docsNaoEmitidos += 1;
    }

    // Chave de Acesso (44 dígitos quando real, caso contrário Não gerada)
    const chaveNF = s.invoiceIssued && s.chaveAcesso
      ? s.chaveAcesso
      : 'Não gerada (Aguardando integração fiscal SEFAZ)';

    // Gerado devolução
    const geradoDevolucao = s.status === 'returned'
      ? (s.returnOriginalSaleId ? `Devolução de #${s.returnOriginalSaleId}` : 'Sim (Devolução de venda)')
      : 'Não';

    const subtotal = round2(Number(s.subtotal) || 0);
    const discount = round2(Number(s.discountAmount) || 0);
    const total = round2(Number(s.totalAmount) || 0);

    totalVlrProdutosFiscal += subtotal;
    totalVlrDescFiscal += discount;
    totalVlrNFFiscal += total;

    return {
      estabelecimento: `${establishment.name} - CNPJ: ${establishment.documentId}`,
      numControle: s.saleNumber,
      nrNFCeCFe: nrDoc,
      serie,
      modelo,
      dtEmissao: dtEmissaoStr,
      hrEmissao: hrEmissaoStr,
      dtCaixa: dtCaixaStr,
      identificador: String(s._id),
      vlrProdutos: subtotal,
      iss: 'Não aplicável (ICMS Varejo)', // Distinguishing municipal ISS from non-applicable retail
      vlrDesc: discount,
      vlrNF: total,
      statusCX,
      situacao,
      chaveNF,
      geradoDevolucao,
      rawSaleId: String(s._id)
    };
  });

  const fiscalMetrics = {
    referenciaPeriodo: dateReference === 'dtCaixa' ? 'Data de Caixa (Movimento)' : 'Data de Emissão',
    totalDocumentos: fiscalSales.length,
    docsAutorizados,
    docsNaoEmitidos,
    docsCancelados,
    totalVlrProdutos: round2(totalVlrProdutosFiscal),
    totalVlrDesc: round2(totalVlrDescFiscal),
    totalVlrNF: round2(totalVlrNFFiscal),
    divergenciaVendasXFiscal: {
      faturamentoVendas: salesMetricsCurrent.valorLiquido,
      faturamentoFiscalAutorizado: round2(
        documentosFiscaisDetalhados
          .filter(d => d.situacao === 'Autorizado')
          .reduce((acc, d) => acc + d.vlrNF, 0)
      ),
      notaExplicativa: 'As vendas registradas no balcão e os documentos fiscais autorizados são correlacionados mas não somados em duplicidade. A diferença representa vendas com emissão pendente ou cupons não integrados à SEFAZ.'
    }
  };

  // RBAC Cost & Margin Permission: Only users with hierarchy >= 2 or explicit financial/reports routes can view cost prices & gross margins
  const userLevel = currentUser?.role ? (ROLE_HIERARCHY[currentUser.role] || 0) : 4;
  const canViewFinancialCosts = userLevel >= 2 || 
    (Array.isArray(currentUser?.allowedRoutes) && (currentUser.allowedRoutes.includes('financial') || currentUser.allowedRoutes.includes('financial-intelligence') || currentUser.allowedRoutes.includes('reports')));

  if (!canViewFinancialCosts) {
    salesMetricsCurrent.cmvTotal = null;
    salesMetricsCurrent.lucroBruto = null;
    salesMetricsCurrent.margemBrutaPercentual = null;
    estoqueMetrics.valorTotalEstoqueCusto = null;
    estoqueMetrics.totalCapitalParadoCusto = null;
    estoqueMetrics.capitalParado = null;
    estoqueDetalhamento.forEach(p => {
      p.custoUnitario = null;
      p.custoTotal = null;
      p.valorTotalCusto = null;
    });
  }

  // ==========================================
  // D. CONSOLIDADO
  // ==========================================
  const consolidado = {
    periodo: { start, end },
    estabelecimento,
    resumoVendas: {
      valorBruto: salesMetricsCurrent.valorBruto,
      descontos: salesMetricsCurrent.descontos,
      valorLiquido: salesMetricsCurrent.valorLiquido,
      qtdVendas: salesMetricsCurrent.qtdVendas,
      ticketMedio: salesMetricsCurrent.ticketMedio,
      cmvTotal: salesMetricsCurrent.cmvTotal,
      lucroBruto: salesMetricsCurrent.lucroBruto,
      margemBrutaPercentual: salesMetricsCurrent.margemBrutaPercentual
    },
    resumoEstoque: {
      totalItens: estoqueMetrics.totalUnidadesEstoque,
      valorCusto: estoqueMetrics.valorTotalEstoqueCusto,
      valorVendaEstimado: estoqueMetrics.valorPotencialVendaEstoque,
      margemPotencial: estoqueMetrics.margemPotencialEstoque,
      alertasReposicao: estoqueMetrics.produtosAbaixoMinimo + estoqueMetrics.produtosZerados,
      capitalParado: estoqueMetrics.totalCapitalParadoCusto
    },
    resumoFiscal: {
      totalDocumentos: fiscalMetrics.totalDocumentos,
      autorizados: fiscalMetrics.docsAutorizados,
      pendentes: fiscalMetrics.docsNaoEmitidos,
      cancelados: fiscalMetrics.docsCancelados,
      totalValorFiscal: fiscalMetrics.totalVlrNF
    }
  };

  // ==========================================
  // E. FUNCIONÁRIOS & COMISSÕES
  // ==========================================
  const employeeMetrics = {
    totalFuncionarios: allEmployees.length,
    comissoesPorFuncionario: allEmployees.map(emp => {
      // Find sales for this employee in the current period
      const empSales = currentSales.filter(s => s.sellerName === emp.name && s.status === 'completed');
      const totalVendido = empSales.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
      const totalItens = empSales.reduce((acc, s) => acc + (Number(s.quantity) || 0), 0);
      
      let comissaoEstimada = 0;
      if (emp.commissionType === 'percentage') {
        comissaoEstimada = totalVendido * ((Number(emp.commissionValue) || 0) / 100);
      } else {
        // fixed amount per item
        comissaoEstimada = totalItens * (Number(emp.commissionValue) || 0);
      }

      return {
        id: String(emp._id),
        nome: emp.name,
        cargo: emp.roleTitle,
        salarioBase: Number(emp.baseSalary) || 0,
        tipoComissao: emp.commissionType,
        valorComissao: Number(emp.commissionValue) || 0,
        totalVendido: round2(totalVendido),
        totalItens,
        comissaoEstimada: round2(comissaoEstimada)
      };
    }).sort((a, b) => b.totalVendido - a.totalVendido)
  };
  employeeMetrics.totalComissoesEstimadas = round2(employeeMetrics.comissoesPorFuncionario.reduce((acc, emp) => acc + emp.comissaoEstimada, 0));

  // ==========================================
  // F. VALES GÁS (VOUCHERS)
  // ==========================================
  const voucherMetrics = {
    totalEmitidos: currentVouchers.length,
    totalResgatados: currentVouchers.filter(v => v.status === 'REDEEMED').length,
    totalPendentes: currentVouchers.filter(v => v.status === 'ACTIVE').length,
    totalCancelados: currentVouchers.filter(v => v.status === 'CANCELLED').length,
    valorTotalEmitido: round2(currentVouchers.reduce((acc, v) => acc + (Number(v.totalAmount) || 0), 0)),
    detalhamento: currentVouchers.map(v => ({
      code: v.code,
      cliente: v.customerName,
      status: v.status,
      emitidoEm: v.issuedAt,
      emitidoPor: v.issuedByName || 'Sistema',
      origem: v.source || 'MANUAL',
      resgatadoEm: v.redeemedAt,
      resgatadoPor: v.redeemedByName || '',
      valor: Number(v.totalAmount) || 0
    }))
  };

  return {
    meta: {
      geradoEm: new Date().toISOString(),
      solicitante: currentUser?.name || 'Administrador',
      filtrosAplicados: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        dateReference,
        seller: filters.seller || 'Todos',
        paymentMethod: filters.paymentMethod || 'Todas',
        saleStatus: filters.saleStatus || 'Todas',
        tipoDocumento: filters.tipoDocumento || 'Todos',
        situacaoFiscal: filters.situacaoFiscal || 'Todas',
        inactiveDays
      }
    },
    estabelecimento,
    vendas: {
      resumo: salesMetricsCurrent,
      comparativo: comparativoPeriodoAnterior,
      detalhamento: vendasDetalhadas
    },
    estoque: {
      resumo: estoqueMetrics,
      detalhamento: estoqueDetalhamento
    },
    fiscal: {
      resumo: fiscalMetrics,
      detalhamento: documentosFiscaisDetalhados
    },
    funcionarios: employeeMetrics,
    vales: voucherMetrics,
    consolidado
  };
}
