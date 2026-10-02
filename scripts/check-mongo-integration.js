import { config } from '../src/config/env.js';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
const uri = new URL(config.mongoUri);
uri.pathname = `/bansir_test_${randomBytes(10).toString('hex')}`;
const child = spawn(process.execPath, ['--test', 'test/mongo.integration.test.js'], {
  cwd: new URL('../', import.meta.url), stdio: 'inherit',
  env: { ...process.env, MONGODB_TEST_URI: uri.toString() }
});
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', () => { console.error('Não foi possível iniciar o teste.'); process.exitCode = 1; });
