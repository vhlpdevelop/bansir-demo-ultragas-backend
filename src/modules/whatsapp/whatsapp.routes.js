import { Router } from 'express';
import { getStatus, logout } from './whatsapp.controller.js';
import { protect, authorize } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(protect);
router.get('/status', getStatus);
router.post('/logout', authorize('admin', 'superadmin'), logout);

export default router;
