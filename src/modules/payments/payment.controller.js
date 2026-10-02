/**
 * Payment Controller — Endpoints para PIX e Maquininha
 */
import { generatePixForSale, getPixConfig, updatePixConfig } from './pix.service.js';

// POST /api/v1/payments/pix/generate
export async function handleGeneratePix(req, res) {
  try {
    const { amount, saleNumber } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valor da venda é obrigatório e deve ser maior que zero.'
      });
    }

    const pixData = await generatePixForSale(Number(amount), saleNumber || '');

    return res.json({
      success: true,
      message: 'QR Code PIX gerado com sucesso!',
      data: pixData
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Erro ao gerar PIX.'
    });
  }
}

// GET /api/v1/payments/pix/config
export async function handleGetPixConfig(req, res) {
  try {
    const config = await getPixConfig();
    return res.json({ success: true, data: config });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// PUT /api/v1/payments/pix/config
export async function handleUpdatePixConfig(req, res) {
  try {
    const updated = await updatePixConfig(req.body);
    return res.json({
      success: true,
      message: 'Configuração PIX atualizada com sucesso!',
      data: updated
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/v1/payments/terminal/simulate
// Simulador de resposta de maquininha (para demo)
export async function handleTerminalSimulate(req, res) {
  return res.status(501).json({ success: false, message: 'Integração com adquirente não configurada. Nenhuma cobrança foi processada.' });
}
