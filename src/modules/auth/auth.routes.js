import { User } from '../users/user.model.js';
import { Router } from 'express';
import { login, register, getMe } from './auth.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';
import { authRateLimiter } from '../../middlewares/rateLimit.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { loginSchema, registerSchema, updateMeSchema } from './auth.validator.js';

const router = Router();

// Login endpoint protected by brute-force rate limiter and payload validator
router.post('/login', authRateLimiter, validate(loginSchema), login);

// Admin-only user registration with schema validation
router.post('/register', protect, requireMinHierarchy(3), validate(registerSchema), register);

// Profile inspection and update
router.get('/me', protect, getMe);
router.put('/me', protect, validate(updateMeSchema), async (req, res, next) => {
  try {
    const data = Object.fromEntries(
      ['name', 'artisanSpecialty', 'phone']
        .filter(k => typeof req.body[k] === 'string')
        .map(k => [k, req.body[k]])
    );

    if (req.body.notificationPreferences) {
      data['notificationPreferences.stock'] = req.body.notificationPreferences.stock === true;
      // Preferences may disable existing access, but cannot grant new notification permissions.
      if (['admin', 'superadmin', 'gerente_artesao'].includes(req.user.role) || req.user.notificationPreferences?.sales === true) {
        data['notificationPreferences.sales'] = req.body.notificationPreferences.sales === true;
      }
    }

    const user = await User.findByIdAndUpdate(req.user._id, { $set: data }, { new: true, runValidators: true });
    res.json({ success: true, data: user });
  } catch (e) {
    next(e);
  }
});

export default router;
