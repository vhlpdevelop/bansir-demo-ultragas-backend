import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function migrate(connectionString) {
  if (!connectionString) throw new Error('DATABASE_ADMIN_URL é obrigatória para migrações.');
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('bansir-postgres-migrations'))");
    await client.query(`CREATE SCHEMA IF NOT EXISTS bansir;
      REVOKE ALL ON SCHEMA bansir FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS bansir.schema_migrations (
        name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const directory = new URL('../../migrations/postgres/', import.meta.url);
    for (const name of (await readdir(directory)).filter(n => /^\d+_[\w-]+\.sql$/.test(n)).sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const { rows: [previous] } = await client.query('SELECT checksum FROM bansir.schema_migrations WHERE name=$1', [name]);
      if (previous) {
        if (previous.checksum !== checksum) throw new Error(`Migração aplicada foi alterada: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO bansir.schema_migrations(name,checksum) VALUES($1,$2)', [name, checksum]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.end(); }
}
