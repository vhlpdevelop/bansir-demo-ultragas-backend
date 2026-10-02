import { Router } from 'express';
import { 
  list, 
  getByBarcode, 
  create, 
  update,
  remove,
  listCategories, 
  addCategory, 
  removeCategory,
  stockSummary,
  recordStockMovement,
  previewNFe,
  confirmNFe
} from './product.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';
import { xmlImportRateLimiter } from '../../middlewares/rateLimit.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  createProductSchema,
  updateProductSchema,
  stockMovementSchema,
  addCategorySchema,
  previewNFeSchema,
  confirmNFeSchema
} from './product.validator.js';

const router = Router();

router.use(protect);

// RBAC Guard for NF-e XML import (requires products or suppliers route permission, or admin)
function requireNFeImportPermission(req, res, next) {
  const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
  const hasPermission = Array.isArray(req.user?.allowedRoutes) && 
    (req.user.allowedRoutes.includes('products') || req.user.allowedRoutes.includes('suppliers'));

  if (isAdmin || hasPermission) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Acesso negado. Você precisa de permissão no módulo de Produtos ou Fornecedores para importar XML de NF-e.',
    code: 'FORBIDDEN'
  });
}

// XML NF-e Import routes with rate limiting and payload validation (mounted before /:id)
router.post('/import-nfe/preview', requireNFeImportPermission, xmlImportRateLimiter, validate(previewNFeSchema), previewNFe);
router.post('/import-nfe/confirm', requireNFeImportPermission, xmlImportRateLimiter, validate(confirmNFeSchema), confirmNFe);

// Stock routes (must be mounted before /:id)
router.get('/stock/summary', stockSummary);
router.post('/stock/movement', validate(stockMovementSchema), recordStockMovement);

// Category routes (must be mounted before parameterized /barcode/:barcode)
router.get('/categories', listCategories);
router.post('/categories', validate(addCategorySchema), addCategory);
router.delete('/categories/:id', requireMinHierarchy(2), removeCategory);

// Product CRUD routes
router.get('/', list);
router.get('/barcode/:barcode', getByBarcode);
router.post('/', validate(createProductSchema), create);
router.put('/:id', validate(updateProductSchema), update);
router.delete('/:id', requireMinHierarchy(2), remove);

export default router;
