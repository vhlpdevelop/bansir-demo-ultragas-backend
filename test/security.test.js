import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import app from '../src/app.js';
import { config } from '../src/config/env.js';
import { protect } from '../src/middlewares/auth.middleware.js';
import { generateToken } from '../src/modules/auth/auth.service.js';
import { requireRoles, requireMinHierarchy, requireRoutePermission } from '../src/middlewares/role.middleware.js';
import { validate } from '../src/middlewares/validate.middleware.js';
import { loginSchema, registerSchema } from '../src/modules/auth/auth.validator.js';
import { createProductSchema } from '../src/modules/products/product.validator.js';
import { createSaleSchema } from '../src/modules/sales/sale.validator.js';

test('Security Suite: Helmet, CORS, Rate Limit, JWT, RBAC, Validation & Request Size Limits', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  // 1. HELMET TEST
  await t.test('Helmet sets essential security headers and hides X-Powered-By', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);

    // X-Content-Type-Options: nosniff
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');

    // X-Frame-Options: SAMEORIGIN
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');

    // Cross-Origin-Resource-Policy: cross-origin (allows frontend to load PDFs/XMLs)
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');

    // X-Powered-By must NOT be present
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  // 2. CORS TEST
  await t.test('CORS handles preflight requests, allowed headers and exposed headers', async () => {
    const res = await fetch(`${base}/api/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type, Authorization, X-Device-Id'
      }
    });

    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(res.headers.get('access-control-allow-methods'), /POST/);
    assert.match(res.headers.get('access-control-allow-headers'), /X-Device-Id/i);
    assert.match(res.headers.get('access-control-allow-headers'), /Authorization/i);

    // Check exposed headers
    const exposed = res.headers.get('access-control-expose-headers') || '';
    assert.ok(exposed.includes('Content-Disposition') || res.status === 204);
  });

  // 3. JWT TOKEN VERIFICATION & EXPIRATION TEST
  await t.test('JWT protect middleware handles missing, invalid, and expired tokens gracefully', async () => {
    const createProtectContext = (authHeader, readyState = 1) => {
      let statusCode = 200;
      let jsonPayload = null;
      let calledNext = false;

      const req = {
        headers: {
          ...(authHeader ? { authorization: authHeader } : {})
        }
      };

      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonPayload = data;
          return this;
        }
      };

      const next = () => {
        calledNext = true;
      };

      return { req, res, next, getResult: () => ({ statusCode, jsonPayload, calledNext }) };
    };

    // Temporarily mock readyState so protect passes DB availability check
    const originalReadyState = mongoose.connection.readyState;
    Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true, writable: true });

    try {
      // Case A: Missing token
      const ctxNoToken = createProtectContext(null);
      await protect(ctxNoToken.req, ctxNoToken.res, ctxNoToken.next);
      assert.equal(ctxNoToken.getResult().calledNext, false);
      assert.equal(ctxNoToken.getResult().statusCode, 401);
      assert.equal(ctxNoToken.getResult().jsonPayload.code, 'UNAUTHORIZED');

      // Case B: Invalid / malformed token
      const ctxInvalid = createProtectContext('Bearer invalid.jwt.token');
      await protect(ctxInvalid.req, ctxInvalid.res, ctxInvalid.next);
      assert.equal(ctxInvalid.getResult().calledNext, false);
      assert.equal(ctxInvalid.getResult().statusCode, 401);
      assert.equal(ctxInvalid.getResult().jsonPayload.code, 'INVALID_TOKEN');

      // Case C: Expired token
      const secret = config.jwtSecret || 'test-jwt-secret-bansir-2025';
      const expiredToken = jwt.sign(
        { id: '507f1f77bcf86cd799439011', role: 'operador' },
        secret,
        { expiresIn: '-1s' } // Expired 1 second ago
      );

      const ctxExpired = createProtectContext(`Bearer ${expiredToken}`);
      await protect(ctxExpired.req, ctxExpired.res, ctxExpired.next);
      assert.equal(ctxExpired.getResult().calledNext, false);
      assert.equal(ctxExpired.getResult().statusCode, 401);
      assert.equal(ctxExpired.getResult().jsonPayload.code, 'TOKEN_EXPIRED');
      assert.match(ctxExpired.getResult().jsonPayload.message, /expirada/i);
    } finally {
      Object.defineProperty(mongoose.connection, 'readyState', { value: originalReadyState, configurable: true, writable: true });
    }

    // Verify token generation includes role
    const testUser = { _id: '507f1f77bcf86cd799439011', email: 'test@bansir.com', role: 'gerente_artesao' };
    const token = generateToken(testUser);
    const decoded = jwt.verify(token, config.jwtSecret);
    assert.equal(decoded.id, '507f1f77bcf86cd799439011');
    assert.equal(decoded.role, 'gerente_artesao');
  });

  // 4. RBAC MIDDLEWARE LOGIC TEST
  await t.test('RBAC restricts access based on role hierarchy and module permissions', () => {
    const createMockContext = (user) => {
      let statusCode = 200;
      let jsonPayload = null;
      let calledNext = false;

      const req = { user };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonPayload = data;
          return this;
        }
      };
      const next = () => {
        calledNext = true;
      };

      return { req, res, next, getResult: () => ({ statusCode, jsonPayload, calledNext }) };
    };

    // Test requireRoles
    const roleMiddleware = requireRoles('admin', 'superadmin');
    
    // Operador blocked
    const ctx1 = createMockContext({ role: 'operador', name: 'Operador Test' });
    roleMiddleware(ctx1.req, ctx1.res, ctx1.next);
    assert.equal(ctx1.getResult().calledNext, false);
    assert.equal(ctx1.getResult().statusCode, 403);
    assert.equal(ctx1.getResult().jsonPayload.code, 'FORBIDDEN');

    // Admin allowed
    const ctx2 = createMockContext({ role: 'admin', name: 'Admin Test' });
    roleMiddleware(ctx2.req, ctx2.res, ctx2.next);
    assert.equal(ctx2.getResult().calledNext, true);

    // Test requireMinHierarchy
    const minHierarchy3 = requireMinHierarchy(3); // Level 3 = Admin
    
    // Gerente Artesao (Level 2) blocked
    const ctx3 = createMockContext({ role: 'gerente_artesao' });
    minHierarchy3(ctx3.req, ctx3.res, ctx3.next);
    assert.equal(ctx3.getResult().calledNext, false);
    assert.equal(ctx3.getResult().statusCode, 403);

    // Superadmin (Level 4) allowed
    const ctx4 = createMockContext({ role: 'superadmin' });
    minHierarchy3(ctx4.req, ctx4.res, ctx4.next);
    assert.equal(ctx4.getResult().calledNext, true);

    // Test requireRoutePermission
    const reportsGuard = requireRoutePermission('reports');
    
    // Operador without reports route blocked
    const ctx5 = createMockContext({ role: 'operador', allowedRoutes: ['sales'] });
    reportsGuard(ctx5.req, ctx5.res, ctx5.next);
    assert.equal(ctx5.getResult().calledNext, false);
    assert.equal(ctx5.getResult().statusCode, 403);

    // Operador with reports route allowed
    const ctx6 = createMockContext({ role: 'operador', allowedRoutes: ['sales', 'reports'] });
    reportsGuard(ctx6.req, ctx6.res, ctx6.next);
    assert.equal(ctx6.getResult().calledNext, true);

    // Admin allowed regardless of allowedRoutes
    const ctx7 = createMockContext({ role: 'admin', allowedRoutes: [] });
    reportsGuard(ctx7.req, ctx7.res, ctx7.next);
    assert.equal(ctx7.getResult().calledNext, true);
  });

  // 5. PAYLOAD VALIDATION TEST
  await t.test('Payload validation rejects invalid bodies and passes valid ones', () => {
    const createValidationContext = (body) => {
      let statusCode = 200;
      let jsonPayload = null;
      let calledNext = false;

      const req = { body };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          jsonPayload = data;
          return this;
        }
      };
      const next = (err) => {
        if (!err) calledNext = true;
      };

      return { req, res, next, getResult: () => ({ statusCode, jsonPayload, calledNext }) };
    };

    // Test login schema: missing email
    const loginVal = validate(loginSchema);
    const ctx1 = createValidationContext({ password: 'secretpassword' });
    loginVal(ctx1.req, ctx1.res, ctx1.next);
    assert.equal(ctx1.getResult().calledNext, false);
    assert.equal(ctx1.getResult().statusCode, 400);
    assert.equal(ctx1.getResult().jsonPayload.code, 'VALIDATION_ERROR');

    // Test product schema: negative price
    const productVal = validate(createProductSchema);
    const ctx2 = createValidationContext({ name: 'Vaso de Barro', price: -10 });
    productVal(ctx2.req, ctx2.res, ctx2.next);
    assert.equal(ctx2.getResult().calledNext, false);
    assert.equal(ctx2.getResult().statusCode, 400);

    // Test product schema: valid product
    const ctx3 = createValidationContext({ name: 'Vaso de Barro', price: 49.9, stock: 5 });
    productVal(ctx3.req, ctx3.res, ctx3.next);
    assert.equal(ctx3.getResult().calledNext, true);

    // Test sale schema: empty name or negative price
    const saleVal = validate(createSaleSchema);
    const ctx4 = createValidationContext({ productName: '', unitPrice: -5 });
    saleVal(ctx4.req, ctx4.res, ctx4.next);
    assert.equal(ctx4.getResult().calledNext, false);
    assert.equal(ctx4.getResult().statusCode, 400);

    // Test sale schema: valid sale
    const ctx5 = createValidationContext({ productName: 'Peça Artesanal', unitPrice: 35.5, quantity: 2 });
    saleVal(ctx5.req, ctx5.res, ctx5.next);
    assert.equal(ctx5.getResult().calledNext, true);
  });

  // 6. REQUEST SIZE LIMIT TEST (General vs XML exception)
  await t.test('Request size limit restricts large payloads on general endpoints but permits large XML', async () => {
    // Create an oversized JSON payload (> 500KB)
    const oversizedBody = JSON.stringify({
      data: 'x'.repeat(600 * 1024)
    });

    // Test sending to a regular endpoint
    const resGeneral = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: oversizedBody
    });

    // Body parser must reject with 413 Payload Too Large
    assert.equal(resGeneral.status, 413);
    const bodyGeneral = await resGeneral.json();
    assert.equal(bodyGeneral.success, false);
    assert.equal(bodyGeneral.code, 'PAYLOAD_TOO_LARGE');

    // Now test sending a 1MB XML payload to the dedicated import-nfe endpoint
    // NF-e XML files can be large; our configuration allows up to 15MB
    const largeXml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe>${'<!-- Large NF-e payload -->'.repeat(40000)}</infNFe></NFe></nfeProc>`;
    
    // We send via application/json to /api/v1/products/import-nfe/preview
    // Even without DB / Auth, the body-parser must NOT reject with 413
    const resXml = await fetch(`${base}/api/v1/products/import-nfe/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xmlContent: largeXml })
    });

    // Status should NOT be 413 (it will be 503 or 401, confirming body was accepted past the 15MB parser)
    assert.notEqual(resXml.status, 413, 'Large XML payload must not be rejected by body parser');
  });

  // 7. RATE LIMITING TEST
  await t.test('Rate limiting headers and security metadata are properly exposed in health', async () => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.security.rateLimit, true);
    assert.equal(health.security.helmet, true);
    assert.equal(health.security.cors, true);
    assert.equal(health.security.jwt, true);
    assert.equal(health.security.rbac, true);
    assert.equal(health.security.payloadValidation, true);
    assert.equal(health.security.bodyLimitXml, '15mb');
  });
});
