import { Router } from 'express';
import { protectTerminal } from './terminal.auth.js';
import {
  getTerminalOrder,
  listTerminalOrders,
  listTerminalProducts,
  registerTerminalAdjustment,
  registerTerminalPayment
} from './terminal.service.js';

const router = Router();
router.use(protectTerminal);

function failure(res, error) {
  const message = error?.message || 'Falha na operação do terminal.';
  const status = error?.statusCode || (/não encontrad/i.test(message) ? 404 : /já|maior|inválid|obrigat|informe/i.test(message) ? 400 : 500);
  return res.status(status).json({ success: false, message });
}

router.get('/orders', async (_req, res) => {
  try { return res.json({ success: true, data: await listTerminalOrders() }); }
  catch (error) { return failure(res, error); }
});

router.get('/orders/:orderNumber', async (req, res) => {
  try { return res.json({ success: true, data: await getTerminalOrder(req.params.orderNumber) }); }
  catch (error) { return failure(res, error); }
});

router.post('/orders/:orderNumber/payments', async (req, res) => {
  try {
    const result = await registerTerminalPayment(req.params.orderNumber, req.body, req.terminalAudit);
    return res.status(result.replayed ? 200 : 201).json({ success: true, data: result.order, replayed: result.replayed });
  } catch (error) { return failure(res, error); }
});

router.post('/orders/:orderNumber/adjustments', async (req, res) => {
  try {
    const result = await registerTerminalAdjustment(req.params.orderNumber, req.body, req.terminalAudit);
    return res.status(result.replayed ? 200 : 201).json({ success: true, data: result.order, replayed: result.replayed });
  } catch (error) { return failure(res, error); }
});

router.get('/products', async (_req, res) => {
  try { return res.json({ success: true, data: await listTerminalProducts() }); }
  catch (error) { return failure(res, error); }
});

export default router;
