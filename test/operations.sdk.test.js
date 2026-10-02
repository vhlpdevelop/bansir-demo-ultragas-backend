import test from 'node:test';
import assert from 'node:assert/strict';
import { runWizard } from '../src/modules/operations/fiscal.adapter.js';
import { accessKey } from '../src/modules/operations/operation.policy.js';

test('installed NFeWizard packages fail safely before submission with missing test certificate', { timeout: 120000 }, async () => {
  // Fake configuration in this test process only; no user's certificate is loaded.
  process.env.FISCAL_CNPJ = '12345678000195';
  process.env.FISCAL_CERT_PATH = new URL('./not-a-certificate.pfx', import.meta.url).pathname;
  process.env.FISCAL_CERT_PASSWORD = 'not-a-real-password';
  process.env.FISCAL_CSC_ID = '1'; process.env.FISCAL_CSC_TOKEN = 'not-a-real-csc';
  for (const model of ['55', '65']) {
    const key = accessKey({ cnpj: process.env.FISCAL_CNPJ, model, series: 1, number: 1, code: '12345678', issuedAt: '2026-09-28T12:00:00-04:00' });
    await assert.rejects(runWizard('emit', { mode: 'homologation', model, fiscalKey: key, fiscalPayload: {} }), error => error.notSubmitted === true);
  }
});
