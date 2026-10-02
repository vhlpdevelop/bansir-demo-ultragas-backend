import { Router } from 'express';
import { 
  list, 
  markRead, 
  markAllRead, 
  create,
  listDevices,
  registerDevice,
  toggleDevicePushStatus,
  removeUserDevice,
  testPush
} from './notification.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireRoles } from '../../middlewares/role.middleware.js';
import { USER_ROLES } from '../users/user.model.js';
import { VAPID_PUBLIC_KEY, pushConfigured } from '../../config/webpush.js';

const router = Router();

// Public endpoint — frontend needs this BEFORE subscribing
router.get('/vapid-public-key', (req, res) => {
  if (!pushConfigured) return res.status(503).json({ success: false, message: 'Push não configurado no servidor.' });
  res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

router.use(protect);

router.get('/', list);
router.patch('/read-all', markAllRead);
router.patch('/:id/read', markRead);
router.post('/', requireRoles(USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN), create);

// Multi-Device Management Routes
router.get('/devices', listDevices);
router.post('/devices/register', registerDevice);
router.patch('/devices/:deviceId/toggle', toggleDevicePushStatus);
router.delete('/devices/:deviceId', removeUserDevice);
router.post('/test-push', testPush);

export default router;


