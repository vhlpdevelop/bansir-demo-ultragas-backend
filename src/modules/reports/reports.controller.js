import { getReportsSummary } from './reports.service.js';
import { generateReportPDF } from './reports.pdf.js';

export async function getSummary(req, res, next) {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      dateReference: req.query.dateReference,
      seller: req.query.seller,
      paymentMethod: req.query.paymentMethod,
      saleStatus: req.query.saleStatus,
      product: req.query.product,
      tipoDocumento: req.query.tipoDocumento,
      situacaoFiscal: req.query.situacaoFiscal,
      inactiveDays: req.query.inactiveDays
    };

    const data = await getReportsSummary(filters, req.user);
    return res.json({
      success: true,
      data
    });
  } catch (err) {
    next(err);
  }
}

export async function exportPdf(req, res, next) {
  try {
    const filters = {
      ...(req.query || {}),
      ...(req.body || {})
    };

    const mode = (filters.mode || 'consolidado').toLowerCase();
    const data = await getReportsSummary(filters, req.user);

    const nowStr = new Date().toISOString().slice(0, 10);
    const filename = `relatorio-bansir-${mode}-${nowStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await generateReportPDF(data, mode, res);
  } catch (err) {
    console.error('[Reports Controller Error - PDF]:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao gerar arquivo PDF do relatório.',
        error: err.message
      });
    }
  }
}
