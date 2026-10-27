import '../src/config/env.js';
import { readFile } from 'node:fs/promises';
import { foundationSnapshot, importFoundation } from '../src/postgres/provision.js';
try {
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (process.argv.includes('--plan')) {
    const data = foundationSnapshot.parse(input);
    console.log(JSON.stringify({ tenant: data.tenant.slug, users: data.users.length, categories: data.categories.length,
      products: data.products.length, pendingCollections: data.pendingCollections, applied: false }, null, 2));
  } else console.log(JSON.stringify(await importFoundation(process.env.DATABASE_ADMIN_URL, input), null, 2));
} catch { console.error('Importação não concluída. Verifique snapshot, privilégio administrativo e possíveis conflitos. Nenhum lote parcial é confirmado.'); process.exitCode = 1; }
