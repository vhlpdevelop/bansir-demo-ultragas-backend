import { Router } from 'express';
import { getSummary, exportPdf } from './reports.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { ROLE_HIERARCHY } from '../users/user.model.js';

const router = Router();

// Protect all report endpoints with Authentication
router.use(protect);

// RBAC Security: Admins have full access; other roles require explicit 'reports' permission in allowedRoutes
export function requireReportsPermission(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Acesso não autorizado.' });
  }

  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  const hasRoutePermission = Array.isArray(req.user.allowedRoutes) && req.user.allowedRoutes.includes('reports');

  if (isAdmin || hasRoutePermission) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: `Acesso negado pelo RBAC. Seu usuário (${req.user.name}) não possui permissão para acessar o módulo de relatórios.`
  });
}

router.use(requireReportsPermission);

// Summary indicators and tables for frontend interactive consultation
router.get('/summary', getSummary);

// PDF export endpoint (supports both GET and POST)
router.get('/pdf', exportPdf);
router.post('/pdf', exportPdf);

export default router;

