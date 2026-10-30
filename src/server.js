import './config/env.js';

try {
  if (process.env.DATABASE_ENGINE && process.env.DATABASE_ENGINE !== 'postgres') {
    throw new Error('Este backend utiliza somente PostgreSQL. Defina DATABASE_ENGINE=postgres.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL do PostgreSQL é obrigatória.');
  const {startPostgresServer} = await import('./postgres/server.js');
  await startPostgresServer();
} catch (error) {
  console.error('Falha ao iniciar o servidor:', error.message);
  process.exitCode = 1;
}
