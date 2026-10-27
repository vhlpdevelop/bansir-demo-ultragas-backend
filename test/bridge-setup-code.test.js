import test from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeSetupCode } from '../src/modules/bridge/bridge-credential.service.js';

function decode(code) {
  return JSON.parse(Buffer.from(code.slice('bpdv1_'.length), 'base64url').toString('utf8'));
}

test('connection code carries the tenant API endpoint and opaque credential', () => {
  const code = createBridgeSetupCode('bpdv_identifier.secret', 'https://cliente-api.example.com');
  const profile = decode(code);
  assert.equal(profile.version, 1);
  assert.equal(profile.apiBaseUrl, 'https://cliente-api.example.com/api/v1');
  assert.equal(profile.webSocketUrl, 'wss://cliente-api.example.com/api/v1/bridge/ws');
  assert.equal(profile.apiToken, 'bpdv_identifier.secret');
});

test('connection code rejects an insecure remote endpoint', () => {
  assert.throws(() => createBridgeSetupCode('bpdv_identifier.secret', 'http://cliente-api.example.com'), /HTTPS/);
  assert.doesNotThrow(() => createBridgeSetupCode('bpdv_identifier.secret', 'http://localhost:5000'));
});
