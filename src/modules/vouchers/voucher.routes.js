import { Router } from 'express';
import { emitVoucher, listVouchers, getVoucherByCode, redeemVoucher } from './voucher.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(protect);

router.post('/', emitVoucher);
router.get('/', listVouchers);
router.get('/:code', getVoucherByCode);
router.post('/:code/redeem', redeemVoucher);

export default router;
