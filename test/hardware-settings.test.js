import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreSettings } from '../src/modules/settings/settings.model.js';

test('store settings accepts multiple independently identified payment terminals', async () => {
  const settings = new StoreSettings({
    _id: 'hardware-test',
    paymentTerminals: [
      { name: 'PagBank balcão', provider: 'pagbank', model: 'PAX', connectionType: 'usb' },
      { name: 'Itaú entrega', provider: 'itau_rede', model: 'Rede', connectionType: 'network' },
      { name: 'Caixa reserva', provider: 'caixa', model: 'TEF', connectionType: 'tef' },
      { name: 'Sicredi', provider: 'sicredi', model: 'Move/5000 CL', connectionType: 'cloud', serialNumber: 'SN-123' },
      { name: 'Mercado Pago', provider: 'mercado_pago', model: 'Point Pro 3', connectionType: 'cloud', partNumber: 'PN-456' }
    ]
  });
  await settings.validate();
  assert.equal(settings.paymentTerminals.length, 5);
  assert.equal(new Set(settings.paymentTerminals.map(item => String(item._id))).size, 5);
  assert.equal(settings.paymentTerminals[3].serialNumber, 'SN-123');
  assert.equal(settings.paymentTerminals[4].partNumber, 'PN-456');
});

test('store settings rejects an unknown acquirer or terminal without model', async () => {
  await assert.rejects(new StoreSettings({ _id: 'invalid-provider', paymentTerminals: [{ name: 'Outra', provider: 'unknown', model: 'X', connectionType: 'usb' }] }).validate(), /provider/);
  await assert.rejects(new StoreSettings({ _id: 'missing-model', paymentTerminals: [{ name: 'PagBank', provider: 'pagbank', connectionType: 'usb' }] }).validate(), /model/);
});
