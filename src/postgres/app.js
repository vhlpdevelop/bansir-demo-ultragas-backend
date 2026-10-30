import {mountDeliveries} from './deliveries.js';
import {mountNotificationStream} from './notification-stream.js';
import {createLoginThrottle} from './login-throttle.js';
import {createBrowserSessions} from './browser-sessions.js';
import {mountBridge} from './bridge.js';
import {mountPdvTerminals} from './pdv-terminals.js';
import {mountPlatformAdmin} from './platform-admin.js';
import {mountProductImages} from './product-images.js';
import {requireFeature,routeFeature} from './features.js';
import {mountAccess} from './access.js';
import {mountMetaOnboarding} from './meta-onboarding.js';
import {mountManagement} from './management.js';
import {mountManagementReports} from './management-reports.js';
import express from 'express';
import {mountMetaWebhook} from './meta-webhook.js';
import {mountQzSigning} from './qz-signing.js';
import {mountPrinting} from './printing.js';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { createAuth } from './auth.js';
import { httpError } from './database.js';
import {mountFiscal} from './fiscal.js';
import {mountNotifications} from './notifications.js';
import {mountSales} from './sales.js';
import {mountCustomers} from './customers.js';
import {mountSuppliers} from './suppliers.js';
import {mountFiscalMonitor} from './fiscal-monitor.js';
import {mountCustomerProfile} from './customer-profile.js';
import {mountProductImport} from './product-import.js';
import {mountPublicStorefront,mountStorefrontAdmin} from './storefront.js';
import {mountWhatsapp} from './whatsapp.js';
import {mountVouchersFleet} from './vouchers-fleet.js';
import { categoryInput, settingsInput, requirePermission, resourceId, presentProduct,catalogView, createProduct, updateProduct, moveStock } from './catalog.js';

