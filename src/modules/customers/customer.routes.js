import { Router } from 'express';
import { searchCustomers } from './customer.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(protect);
router.get('/search', searchCustomers);

export default router;
