import { Router } from 'express';
import { searchCustomers, getCustomers, createCustomer, updateCustomer, deleteCustomer } from './customer.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(protect);
router.get('/search', searchCustomers);
router.get('/', getCustomers);
router.post('/', createCustomer);
router.put('/:id', updateCustomer);
router.delete('/:id', deleteCustomer);

export default router;
