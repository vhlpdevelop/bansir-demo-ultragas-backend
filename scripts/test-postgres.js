// Creates/removes only its own disposable Docker container; never uses app URLs.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../src/postgres/migrate.js';

const exec = promisify(execFile);
const suffix = randomBytes(6).toString('hex');
const name = `bansir-ultragas-test-${suffix}`;
const database = `bansir_test_${suffix}`;
const password = randomBytes(24).toString('hex');
const allowedTests=['test/postgres.integration.test.js','test/workers.integration.test.js','test/pdv.integration.test.js','test/storefront.integration.test.js','test/jasley-import.integration.test.js','test/password.integration.test.js'];
const selectedTests=process.argv.length>2?process.argv.slice(2):allowedTests;
if(selectedTests.some(file=>!allowedTests.includes(file)))throw new Error('Arquivo de teste não permitido.');
let created = false;
try {
  await exec('docker', ['run', '--detach', '--rm', '--name', name, '--publish', '127.0.0.1::5432',
    '--env', `POSTGRES_PASSWORD=${password}`, '--env', `POSTGRES_DB=${database}`, 'postgres:17-alpine']);
  created = true;
  const { stdout } = await exec('docker', ['port', name, '5432/tcp']);
  const port = stdout.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port) throw new Error('Porta de teste inválida.');
  const adminUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    const connection = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 1000 });
    try { await connection.connect(); await connection.query('SELECT 1'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    finally { await connection.end().catch(() => {}); }
  }
  if (!ready) throw new Error('PostgreSQL de teste não iniciou.');
  await migrate(adminUrl);
  // Re-applying unchanged migrations must be harmless.
  await migrate(adminUrl);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Password is generated hexadecimal, never taken from untrusted input.
    await admin.query(`CREATE ROLE bansir_test_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT bansir_runtime TO bansir_test_app`);
    await admin.query(`CREATE ROLE bansir_test_worker LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT bansir_worker TO bansir_test_worker`);
  } finally { await admin.end(); }
  const runtimeUrl = `postgresql://bansir_test_app:${password}@127.0.0.1:${port}/${database}`;
  process.exitCode=0;
  for(const testFile of selectedTests){
   const result=await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test',testFile], {
      cwd: new URL('../', import.meta.url), stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test', TEST_POSTGRES_ADMIN_URL: adminUrl, TEST_POSTGRES_URL: runtimeUrl,TEST_WORKER_URL:`postgresql://bansir_test_worker:${password}@127.0.0.1:${port}/${database}` }
    });
    child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
  });
   if(result)process.exitCode=result;
  }
} catch (error) {
  console.error('Teste PostgreSQL não concluído:', error.code || error.message);
  process.exitCode = 1;
} finally {
  if (created) await exec('docker', ['rm', '--force', name]).catch(() => { console.error(`Remova o container de teste ${name} ao terminar.`); });
}
