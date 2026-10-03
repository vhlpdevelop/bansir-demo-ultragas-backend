import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { attachBridgeGateway, closeBridgeGateway, listBridgeConnections, pingBridge } from '../src/modules/bridge/bridge.gateway.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgeDirectory = path.resolve(backendRoot, '..', 'bansir-bridge', 'publish', 'win-x64');
const bridgeExecutable = path.join(bridgeDirectory, 'Bansir.Bridge.exe');
const server = createServer();
attachBridgeGateway(server, { authenticate: async token => token === 'live-test-token' ? { id: 'live-test-credential', tenantKey: 'test' } : null });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const websocketPort = server.address().port;
const localPort = 17329;
const child = spawn(bridgeExecutable, [], {
  cwd: bridgeDirectory,
  windowsHide: true,
  env: { ...process.env, BANSIR_PDV_API_TOKEN: 'live-test-token', Bridge__Port: String(localPort), Bridge__BackendWebSocketUrl: `ws://127.0.0.1:${websocketPort}/api/v1/bridge/ws` },
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  let health;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${localPort}/health`);
      health = await response.json();
      if (health.backendWebSocket?.status === 'online' && health.backendWebSocket?.paired) break;
    } catch { }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(health?.backendWebSocket?.status, 'online');
  assert.equal(health?.backendWebSocket?.paired, true);
  const [connection] = listBridgeConnections();
  assert.equal(connection?.credentialId, 'live-test-credential');
  const pong = await pingBridge(connection.id, 2000);
  assert.equal(pong.connectionId, connection.id);
  console.log(`Bansir PDV ${health.version}: WebSocket autenticado e diagnóstico bidirecional confirmados.`);
} finally {
  child.kill();
  await closeBridgeGateway();
  await new Promise(resolve => server.close(resolve));
}
