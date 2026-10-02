import { Router } from 'express';
import { 
  getSummary, 
  listTransactions, 
  create, 
  updateStatus,
  getPricingIntelligence,
  updatePricingIntelligence,
  applyPrice
} from './financial.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';

import { requireFinancialAccess } from './access.js';
import { closeRegister, getHistory } from './cash-register.controller.js';

const router = Router();

router.use(protect);

// Financial overview & transaction listing
router.get('/summary', requireFinancialAccess(), getSummary);
router.get('/transactions', requireFinancialAccess(), listTransactions);

// Pricing & Capacity Intelligence (BDI / DBI / Capacidade Produtiva)
router.get('/pricing-intelligence', requireFinancialAccess('financial-intelligence'), getPricingIntelligence);
router.put('/pricing-intelligence', requireMinHierarchy(3), updatePricingIntelligence);
router.post('/pricing-intelligence/apply-price', requireMinHierarchy(3), applyPrice);

// Create transaction (sales / expense / commission)
router.post('/transactions', requireFinancialAccess(), create);

// Change transaction status (e.g. approve artisan payout) - requires Admin or SuperAdmin (level >= 3)
router.patch('/transactions/:id/status', requireMinHierarchy(3), updateStatus);

// Cash Register
router.post('/cash-register/close', requireFinancialAccess(), closeRegister);
router.get('/cash-register/history', requireFinancialAccess(), getHistory);

export default router;
