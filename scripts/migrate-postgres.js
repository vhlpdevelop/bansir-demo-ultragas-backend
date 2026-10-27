import '../src/config/env.js';
import { migrate } from '../src/postgres/migrate.js';
try { await migrate(process.env.DATABASE_ADMIN_URL); console.log('Migrações PostgreSQL aplicadas.'); }
catch { console.error('Migração não concluída. Verifique o acesso administrativo e o histórico de migrações.'); process.exitCode = 1; }
