import { getAllSales, registerSale } from './sale.service.js';
import { createNotification } from '../notifications/notification.service.js';

export async function list(req, res, next) {
  try {
    const sales = await getAllSales();
    return res.json({
      success: true,
      data: sales
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

import { whatsappService } from '../../services/whatsapp.service.js';

export async function create(req, res, next) {
  try {
    const { productName, unitPrice, quantity } = req.body;
    if (!productName || unitPrice === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Produto e preço unitário são obrigatórios.'
      });
    }

    if (quantity !== undefined && parseInt(quantity) < 1) {
      return res.status(400).json({
        success: false,
        message: 'A quantidade não pode ser menor que 1.'
      });
    }

    const sale = await registerSale(req.body, req.user);

    // Trigger notification according to RBAC rule
    try {
      await createNotification({
        type: 'sales',
        title: 'Nova Venda Concluída',
        desc: `${sale.productName} (${sale.quantity || 1}x - R$ ${Number(sale.totalAmount || 0).toFixed(2)}) por ${sale.sellerName || req.user?.name || 'Vendedor'}`
      });
    } catch (notifErr) {
      console.warn('[Sale Notification Error]', notifErr.message);
    }

    // Enviar WhatsApp automaticamente se for entrega
    if (sale.deliveryMode === 'delivery' && sale.deliveryEmployeePhone) {
      const payLabelMap = {
        pix: 'PIX',
        cartao_credito: 'Cartão de Crédito',
        cartao_debito: 'Cartão de Débito',
        dinheiro: 'Dinheiro',
        vale: 'Vale Gás',
        pagar_na_entrega: 'Pagar na Entrega',
        maquininha_cartao: 'Maquininha de Cartão',
        pix_entrega: 'PIX na Entrega'
      };
      const payMethodStr = payLabelMap[sale.paymentMethod] || sale.paymentMethod || 'Dinheiro/Cartão';
      const payText = sale.isPaid 
        ? `✓ Já Pago (${payMethodStr})` 
        : `⏳ Cobrar na Entrega (${payMethodStr})`;
      const formattedDate = new Date(sale.date).toLocaleString('pt-BR');
      const msg = `🛵 *Nova Entrega Ultragas*\n\n*Pedido:* ${sale.orderNumber || sale.saleNumber}\n*Data:* ${formattedDate}\n*Local:* ${sale.deliveryAddress}\n*Cliente:* ${sale.customerName || 'Não informado'}\n*Produto:* ${sale.quantity || 1}x ${sale.productName}\n*Total da Entrega:* R$ ${Number(sale.totalAmount).toFixed(2)}\n*Pagamento:* ${payText}\n*Vendedor:* ${sale.sellerName || 'Balcão'}`;
      
      // Send asynchronously without awaiting to not block the request
      whatsappService.sendMessage(sale.deliveryEmployeePhone, msg).catch(err => console.error('Erro enviando WA', err));
    }

    return res.status(201).json({
      success: true,
      message: sale.financialStatus === 'failed' ? 'Venda registrada, mas o lançamento financeiro falhou. Regularize a integração; não repita a venda.' : sale.invoiceIssued 
        ? `Venda realizada com sucesso! Nota Fiscal: ${sale.invoiceNumber}`
        : 'Venda realizada com sucesso!',
      data: sale
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}
