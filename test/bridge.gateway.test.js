import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { attachBridgeGateway, closeBridgeGateway, listBridgeConnections, pingBridge } from '../src/modules/bridge/bridge.gateway.js';

test('Bridge WebSocket handshake, heartbeat metadata and diagnostic round trip', async t => {
  const server = createServer(); attachBridgeGateway(server, { authenticate: async token => token === 'test-token' ? { id: 'credential-test', tenantKey: 'test' } : null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await closeBridgeGateway(); await new Promise(resolve => server.close(resolve)); });
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/v1/bridge/ws`, { headers: { Authorization: 'Bearer test-token' } });
  const hello = await new Promise((resolve, reject) => { socket.once('message', value => resolve(JSON.parse(value))); socket.once('error', reject); });
  assert.equal(hello.type, 'server.hello'); assert.deepEqual(hello.capabilities, ['diagnostics']);
  socket.send(JSON.stringify({ type: 'bridge.hello', protocolVersion: 1, installationId: 'installation-test', machine: 'CAIXA-1', version: '0.2.0' }));
  await new Promise(resolve => socket.once('message', resolve));
  assert.equal(listBridgeConnections()[0].machine, 'CAIXA-1');
  socket.on('message', raw => { const message = JSON.parse(raw); if (message.type === 'diagnostics.ping') socket.send(JSON.stringify({ type: 'diagnostics.pong', correlationId: message.correlationId, timestamp: new Date().toISOString() })); });
  assert.equal((await pingBridge(hello.connectionId, 1000)).connectionId, hello.connectionId);
  socket.close();
});

test('Bridge WebSocket rejects missing API token', async t => {
  const server = createServer(); attachBridgeGateway(server, { authenticate: async () => null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await closeBridgeGateway(); await new Promise(resolve => server.close(resolve)); });
  const status = await new Promise(resolve => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/v1/bridge/ws`);
    socket.once('unexpected-response', (_, response) => resolve(response.statusCode));
    socket.once('error', () => resolve(0));
  });
  assert.equal(status, 401);
});
