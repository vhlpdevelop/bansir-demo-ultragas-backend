import { Router } from 'express';
import mongoose from 'mongoose';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';
import { StoreSettings } from './settings.model.js';
const router = Router();
router.use(protect, requireMinHierarchy(3));
router.get('/', async (req, res, next) => {
  try { res.json({ success: true, data: await StoreSettings.findById('store').lean() || {} }); } catch (e) { next(e); }
});
router.put('/', async (req, res, next) => {
  try {
    const data = Object.fromEntries(['storeName', 'pixKey', 'documentId', 'address', 'merchantCity'].filter(k => typeof req.body[k] === 'string').map(k => [k, req.body[k]]));
    res.json({ success: true, data: await StoreSettings.findByIdAndUpdate('store', { $set: data }, { upsert: true, new: true, runValidators: true }) });
  } catch (e) { next(e); }
});
export default router;
