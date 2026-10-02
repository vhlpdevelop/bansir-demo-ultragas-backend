import { Router } from 'express';
import {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier
} from './supplier.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { createSupplierSchema, updateSupplierSchema } from './supplier.validator.js';

const router = Router();

// Protect all supplier endpoints with Authentication
router.use(protect);

// RBAC Security: Admins have full access; other roles require explicit 'suppliers' permission in allowedRoutes
export function requireSuppliersPermission(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Acesso não autorizado.', code: 'UNAUTHORIZED' });
  }

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  const hasRoutePermission = Array.isArray(req.user.allowedRoutes) && req.user.allowedRoutes.includes('suppliers');

  if (isAdmin || hasRoutePermission) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: `Acesso negado pelo RBAC. Seu usuário (${req.user.name}) não possui permissão para acessar o módulo de fornecedores.`,
    code: 'FORBIDDEN'
  });
}

router.use(requireSuppliersPermission);

router.get('/', listSuppliers);
router.get('/:id', getSupplier);
router.post('/', validate(createSupplierSchema), createSupplier);
router.put('/:id', validate(updateSupplierSchema), updateSupplier);
router.delete('/:id', requireMinHierarchy(2), deleteSupplier);

export default router;
