import { fork } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { accessKey, fail } from './operation.policy.js';

export function fiscalReady(model = '65', env = process.env) {
  return ['FISCAL_CNPJ', 'FISCAL_CERT_PATH', 'FISCAL_CERT_PASSWORD', ...(model === '65' ? ['FISCAL_CSC_ID', 'FISCAL_CSC_TOKEN'] : [])].filter(k => !env[k]);
}
export function fiscalIdentity(op, number) {
  const cnpj = process.env.FISCAL_CNPJ || '';
  if (!/^\d{14}$/.test(cnpj)) fail('Configure FISCAL_CNPJ com 14 dígitos.');
  const series = Number(process.env.FISCAL_SERIES || 1);
  if (!Number.isInteger(series) || series < 1 || series > 889 || number > 999999999) fail('Série ou numeração fiscal inválida.');
  // MS is UTC-4; retain the local month used in the access key.
  const issuedAt = new Date(Date.now() - 4 * 3600000).toISOString().slice(0, 19) + '-04:00';
  const code = String(randomInt(100000000)).padStart(8, '0');
  return { fiscalNumber: number, fiscalSeries: series, fiscalIssuedAt: issuedAt, fiscalCode: code,
    fiscalKey: accessKey({ cnpj, model: op.model, series, number, code, issuedAt }) };
}
export function draftFor(op) {
  return { emit: { CNPJCPF: process.env.FISCAL_CNPJ || '', xNome: '', IE: '', CRT: 1,
    enderEmit: { xLgr: '', nro: '', xBairro: '', cMun: 5002209, xMun: 'Bonito', UF: 'MS', CEP: '', cPais: 1058, xPais: 'BRASIL' } },
    ...(op.model === '55' ? { dest: { CNPJCPF: '', xNome: 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL', indIEDest: 9, enderDest: {} } } : {}),
    det: op.items.map((i, index) => ({ nItem: index + 1, prod: { cProd: i.productId, cEAN: 'SEM GTIN', xProd: i.name,
      NCM: '', CFOP: '', uCom: 'UN', qCom: i.quantity, vUnCom: i.unitCents / 100, vProd: i.quantity * i.unitCents / 100,
      cEANTrib: 'SEM GTIN', uTrib: 'UN', qTrib: i.quantity, vUnTrib: i.unitCents / 100, indTot: 1 }, imposto: {} })),
    total: { ICMSTot: { vBC: 0, vICMS: 0, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vFCPSTRet: 0,
      vProd: op.totalCents / 100, vFrete: 0, vSeg: 0, vDesc: 0, vII: 0, vIPI: 0, vIPIDevol: 0, vPIS: 0, vCOFINS: 0, vOutro: 0, vNF: op.totalCents / 100 } },
    transp: { modFrete: 9 }
  };
}
export function preparePayload(op, draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) fail('Informe o rascunho fiscal.');
  if (JSON.stringify(draft).length > 150000) fail('Rascunho fiscal muito grande.');
  if (draft.emit?.CNPJCPF !== process.env.FISCAL_CNPJ || !draft.emit?.IE || !draft.emit?.xNome || draft.emit?.enderEmit?.UF !== 'MS') fail('Preencha emitente e inscrição estadual de MS.');
  if (op.model === '55' && !draft.dest?.CNPJCPF) fail('NF-e exige destinatário identificado.');
  if (draft.dest?.enderDest?.UF && draft.dest.enderDest.UF !== 'MS') fail('Esta etapa de homologação contempla operações internas em MS.');
  if (!Array.isArray(draft.det) || draft.det.length !== op.items.length) fail('Itens fiscais não correspondem à venda.');
  draft.det.forEach((d, index) => {
    const i = op.items[index]; const p = d.prod;
    if (p?.cProd !== i.productId || Number(p.qCom) !== i.quantity || Math.round(Number(p.vUnCom) * 100) !== i.unitCents || Math.round(Number(p.vProd) * 100) !== i.quantity * i.unitCents) fail('Valores fiscais diferem do pedido.');
    if (!/^\d{8}$/.test(String(p.NCM)) || !/^\d{4}$/.test(String(p.CFOP)) || !d.imposto?.ICMS || !d.imposto?.PIS || !d.imposto?.COFINS) fail('Preencha NCM, CFOP e tributação de cada item com orientação contábil.');
  });
  const totals = draft.total?.ICMSTot;
  if (Math.round(Number(totals?.vNF) * 100) !== op.totalCents || Math.round(Number(totals?.vProd) * 100) !== op.totalCents) fail('Total fiscal diferente do pagamento.');
  const payment = op.paymentEvidence?.payments?.[0];
  const card = { tpIntegra: 1, CNPJ: '01027058000191', ...(payment?.authorization ? { cAut: payment.authorization } : {}) };
  const infNFe = { ...structuredClone(draft), Id: op.fiscalKey, versao: '4.00', ide: {
    cUF: 50, cNF: op.fiscalCode, natOp: 'VENDA', mod: Number(op.model), serie: op.fiscalSeries, nNF: op.fiscalNumber,
    dhEmi: op.fiscalIssuedAt, tpNF: 1, idDest: 1, cMunFG: Number(draft.emit.enderEmit.cMun), tpImp: op.model === '65' ? 4 : 1,
    tpEmis: 1, cDV: Number(op.fiscalKey.slice(-1)), tpAmb: 2, finNFe: 1, indFinal: 1, indPres: 1, procEmi: 0, verProc: 'Bansir-1'
  }, pag: { detPag: [{ indPag: op.installments > 1 ? 1 : 0, tPag: op.method === 'credit' ? '03' : '04', vPag: op.totalCents / 100, card }] } };
  if (infNFe.dest) infNFe.dest.xNome = 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
  if (op.model === '65') infNFe.det[0].prod.xProd = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';
  return { idLote: op.fiscalNumber, indSinc: 1, NFe: infNFe ? { infNFe } : null };
}
export function runWizard(action, op) {
  if (fiscalReady(op.model).length) fail('Certificado A1, emitente ou CSC de homologação não configurados.', 503);
  if (op.mode !== 'homologation' || !/^\d{44}$/.test(op.fiscalKey || '') || op.fiscalKey.slice(6, 20) !== process.env.FISCAL_CNPJ) fail('Emitente atual não corresponde à chave da operação.', 409);
  return new Promise((resolve, reject) => {
    // Isolate library global logger/environment and bound the full operation, including retries.
    const child = fork(new URL('./wizard.runner.js', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Tempo fiscal esgotado. Consulte a chave antes de reenviar.')); }, 90000);
    let received = false;
    child.once('message', message => {
      received = true; clearTimeout(timer);
      if (message.ok) resolve(message.data);
      else reject(Object.assign(new Error(message.rejection || 'NFeWizard não concluiu a operação.'), { notSubmitted: message.stage === 'setup', rejection: message.rejection }));
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Não foi possível iniciar o serviço fiscal.')); });
    child.once('exit', () => { clearTimeout(timer); if (!received) reject(new Error('Serviço fiscal interrompido. Consulte a chave.')); });
    child.send({ action, model: op.model, key: op.fiscalKey, payload: op.fiscalPayload });
  });
}
