import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import { isDbConnected } from './config/db.js';
import { getCorsOptions } from './config/cors.js';
import { helmetMiddleware } from './middlewares/security.middleware.js';
import { apiRateLimiter } from './middlewares/rateLimit.middleware.js';
import { notFound, errorHandler } from './middlewares/error.middleware.js';

// Modular routes (prepared for microservices separation!)
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/user.routes.js';
import financialRoutes from './modules/financial/financial.routes.js';
import productRoutes from './modules/products/product.routes.js';
import employeeRoutes from './modules/employees/employee.routes.js';
import saleRoutes from './modules/sales/sale.routes.js';
import paymentRoutes from './modules/payments/payment.routes.js';
import fiscalRoutes from './modules/fiscal/fiscal.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';
import operationRoutes from './modules/operations/operation.routes.js';
import supplierRoutes from './modules/suppliers/supplier.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import voucherRoutes from './modules/vouchers/voucher.routes.js';

const app = express();

// Trust reverse proxy (Render, Cloudflare, Nginx) for accurate client IP in rate limiters
app.set('trust proxy', 1);

// 1. Helmet Security Headers
app.use(helmetMiddleware);

// 2. Dynamic and Secure CORS
app.use(cors(getCorsOptions()));

// 3. General API Rate Limiting
app.use('/api', apiRateLimiter);

// 4. Request Size Limit (with exception for large NF-e XML files)
// NF-e XML files and import batches can be multiple megabytes; allow up to 15MB for import routes
const xmlImportPaths = ['/api/v1/products/import-nfe', '/api/products/import-nfe'];
app.use(
  xmlImportPaths,
  express.json({ limit: config.bodyLimitXml }),
  express.text({ type: ['application/xml', 'text/xml'], limit: config.bodyLimitXml })
);

// Standard request size limit for all regular API routes (prevents memory exhaustion / DoS)
app.use(express.json({ limit: config.bodyLimitGeneral }));
app.use(express.urlencoded({ extended: true, limit: config.bodyLimitGeneral }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'bansir-retail-craft-monolith',
    version: '1.2.0',
    dbConnected: isDbConnected(),
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    security: {
      rateLimit: true,
      helmet: true,
      cors: true,
      jwt: true,
      rbac: true,
      payloadValidation: true,
      bodyLimitGeneral: config.bodyLimitGeneral,
      bodyLimitXml: config.bodyLimitXml
    },
    availableModules: [
      { name: 'auth', path: '/api/v1/auth' },
      { name: 'users', path: '/api/v1/users' },
      { name: 'financial', path: '/api/v1/financial' },
      { name: 'products', path: '/api/v1/products' },
      { name: 'employees', path: '/api/v1/employees', adminOnly: true },
      { name: 'sales', path: '/api/v1/sales' },
      { name: 'payments', path: '/api/v1/payments' },
      { name: 'fiscal', path: '/api/v1/fiscal' },
      { name: 'reports', path: '/api/v1/reports' },
      { name: 'suppliers', path: '/api/v1/suppliers' }
    ]
  });
});

// No business endpoint may fall back to local data when MongoDB is unavailable.
app.use(['/api/v1', '/api/reports', '/api/suppliers'], (req, res, next) => {
  if (!isDbConnected()) {
    return res.status(503).json({
      success: false,
      message: 'MongoDB indisponível. Nenhuma operação foi realizada.'
    });
  }
  next();
});

// Mount domain modules
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/financial', financialRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/employees', employeeRoutes);
app.use('/api/v1/sales', saleRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/fiscal', fiscalRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/operations', operationRoutes);
app.use('/api/reports', reportsRoutes); // Alias as referenced in specification
app.use('/api/v1/suppliers', supplierRoutes);
app.use('/api/suppliers', supplierRoutes);

// Error handlers
app.use(notFound);
app.use(errorHandler);

export default app;
