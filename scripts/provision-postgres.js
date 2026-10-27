import '../src/config/env.js';
import { provisionTenant } from '../src/postgres/provision.js';
try {
  const tenant = await provisionTenant(process.env.DATABASE_ADMIN_URL, { slug: process.env.BOOTSTRAP_TENANT_SLUG,
    name: process.env.BOOTSTRAP_TENANT_NAME, adminName: process.env.BOOTSTRAP_ADMIN_NAME,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL, password: process.env.BOOTSTRAP_ADMIN_PASSWORD,planCode:process.env.BOOTSTRAP_PLAN_CODE || 'migration-single' });
  console.log(`Empresa provisionada: ${tenant.slug}. Credenciais não são exibidas.`);
} catch { console.error('Provisionamento não concluído. Verifique dados, senha de 12–72 caracteres e se empresa/identidade já existem.'); process.exitCode = 1; }
