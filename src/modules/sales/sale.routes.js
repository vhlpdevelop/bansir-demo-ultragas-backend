import { Router } from 'express';
import { list, create } from './sale.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';
import { retrySaleFinancial } from './sale.service.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { createSaleSchema } from './sale.validator.js';

const router = Router();

router.use(protect);

router.get('/', list);
router.post('/', validate(createSaleSchema), create);
router.post('/:id/financial', requireMinHierarchy(3), async (req, res) => {
  try {
    const sale = await retrySaleFinancial(req.params.id, req.user._id || req.user.id);
    if (sale.financialStatus !== 'posted') {
      return res.status(503).json({ success: false, message: 'Integração financeira indisponível. Tente novamente.' });
    }
    return res.json({ success: true, data: sale, message: 'Financeiro regularizado.' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

import { resendDeliveryWhatsApp } from './sale.service.js';

router.post('/:id/resend-whatsapp', async (req, res) => {
  try {
    await resendDeliveryWhatsApp(req.params.id);
    return res.json({ success: true, message: 'Rota enviada com sucesso para o motoboy!' });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