export const migratedModules = ['auth', 'tenants', 'products', 'settings', 'notifications', 'fiscal-settings', 'fiscal-queue','sales','cash','customers','deliverers','storefront','suppliers','fiscal-monitor','whatsapp','vouchers','fleet','financial','employees','reports','bridge'];
export function createPostgresApp({ database, jwtSecret, corsOrigin = '', nodeEnv = 'development', expiresIn = '10m',clock=()=>new Date(),onError,metaConnect,imageStorage }) {
  const app = express();
  const allowed = corsOrigin.split(',').map(s => s.trim()).filter(Boolean);
  if (nodeEnv === 'production' && (!allowed.length || allowed.includes('*'))) throw new Error('Defina origens CORS explícitas em produção.');
  const auth = createAuth(database, { jwtSecret, expiresIn });
  const browserSessions=createBrowserSessions({secret:jwtSecret,nodeEnv,allowedOrigins:allowed});
  const loginThrottle=createLoginThrottle(database,jwtSecret);
  const bearerProtect=auth.protect;
  auth.protect=(req,res,next)=>{try{if(browserSessions.isBrowser(req))res.set('Cache-Control','no-store');browserSessions.authenticate(req);bearerProtect(req,res,next);}catch(error){next(error);}};
  app.disable('x-powered-by');
  // No proxy is trusted implicitly; set TRUST_PROXY_HOPS for the deployed topology.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 0));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin(origin, cb) {
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
    cb(null, !origin || allowed.includes(origin) || (nodeEnv !== 'production' && local));
  }, allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id','X-Checkout-Token','X-Pdv-Terminal','X-Bansir-Client','X-Bansir-Session','X-CSRF-Token','X-Bansir-Session-Mode'], credentials:true, exposedHeaders: ['Content-Disposition'] }));
  mountMetaWebhook(app,{database});
  const uploads=rateLimit({windowMs:900000,limit:30,standardHeaders:'draft-7',legacyHeaders:false});
  app.use('/api/v1/fiscal/certificate',uploads,auth.protect,express.json({limit:'1500kb'}));
  app.use('/api/v1/customers/import',uploads,auth.protect,express.json({limit:'8mb'}));
  app.use('/api/v1/products/import',uploads,auth.protect,express.json({limit:'8mb'}));
  app.use('/api/v1/products/:id/image',(req,res,next)=>req.method==='PUT'?uploads(req,res,next):next(),auth.protect,express.raw({type:['image/jpeg','image/png','image/webp'],limit:'2mb'}));
  app.use(express.json({ limit: '500kb' }));
  const route = fn => async (req, res, next) => {
    try {
      const result = await fn(req);
      res.status(result.status || 200).json({ success: true, data: result.data, ...result.meta });
    } catch (error) { next(error); }
  };
  app.get('/api/health', async (req, res) => {
    try { await database.ping(); res.json({ status: 'online', dbConnected: true, database: 'postgres', multiTenant: true, migrationPhase: 'foundation', migratedModules }); }
    catch { res.status(503).json({ status: 'unavailable', dbConnected: false, database: 'postgres' }); }
  });
  const loginLimit = rateLimit({ windowMs: 900000, limit: 60, skipSuccessfulRequests:true, standardHeaders: 'draft-7', legacyHeaders: false });
  app.use(['/api/v1/auth','/api/v1/platform'],(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.use('/api/v1', rateLimit({ windowMs: 900000, limit: 1500, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.post('/api/v1/auth/login', loginLimit, route(async req => {browserSessions.loginOrigin(req);await loginThrottle.attempt(req,'tenant');const data=await auth.login(req.body);await loginThrottle.success(req,'tenant');return {data:browserSessions.issue(req,data)};}));
  app.post('/api/v1/auth/select-establishment', loginLimit, route(async req => {browserSessions.loginOrigin(req);return {data:browserSessions.issue(req,await auth.select(req.body))};}));
  app.post('/api/v1/auth/refresh',rateLimit({windowMs:900000,limit:300,standardHeaders:'draft-7',legacyHeaders:false}),route(async req=>{browserSessions.loginOrigin(req);const cookieMode=browserSessions.isBrowser(req)&&req.get('X-Bansir-Session');const body=cookieMode?browserSessions.refresh(req):req.body;try{return {data:browserSessions.issue(req,await auth.refresh(body))};}catch(e){if(cookieMode&&e.status===401)browserSessions.clearRefresh(req,req.get('X-Bansir-Session'));throw e;}}));
  mountPlatformAdmin(app,{database,route,browserSessions,loginThrottle});
  mountPublicStorefront(app,{database,route,clock,imageStorage});
  app.use('/api/v1', auth.protect);
  mountNotificationStream(app,{database});
  app.use(async(req,res,next)=>{try{const feature=routeFeature(req.path);if(feature)await database.transaction(req.identity,async c=>{await requireFeature(c,feature);if(req.path==='/api/v1/storefront/conversations')await requireFeature(c,'whatsapp');});next();}catch(e){next(e);}});
  app.post('/api/v1/auth/logout',route(async req=>{browserSessions.checkRefreshMutation(req);const data=await auth.logout(req.identity);if(browserSessions.isBrowser(req))browserSessions.clearRefresh(req,req.identity.sessionId);return {data};}));
  app.get('/api/v1/auth/me', route(async req => ({ data: (await auth.session(req.identity)).user })));
  app.put('/api/v1/auth/me',route(async req=>{const d=z.object({name:z.string().trim().min(1).max(200),phone:z.string().max(40)}).strict().parse(req.body);await database.transaction(req.identity,c=>c.query('SELECT bansir.update_own_profile($1,$2)',[d.name,d.phone]));return {data:(await auth.session(req.identity)).user};}));
  app.post('/api/v1/auth/change-password',rateLimit({windowMs:900000,limit:10,standardHeaders:'draft-7',legacyHeaders:false}),route(async req=>{browserSessions.checkRefreshMutation(req);const data=await auth.changePassword(req.identity,req.body);if(browserSessions.isBrowser(req))browserSessions.clearRefresh(req,req.identity.sessionId);return {data};}));
  app.post('/api/v1/auth/return-to-selection', route(async req => {browserSessions.checkRefreshMutation(req);const data=await auth.returnToSelection(req.identity);if(browserSessions.isBrowser(req))browserSessions.clearRefresh(req,req.identity.sessionId);return {data};}));
  app.post('/api/v1/auth/switch-tenant', (req,res)=>res.status(410).json({success:false,code:'SELECTION_REQUIRED',message:'Volte à seleção de estabelecimento.'}));
  const scoped = (module, read, fn) => route(async req => database.transaction(req.identity, async (client, member) => {
    requirePermission(member, module, read);
    req.identity.pdvTerminalToken=req.get('X-Pdv-Terminal');
    return fn(client, req,member);
  }));

  mountProductImages(app,{scoped,database,imageStorage});
  mountPdvTerminals(app,{scoped});
  mountAccess(app,{scoped});
  mountDeliveries(app,{database,route});
  mountBridge(app,{scoped,database,nodeEnv});
  app.get('/api/v1/settings', scoped('settings', true, async (client, req) => {
    const { rows: [row] } = await client.query('SELECT * FROM bansir.store_settings WHERE tenant_id=$1', [req.identity.tenantId]);
    return { data: row ? { storeName: row.store_name, pixKey: row.pix_key, documentId: row.document_id, address: row.address, merchantCity: row.merchant_city } : {} };
  }));
  app.put('/api/v1/settings', scoped('settings', false, async (client, req) => {
    const data = settingsInput.parse(req.body);
    await client.query('INSERT INTO bansir.store_settings(tenant_id,establishment_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.identity.tenantId,req.identity.establishmentId]);
    const mapping = { storeName: 'store_name', pixKey: 'pix_key', documentId: 'document_id', address: 'address', merchantCity: 'merchant_city' };
    const entries = Object.entries(data);
    if (entries.length) await client.query(`UPDATE bansir.store_settings SET ${entries.map(([k], i) => `${mapping[k]}=$${i + 2}`).join(',')}, updated_at=now() WHERE tenant_id=$1`, [req.identity.tenantId, ...entries.map(([, v]) => v)]);
    return { data };
  }));

  app.get('/api/v1/products/categories', scoped('products', true, async (client, req) => {
    const { rows } = await client.query(`SELECT c.*,count(p.id)::integer AS product_count FROM bansir.categories c
      LEFT JOIN bansir.products p ON p.tenant_id=c.tenant_id AND p.category=c.name AND p.active
      WHERE c.tenant_id=$1 GROUP BY c.tenant_id,c.id ORDER BY c.name`, [req.identity.tenantId]);
    return { data: rows.map(c => ({ _id: c.id, id: c.id, name: c.name, color: c.color, description: c.description, productCount: c.product_count })) };
  }));
  app.post('/api/v1/products/categories', scoped('products', false, async (client, req) => {
    const data = categoryInput.parse(req.body);
    const { rows: [row] } = await client.query('INSERT INTO bansir.categories(tenant_id,name,description,color,establishment_id) VALUES($1,$2,$3,$4,$5) RETURNING id,name,description,color', [req.identity.tenantId, data.name, data.description || '', data.color || '#000fff',req.identity.establishmentId]);
    return { status: 201, data: { ...row, _id: row.id } };
  }));
  app.delete('/api/v1/products/categories/:id', scoped('products', false, async (client, req) => {
    const { rows: [category] } = await client.query('SELECT name FROM bansir.categories WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [req.identity.tenantId, resourceId(req.params.id)]);
    if (!category) throw httpError(404, 'Categoria não encontrada.', 'NOT_FOUND');
    const { rowCount } = await client.query('SELECT 1 FROM bansir.products WHERE tenant_id=$1 AND category=$2 AND active LIMIT 1', [req.identity.tenantId, category.name]);
    if (rowCount) throw httpError(409, 'Categoria possui produtos ativos.', 'CATEGORY_IN_USE');
    await client.query('DELETE FROM bansir.categories WHERE tenant_id=$1 AND id=$2', [req.identity.tenantId, req.params.id]);
    return { data: true };
  }));
  app.get('/api/v1/products/stock/summary', scoped('products', false, async (client, req) => {
    const { rows: products } = await client.query('SELECT * FROM bansir.products WHERE tenant_id=$1 AND active', [req.identity.tenantId]);
    const { rows: movements } = await client.query(`SELECT m.*,p.name AS product_name,u.name AS user_name FROM bansir.stock_movements m
      JOIN bansir.products p ON p.tenant_id=m.tenant_id AND p.id=m.product_id JOIN bansir.users u ON u.id=m.user_id
      WHERE m.tenant_id=$1 ORDER BY m.created_at DESC LIMIT 15`, [req.identity.tenantId]);
    const { rows: totals } = await client.query(`SELECT type,sum(quantity) AS units,sum(quantity*unit_price_cents) AS cents
      FROM bansir.stock_movements WHERE tenant_id=$1 AND created_at >= (date_trunc('month',now() AT TIME ZONE 'America/Cuiaba') AT TIME ZONE 'America/Cuiaba') GROUP BY type`, [req.identity.tenantId]);
    const sum = type => totals.find(r => r.type === type);
    const low = products.filter(p => p.stock <= 5).sort((a, b) => a.stock - b.stock);
    return { data: { totalProducts: products.length, totalStockUnits: products.reduce((s, p) => s + p.stock, 0),
      totalStockCost: products.reduce((s, p) => s + p.stock * Number(p.cost_cents), 0) / 100,
      totalStockRetail: products.reduce((s, p) => s + p.stock * Number(p.price_cents), 0) / 100,
      lowStockCount: low.length, lowStockProducts: low.map(presentProduct),
      monthEntriesUnits: Number(sum('in')?.units || 0), monthEntriesValue: Number(sum('in')?.cents || 0) / 100,
      monthExitsUnits: Number(sum('out')?.units || 0), monthExitsValue: Number(sum('out')?.cents || 0) / 100,
      recentMovements: movements.map(m => ({ _id: m.id, productName: m.product_name, type: m.type, quantity: m.quantity, unitPrice: Number(m.unit_price_cents) / 100, reason: m.reason, userName: m.user_name, date: m.created_at })) } };
  }));
  app.post('/api/v1/products/stock/movement', scoped('products', false, async (client, req) => ({ data: await moveStock(client, req.identity, req.body) })));
  app.get('/api/v1/products/barcode/:barcode', scoped('products', true, async (client, req,member) => {
    const barcode = z.string().min(1).max(200).parse(req.params.barcode);
    const { rows: [row] } = await client.query('SELECT * FROM bansir.products WHERE tenant_id=$1 AND barcode=$2 AND active', [req.identity.tenantId, barcode]);
    if (!row) throw httpError(404, 'Produto não encontrado.', 'NOT_FOUND');
    return { data: catalogView(row,member) };
  }));
  app.get('/api/v1/products/:id',scoped('products',true,async(client,req,member)=>{
    const product=(await client.query('SELECT * FROM bansir.products WHERE id=$1 AND active',[resourceId(req.params.id)])).rows[0];
    if(!product)throw httpError(404,'Produto não encontrado.','NOT_FOUND');return {data:catalogView(product,member)};
  }));
  app.get('/api/v1/products', scoped('products', true, async (client, req,member) => {
    const query = z.object({ q: z.string().max(200).optional(), barcode: z.string().max(200).optional(),
      page: z.coerce.number().int().min(0).max(100000).default(0), pageSize: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    // strpos treats search as literal text, including SQL wildcard characters.
    const values = [req.identity.tenantId, query.q || '', query.barcode || ''];
    const where = `tenant_id=$1 AND active AND ($2='' OR strpos(lower(name||' '||category||' '||sku||' '||barcode),lower($2))>0) AND ($3='' OR barcode=$3)`;
    const { rows } = await client.query(`SELECT * FROM bansir.products WHERE ${where} ORDER BY name,id LIMIT $4 OFFSET $5`, [...values, query.pageSize, query.page * query.pageSize]);
    const { rows: [count] } = await client.query(`SELECT count(*)::integer AS total FROM bansir.products WHERE ${where}`, values);
    return { data: rows.map(p=>catalogView(p,member)), meta: { total: count.total, page: query.page, pageSize: query.pageSize } };
  }));
  app.post('/api/v1/products', scoped('products', false, async (client, req) => ({ status: 201, data: await createProduct(client, req.identity, req.body) })));
  app.put('/api/v1/products/:id', scoped('products', false, async (client, req) => ({ data: await updateProduct(client, req.identity, req.params.id, req.body) })));
  app.delete('/api/v1/products/:id', scoped('products', false, async (client, req) => {
    const { rowCount } = await client.query('UPDATE bansir.products SET active=false,updated_at=now() WHERE tenant_id=$1 AND id=$2', [req.identity.tenantId, resourceId(req.params.id)]);
    if (!rowCount) throw httpError(404, 'Produto não encontrado.', 'NOT_FOUND');
    return { data: true };
  }));

  mountNotifications(app,{scoped,route,database});
  mountFiscal(app,{scoped});
  mountSales(app,{scoped});
  mountManagement(app,{scoped});
  mountManagementReports(app,{scoped});
  mountPrinting(app,{scoped});
  mountQzSigning(app,{scoped});
  mountCustomers(app,{scoped});
  mountSuppliers(app,{scoped});
  mountFiscalMonitor(app,{scoped});
  mountCustomerProfile(app,{scoped});
  mountProductImport(app,{scoped});
  mountStorefrontAdmin(app,{scoped});
  mountWhatsapp(app,{scoped,metaConnect});
  mountMetaOnboarding(app,{scoped,call:metaConnect});
  mountVouchersFleet(app,{database});
  // Never mount legacy MongoDB business routers in the multi-tenant process.
  app.use('/api/v1', (req, res) => res.status(503).json({ success: false, code: 'MODULE_MIGRATION_PENDING',
    message: 'Este módulo ainda não está disponível no novo ambiente.', migratedModules }));
  app.use((req, res) => res.status(404).json({ success: false, message: 'Rota não encontrada.' }));
  app.use((error, req, res, next) => {
    try{onError?.(error);}catch{/* Observability cannot change the response. */}
    if (res.headersSent) return next(error);
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: error.issues[0]?.message || 'Dados inválidos.' });
    if (error.code === '23505') return res.status(409).json({ success: false, code: 'CONFLICT', message: 'Já existe um registro com este identificador nesta empresa.' });
    if (error.code === '23503') return res.status(409).json({ success: false, code: 'INVALID_REFERENCE', message: 'O vínculo informado não pertence a esta empresa ou não está disponível.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Requisição muito grande.' });
    if(error.code==='PDF_BUSY')res.set('Retry-After','5');
    const known = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
    res.status(known ? error.status : 503).json({ success: false, code: known ? error.code : 'SERVICE_UNAVAILABLE', message: known ? error.message : 'Não foi possível concluir a operação.' });
  });
  return app;
}
