import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateBridgeToken } from './bridge-credential.service.js';
import { StoreSettings } from '../settings/settings.model.js';

const connections = new Map();
const pendingPings = new Map();
let gateway;

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

const loadConfiguredTerminals = async () => (await StoreSettings.findById('store').select('paymentTerminals').lean())?.paymentTerminals || [];

export function attachBridgeGateway(server, { authenticate = authenticateBridgeToken, loadTerminals = loadConfiguredTerminals } = {}) {
  if (gateway) return gateway;
  gateway = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', async (request, socket, head) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (path !== '/api/v1/bridge/ws') return socket.destroy();
    try {
      const header = request.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      const credential = await authenticate(token);
      if (!credential) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return socket.destroy();
      }
      request.bridgeCredential = credential;
      gateway.handleUpgrade(request, socket, head, client => gateway.emit('connection', client, request));
    } catch {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });
  gateway.on('connection', (socket, request) => {
    const id = randomUUID();
    const connection = { id, socket, credentialId: String(request.bridgeCredential?._id || request.bridgeCredential?.id || ''), tenantKey: request.bridgeCredential?.tenantKey || 'default', installationId: '', machine: '', version: '', connectedAt: new Date(), lastSeenAt: new Date(), alive: true, paired: true, terminalStatuses: new Map() };
    connections.set(id, connection);
    send(socket, { type: 'server.hello', connectionId: id, protocolVersion: 1, heartbeatSeconds: 20, capabilities: ['diagnostics'] });
    socket.on('pong', () => { connection.alive = true; connection.lastSeenAt = new Date(); });
    socket.on('message', async raw => {
      try {
        const message = JSON.parse(raw.toString());
        connection.lastSeenAt = new Date();
        if (message.type === 'bridge.hello' && message.protocolVersion === 1) {
          connection.installationId = String(message.installationId || '').slice(0, 100);
          connection.machine = String(message.machine || '').slice(0, 100);
          connection.version = String(message.version || '').slice(0, 30);
          send(socket, { type: 'bridge.accepted', connectionId: id, paired: true, capabilities: ['diagnostics'] });
          sendTerminalConfiguration(socket, await loadTerminals());
        } else if (message.type === 'diagnostics.pong' && pendingPings.has(message.correlationId)) {
          pendingPings.get(message.correlationId).resolve({ connectionId: id, receivedAt: new Date(), bridgeTimestamp: message.timestamp });
          pendingPings.delete(message.correlationId);
        } else if (message.type === 'terminal.status' && Array.isArray(message.terminals)) {
          connection.terminalStatuses.clear();
          for (const terminal of message.terminals.slice(0, 20)) {
            const terminalId = String(terminal.terminalId || '');
            const status = String(terminal.status || 'disconnected');
            if (/^[a-f\d]{24}$/i.test(terminalId) && ['connected', 'ready', 'busy', 'disconnected', 'error', 'not_supported'].includes(status))
              connection.terminalStatuses.set(terminalId, { status, lastSeenAt: new Date() });
          }
        }
      } catch { send(socket, { type: 'error', code: 'INVALID_MESSAGE' }); }
    });
    socket.on('close', () => connections.delete(id));
  });
  const heartbeat = setInterval(() => {
    for (const connection of connections.values()) {
      if (!connection.alive) { connection.socket.terminate(); continue; }
      connection.alive = false; connection.socket.ping();
    }
  }, 20000);
  heartbeat.unref();
  gateway.on('close', () => clearInterval(heartbeat));
  return gateway;
}

export function listBridgeConnections() {
  return [...connections.values()].map(({ socket, alive, terminalStatuses, ...connection }) => ({ ...connection, status: socket.readyState === WebSocket.OPEN ? 'online' : 'offline' }));
}

function sendTerminalConfiguration(socket, terminals) {
  send(socket, { type: 'configuration.terminals', terminals: terminals.filter(item => item.enabled !== false).map(item => ({ terminalId: String(item._id), name: item.name, provider: item.provider, model: item.model, connectionType: item.connectionType, deviceIdentifier: item.deviceIdentifier || '', serialNumber: item.serialNumber || '', partNumber: item.partNumber || '' })) });
}

export function broadcastTerminalConfiguration(terminals) {
  for (const connection of connections.values()) sendTerminalConfiguration(connection.socket, terminals);
}

export function getTerminalStatuses() {
  const result = new Map();
  for (const connection of connections.values()) for (const [terminalId, current] of connection.terminalStatuses) {
    const previous = result.get(terminalId);
    if (!previous || ['connected', 'ready', 'busy'].includes(current.status)) result.set(terminalId, current);
  }
  return result;
}

export function pingBridge(connectionId, timeoutMs = 5000) {
  const connection = connections.get(connectionId);
  if (!connection || connection.socket.readyState !== WebSocket.OPEN) throw new Error('Bansir Bridge não está conectado.');
  const correlationId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingPings.delete(correlationId); reject(new Error('Bansir Bridge não respondeu ao diagnóstico.')); }, timeoutMs);
    pendingPings.set(correlationId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    send(connection.socket, { type: 'diagnostics.ping', correlationId, timestamp: new Date().toISOString() });
  });
}

export function disconnectBridgeCredential(credentialId) {
  for (const connection of connections.values()) {
    if (connection.credentialId === String(credentialId)) connection.socket.close(1008, 'Credencial revogada');
  }
}

export async function closeBridgeGateway() {
  if (!gateway) return;
  const closing = gateway;
  for (const connection of connections.values()) connection.socket.terminate();
  await new Promise(resolve => closing.close(resolve)); gateway = undefined; connections.clear();
  for (const pending of pendingPings.values()) pending.reject(new Error('Gateway encerrado.'));
  pendingPings.clear();
}
