import test from 'node:test';
import assert from 'node:assert/strict';
import {consultCadastre} from '../src/postgres/wizard-cadastre.js';

function fixture({networkError, parseError = true} = {}) {
  const raw = '<retConsCad><infCons><cStat>111</cStat></infCons></retConsCad>';
  const agent = {options: {rejectUnauthorized: false}};
  const utility = {getSoapInfo: () => ({method: 'other'}), getSoapInfo1: () => ({
    method: 'http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4/', action: 'cadastro-action'})};
  const service = {utility, environment: {getHttpAgent: () => agent}};
  let options;
  const axios = {create: config => {options = config; return {post: async () => {
    if (networkError) throw networkError;
    return {data: raw};
  }};}};
  const wizard = {nfeWizardService: service, NFE_ConsultaCadastro: async () => {
    assert.equal(utility.getSoapInfo('MS', 'NfeConsultaCadastro').method.endsWith('/'), false);
    assert.equal(utility.getSoapInfo('MS', 'NfeConsultaCadastro').action, 'cadastro-action');
    assert.deepEqual(utility.getSoapInfo('MS', 'NFEAutorizacao'), {method: 'other'});
    await service.axios.post('https://example.test', '<ConsCad/>');
    if (parseError) throw TypeError('SDK parsing failure');
    return {unexpected: 'SDK converted response'};
  }};
  return {wizard, axios, raw, agent, options: () => options};
}
test('cadastro preserves raw SOAP despite SDK parser failure, with bounded verified transport', async () => {
  const f = fixture();
  assert.equal(await consultCadastre(f.wizard, {cnpj: '11222333000181', uf: 'MS'}, f.axios), f.raw);
  assert.equal(f.agent.options.rejectUnauthorized, true);
  assert.equal(f.options().maxRedirects, 0);
  assert.equal(f.options().timeout, 25000);
  assert.equal(f.options().maxContentLength, 2000000);
});
test('cadastro does not hide network failures or reuse a nonexistent response', async () => {
  const error = Error('connection failed');
  const f = fixture({networkError: error});
  await assert.rejects(consultCadastre(f.wizard, {}, f.axios), error);
});
