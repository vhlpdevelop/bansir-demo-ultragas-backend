import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['--test', 'test/operations.test.js', 'test/operations.integration.test.js', 'test/operations.sdk.test.js'], {
  stdio: 'inherit', env: { ...process.env, RUN_OPERATIONS_INTEGRATION: '1' }
});
child.once('exit', code => { process.exitCode = code ?? 1; });
