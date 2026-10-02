import { Router } from 'express';
import { getStatus, logout, start } from './whatsapp.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/role.middleware.js';

const router = Router();

router.use(protect);
router.get('/status', getStatus);
router.post('/logout', requireRoles('admin', 'superadmin'), logout);
router.post('/start', requireRoles('admin', 'superadmin'), start);

export default router;
