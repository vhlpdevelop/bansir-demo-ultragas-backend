import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreSettings } from '../src/modules/settings/settings.model.js';

test('store settings accepts multiple independently identified payment terminals', async () => {
  const settings = new StoreSettings({
    _id: 'hardware-test',
    paymentTerminals: [
      { name: 'PagBank balcão', provider: 'pagbank', model: 'PAX', connectionType: 'usb' },
      { name: 'Itaú entrega', provider: 'itau_rede', model: 'Rede', connectionType: 'network' },
      { name: 'Caixa reserva', provider: 'caixa', model: 'TEF', connectionType: 'tef' }
    ]
  });
  await settings.validate();
  assert.equal(settings.paymentTerminals.length, 3);
  assert.equal(new Set(settings.paymentTerminals.map(item => String(item._id))).size, 3);
});

test('store settings rejects an unknown acquirer or terminal without model', async () => {
  await assert.rejects(new StoreSettings({ _id: 'invalid-provider', paymentTerminals: [{ name: 'Outra', provider: 'unknown', model: 'X', connectionType: 'usb' }] }).validate(), /provider/);
  await assert.rejects(new StoreSettings({ _id: 'missing-model', paymentTerminals: [{ name: 'PagBank', provider: 'pagbank', connectionType: 'usb' }] }).validate(), /model/);
});
