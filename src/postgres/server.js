import { config } from '../config/env.js';
import { createDatabase } from './database.js';
import { createPostgresApp } from './app.js';

export async function startPostgresServer() {
  if (config.nodeEnv === 'production' && process.env.DATABASE_ADMIN_URL) {
    throw new Error('Remova DATABASE_ADMIN_URL do processo da API de produção.');
  }
  const database = createDatabase({ connectionString: process.env.DATABASE_URL });
  try {
    await database.ready();
    const app = createPostgresApp({ database, jwtSecret: config.jwtSecret, corsOrigin: config.corsOrigin,
      nodeEnv: config.nodeEnv, expiresIn: process.env.POSTGRES_JWT_EXPIRES_IN || '10m' });
    const server = app.listen(config.port, () => console.log(`[Bansir] PostgreSQL multi-tenant, porta ${config.port}. PDV, caixa, recebimentos, catálogo e filas de notificações/fiscal.`));
    app.locals.bridge.attach(server);
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      const timeout = setTimeout(() => { server.closeAllConnections(); }, 15000);
      timeout.unref();
      app.locals.bridge.close().catch(()=>{});
      server.close(async () => { clearTimeout(timeout); await database.close(); });
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    return { server, database, stop };
  } catch (error) { await database.close(); throw error; }
}
