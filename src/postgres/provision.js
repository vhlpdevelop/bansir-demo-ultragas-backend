import pg from 'pg';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { productInput } from './catalog.js';

const roles = z.enum(['superadmin', 'admin', 'gerente_artesao', 'operador', 'entregador']);
export const foundationSnapshot = z.object({
  version: z.literal(1), foundationOnly: z.literal(true),
  tenant: z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/), name: z.string().trim().min(1).max(200) }).strict(),
  users: z.array(z.object({ legacyId: z.string().min(1), name: z.string().min(1).max(200), email: z.string().trim().toLowerCase().email(),
    passwordHash: z.string().regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/), role: roles,
    allowedRoutes: z.array(z.string().max(100)).max(100), active: z.boolean().default(true), phone: z.string().max(200).default('') }).strict()).min(1),
  categories: z.array(z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).default(''), color: z.string().max(200).default('#000fff') }).strict()),
  products: z.array(productInput.extend({ legacyId: z.string().min(1) })),
  settings: z.object({ storeName: z.string().default(''), pixKey: z.string().default(''), documentId: z.string().default(''), address: z.string().default(''), merchantCity: z.string().default('') }).strict(),
  pendingCollections: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() }).strict()).default([])
}).strict();

async function adminTransaction(connectionString, callback) {
  if (!connectionString) throw new Error('DATABASE_ADMIN_URL é obrigatória.');
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    const { rows: [role] } = await client.query('SELECT rolsuper OR rolbypassrls AS privileged FROM pg_roles WHERE rolname=current_user');
    if (!role?.privileged) throw new Error('Provisionamento exige credencial administrativa com bypass RLS, separada da aplicação.');
    await client.query('BEGIN');
    try { const result = await callback(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
  } finally { await client.end(); }
}

export async function provisionTenant(connectionString, input) {
  const data = z.object({ slug: foundationSnapshot.shape.tenant.shape.slug, name: z.string().trim().min(1).max(200),
    adminName: z.string().trim().min(1).max(200), email: z.string().trim().toLowerCase().email(),
    password: z.string().min(12).max(72),planCode:z.string().min(1).default('migration-single') }).strict().parse(input);
  const hash = await bcrypt.hash(data.password, 12);
  return adminTransaction(connectionString, async client => {
    const existing = await client.query('SELECT 1 FROM bansir.users WHERE email=$1', [data.email]);
    if (existing.rowCount) throw new Error('A identidade já existe. Vincule-a em um fluxo administrativo próprio; não redefina sua senha pelo bootstrap.');
    const { rows: [tenant] } = await client.query('INSERT INTO bansir.tenants(slug,name,plan_code) VALUES($1,$2,$3) RETURNING id,slug,name', [data.slug, data.name,data.planCode]);
    const { rows: [user] } = await client.query('INSERT INTO bansir.users(email,name,password_hash) VALUES($1,$2,$3) RETURNING id', [data.email, data.adminName, hash]);
    await client.query(`INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes) VALUES($1,$2,'admin',ARRAY['products','settings'])`, [tenant.id, user.id]);
    const {rows:[establishment]}=await client.query('INSERT INTO bansir.establishments(tenant_id,name) VALUES($1,$2) RETURNING id', [tenant.id, data.name]);
    await client.query(`INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes)
      VALUES($1,$2,$3,'admin',ARRAY['products','settings'])`,[tenant.id,establishment.id,user.id]);
    await client.query('UPDATE bansir.establishments SET owner_user_id=$2 WHERE id=$1 AND tenant_id=$3',[establishment.id,user.id,tenant.id]);
    await client.query('INSERT INTO bansir.store_settings(tenant_id,store_name,establishment_id) VALUES($1,$2,$3)', [tenant.id, data.name,establishment.id]);
    return {...tenant,establishmentId:establishment.id};
  });
}

export async function importFoundation(connectionString, input) {
  const snapshot = foundationSnapshot.parse(input);
  if (!snapshot.users.some(u => u.active && ['admin', 'superadmin'].includes(u.role))) throw new Error('O snapshot precisa de um administrador ativo.');
  const checksum = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return adminTransaction(connectionString, async client => {
    // Serialize a retry for the same business without locking other tenants.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`foundation:${snapshot.tenant.slug}`]);
    const { rows: [existing] } = await client.query(`SELECT t.id,i.source_sha256 FROM bansir.tenants t
      LEFT JOIN bansir.foundation_imports i ON i.tenant_id=t.id WHERE t.slug=$1`, [snapshot.tenant.slug]);
    if (existing) {
      if (existing.source_sha256 === checksum) return { tenantId: existing.id, alreadyApplied: true };
      throw new Error('Tenant já existe com outra origem. Importação interrompida para preservar dados operacionais.');
    }
    const { rows: [tenant] } = await client.query('INSERT INTO bansir.tenants(slug,name) VALUES($1,$2) RETURNING id', [snapshot.tenant.slug, snapshot.tenant.name]);
    let initialAdmin;
    for (const user of snapshot.users) {
      // Conflicting global identities need reconciliation, never password overwrite.
      const { rows: [previous] } = await client.query('SELECT id,password_hash FROM bansir.users WHERE email=$1', [user.email]);
      if (previous && previous.password_hash !== user.passwordHash) throw new Error('Identidade existente com credenciais divergentes. Reconcilie antes de importar.');
      let id = previous?.id;
      if (!id) {
        const { rows: [created] } = await client.query('INSERT INTO bansir.users(email,name,password_hash,active,phone) VALUES($1,$2,$3,$4,$5) RETURNING id', [user.email, user.name, user.passwordHash, user.active, user.phone]);
        id = created.id;
      }
      await client.query('INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes,active,legacy_user_id) VALUES($1,$2,$3,$4,$5,$6)', [tenant.id, id, user.role, user.allowedRoutes, user.active, user.legacyId]);
      if (user.active && ['admin', 'superadmin'].includes(user.role)) initialAdmin ||= id;
    }
    const {rows:[establishment]}=await client.query('INSERT INTO bansir.establishments(tenant_id,name,document_id) VALUES($1,$2,$3) RETURNING id', [tenant.id, snapshot.tenant.name, snapshot.settings.documentId]);
    await client.query(`INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes,active)
      SELECT tenant_id,$2,user_id,role,allowed_routes,active FROM bansir.tenant_memberships WHERE tenant_id=$1`,[tenant.id,establishment.id]);
    const s = snapshot.settings;
    await client.query(`INSERT INTO bansir.store_settings(tenant_id,store_name,pix_key,document_id,address,merchant_city,establishment_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [tenant.id, s.storeName, s.pixKey, s.documentId, s.address, s.merchantCity,establishment.id]);
    for (const c of snapshot.categories) await client.query('INSERT INTO bansir.categories(tenant_id,name,description,color,establishment_id) VALUES($1,$2,$3,$4,$5)', [tenant.id, c.name, c.description, c.color,establishment.id]);
    for (const p of snapshot.products) {
      const { rows: [product] } = await client.query(`INSERT INTO bansir.products
        (tenant_id,legacy_id,name,barcode,price_cents,cost_cents,stock,category,sku,unit,brand,specs,ncm,active,establishment_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [tenant.id, p.legacyId, p.name, p.barcode, Math.round(p.price * 100), Math.round((p.costPrice || 0) * 100), p.stock || 0,
        p.category || 'Gás de Cozinha', p.sku || '', p.unit || 'UN', p.brand || '', p.specs || '', p.ncm || '', p.active ?? true,establishment.id]);
      if (p.stock) await client.query(`INSERT INTO bansir.stock_movements(tenant_id,product_id,quantity,type,unit_price_cents,reason,user_id,establishment_id)
        VALUES($1,$2,$3,'in',$4,'Saldo de abertura importado do MongoDB',$5,$6)`, [tenant.id, product.id, p.stock, Math.round((p.costPrice || 0) * 100), initialAdmin,establishment.id]);
    }
    await client.query('INSERT INTO bansir.foundation_imports(tenant_id,source_sha256) VALUES($1,$2)', [tenant.id, checksum]);
    return { tenantId: tenant.id, alreadyApplied: false, counts: { users: snapshot.users.length, categories: snapshot.categories.length, products: snapshot.products.length }, pendingCollections: snapshot.pendingCollections };
  });
}

export async function assignPlan(connectionString,input) {
  const data=z.object({tenantSlug:z.string().min(1),code:z.string().min(1).max(100),name:z.string().min(1).max(200),
    maxEstablishments:z.number().int().positive().max(100000)}).strict().parse(input);
  return adminTransaction(connectionString,async client=>{
    await client.query(`INSERT INTO bansir.plans(code,name,max_establishments) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[data.code,data.name,data.maxEstablishments]);
    const {rows:[plan]}=await client.query('SELECT * FROM bansir.plans WHERE code=$1',[data.code]);
    if (!plan.active || plan.max_establishments!==data.maxEstablishments) throw new Error('Código de plano já possui outra capacidade ou está inativo.');
    const {rows:[tenant]}=await client.query('UPDATE bansir.tenants SET plan_code=$2 WHERE slug=$1 RETURNING id,plan_code',[data.tenantSlug,data.code]);
    if (!tenant) throw new Error('Empresa não encontrada.');
    return tenant;
  });
}
export async function assignEstablishmentOwner(connectionString,input){
 const data=z.object({tenantSlug:z.string().min(1),establishmentId:z.uuid(),userId:z.uuid()}).strict().parse(input);
 return adminTransaction(connectionString,async c=>{
  const member=(await c.query(`SELECT em.tenant_id FROM bansir.establishment_memberships em JOIN bansir.tenants t ON t.id=em.tenant_id JOIN bansir.users u ON u.id=em.user_id
   WHERE t.slug=$1 AND em.establishment_id=$2 AND em.user_id=$3 AND em.active AND u.active`,[data.tenantSlug,data.establishmentId,data.userId])).rows[0];
  if(!member)throw new Error('O dono deve possuir vínculo ativo com o estabelecimento.');
  await c.query('UPDATE bansir.establishments SET owner_user_id=$3 WHERE tenant_id=$1 AND id=$2',[member.tenant_id,data.establishmentId,data.userId]);
  return {establishmentId:data.establishmentId,ownerUserId:data.userId};
 });
}
export async function createEstablishment(connectionString,input) {
  const data=z.object({tenantSlug:z.string().min(1),name:z.string().trim().min(1).max(200),documentId:z.string().max(100).default(''),
    memberships:z.array(z.object({userId:z.string().uuid(),role:roles,allowedRoutes:z.array(z.string().max(100)).max(100)}).strict()).min(1).max(1000)}).strict().parse(input);
  return adminTransaction(connectionString,async client=>{
    const {rows:[tenant]}=await client.query('SELECT id FROM bansir.tenants WHERE slug=$1 AND active',[data.tenantSlug]);
    if (!tenant) throw new Error('Empresa não encontrada ou inativa.');
    const {rows:[unit]}=await client.query('INSERT INTO bansir.establishments(tenant_id,name,document_id) VALUES($1,$2,$3) RETURNING id,name',[tenant.id,data.name,data.documentId]);
    for (const m of data.memberships) await client.query(`INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes)
      VALUES($1,$2,$3,$4,$5)`,[tenant.id,unit.id,m.userId,m.role,m.allowedRoutes]);
    await client.query('INSERT INTO bansir.store_settings(tenant_id,establishment_id,store_name,document_id) VALUES($1,$2,$3,$4)',[tenant.id,unit.id,data.name,data.documentId]);
    return {tenantId:tenant.id,establishmentId:unit.id,name:unit.name};
  });
}
