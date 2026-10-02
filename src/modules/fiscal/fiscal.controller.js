import { 
  emitNFCeForSale, 
  getFiscalConfig, 
  updateFiscalConfig, 
  listInvoices, getInvoice 
} from './fiscal.service.js';

// POST /api/v1/fiscal/emit-nfce
export async function handleEmitNFCe(req, res) {
  try {
    const { 
      saleId, 
      saleNumber, 
      productName, 
      productId, 
      barcode, 
      quantity, 
      unitPrice, 
      totalAmount, 
      discountAmount, 
      paymentMethod,
      customerCpf,
      customerName,
      sellerName
    } = req.body;

    if (!productName || unitPrice === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Produto e valor são obrigatórios para emitir NFC-e.'
      });
    }

    const invoice = await emitNFCeForSale({
      saleId,
      saleNumber,
      productName,
      productId,
      barcode,
      quantity,
      unitPrice,
      totalAmount,
      discountAmount,
      paymentMethod,
      customerCpf,
      customerName,
      sellerName
    });

    return res.status(201).json({
      success: true,
      message: `NFC-e nº ${invoice.numeroNota} autorizada com sucesso! Estoque atualizado.`,
      data: invoice
    });
  } catch (err) {
    console.error('[Fiscal Controller] Erro ao emitir NFC-e:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Erro ao processar emissão fiscal.'
    });
  }
}

// GET /api/v1/fiscal/invoices
export async function handleListInvoices(req, res) {
  try {
    return res.json({
      success: true,
      data: await listInvoices()
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/v1/fiscal/invoices/:idOrChave
export async function handleGetInvoice(req, res) {
  try {
    const { idOrChave } = req.params;
    const invoice = await getInvoice(idOrChave);

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'Nota fiscal não encontrada.'
      });
    }

    return res.json({
      success: true,
      data: invoice
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/v1/fiscal/config
export async function handleGetFiscalConfig(req, res) {
  try {
    const config = await getFiscalConfig();
    return res.json({ success: true, data: config });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/v1/fiscal/config
export async function handleUpdateFiscalConfig(req, res) {
  try {
    const updated = await updateFiscalConfig(req.body);
    return res.json({
      success: true,
      message: 'Configuração fiscal atualizada com sucesso!',
      data: updated
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
