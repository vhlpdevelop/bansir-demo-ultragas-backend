import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { configureVapid } from '../src/config/vapid.js';

test('VAPID validates matching keys and normalizes pasted quotes/whitespace', () => {
  const keys = webpush.generateVAPIDKeys();
  const state = configureVapid(webpush, { VAPID_PUBLIC_KEY: ` "${keys.publicKey}" `, VAPID_PRIVATE_KEY: ` '${keys.privateKey}' ` });
  assert.equal(state.configured, true);
  assert.equal(state.publicKey, keys.publicKey);
});

test('invalid, missing and mismatched keys disable push without crashing or leaking secrets', () => {
  const keys = webpush.generateVAPIDKeys();
  const other = webpush.generateVAPIDKeys();
  for (const privateKey of ['', 'not-a-valid-key', keys.publicKey, other.privateKey]) {
    const messages = [];
    const result = configureVapid(webpush, { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: privateKey }, text => messages.push(text));
    assert.equal(result.configured, false);
    assert.equal(result.publicKey, '');
    assert.equal(messages.length, 1);
    assert.ok(!messages[0].includes(keys.publicKey));
    if (privateKey) assert.ok(!messages[0].includes(privateKey));
  }
  assert.equal(configureVapid(webpush, {}).configured, false);
});
