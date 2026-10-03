import { Router } from 'express';
import { list, getOne, create, update, remove, createVoucher, listVouchers } from './employee.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';

const router = Router();

// Protect all routes and restrict strictly to Administrator and Superadmin (Level >= 3)
router.use(protect);
router.use(requireMinHierarchy(3));

router.get('/vouchers', listVouchers);
router.post('/vouchers', createVoucher);
router.get('/', list);
router.get('/:id', getOne);
router.post('/', create);
router.put('/:id', update);
router.delete('/:id', remove);

export default router;
