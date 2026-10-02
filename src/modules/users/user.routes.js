import { Router } from 'express';
import { 
  list, 
  getOne, 
  changeRole, 
  toggleStatus, 
  create, 
  updatePermissions, 
  remove,
  getUserDevicesHandler,
  revokeUserDeviceHandler
} from './user.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireRoles, requireMinHierarchy } from '../../middlewares/role.middleware.js';
import { USER_ROLES } from './user.model.js';

const router = Router();

// Protect all user routes
router.use(protect);

// Operators can list team members, but cannot change roles or create users
router.get('/', list);
router.get('/:id', getOne);

// Only Admin and SuperAdmin (hierarchy level >= 3) can create or modify roles
router.post('/', requireMinHierarchy(3), create);
router.patch('/:id/role', requireRoles(USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN), changeRole);
router.patch('/:id/status', requireMinHierarchy(3), toggleStatus);
router.put('/:id/permissions', requireRoles(USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN), updatePermissions);
router.delete('/:id', requireRoles(USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN), remove);

// Admin device inspection and revocation per user
router.get('/:id/devices', requireRoles(USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN), getUserDevicesHandler);
router.delete('/:id/devices/:deviceId', requireRoles(USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN), revokeUserDeviceHandler);

export default router;
