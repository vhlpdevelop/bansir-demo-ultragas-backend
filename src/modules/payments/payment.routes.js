import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';
import {
  handleGeneratePix,
  handleGetPixConfig,
  handleUpdatePixConfig,
  handleTerminalSimulate
} from './payment.controller.js';

const router = Router();
router.use(protect);

// PIX
router.post('/pix/generate', handleGeneratePix);
router.get('/pix/config', handleGetPixConfig);
router.put('/pix/config', requireMinHierarchy(3), handleUpdatePixConfig);

// Terminal / Maquininha (Simulador)
router.post('/terminal/simulate', handleTerminalSimulate);

export default router;
