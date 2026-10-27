import { gunzipSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const HOUR = 3600000;
export const MAX_XML_BYTES = 2 * 1024 * 1024;
export const UF_CODES = { RO:11, AC:12, AM:13, RR:14, PA:15, AP:16, TO:17, MA:21, PI:22, CE:23, RN:24, PB:25, PE:26, AL:27, SE:28, BA:29, MG:31, ES:32, RJ:33, SP:35, PR:41, SC:42, RS:43, MS:50, MT:51, GO:52, DF:53 };
export const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true,
  parseTagValue: false, parseAttributeValue: false, processEntities: false, trimValues: true });
export function parseXml(xml, limit = MAX_XML_BYTES) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > limit || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('INVALID_FISCAL_XML');
  // XMLParser leaves entities untouched with processEntities=false. Only allow
  // XML's five built-ins/numeric character references, never DTD expansions.
  return parser.parse(xml);
}
export function findNode(object, name) {
  if (!object || typeof object !== 'object') return undefined;
  if (Object.hasOwn(object, name)) return object[name];
  for (const child of Object.values(object)) {
    const found = findNode(child, name);
    if (found !== undefined) return found;
  }
}
export function nsu(value) {
  const text = String(value ?? '');
  if (!/^\d{1,15}$/.test(text)) throw new Error('INVALID_NSU');
  return text.padStart(15, '0');
}
export function parseDistribution(xml, monitor) {
  const data = findNode(parseXml(xml, 16 * 1024 * 1024), 'retDistDFeInt');
  if (!data || String(data.tpAmb) !== String(monitor.environment)) throw new Error('INVALID_DISTRIBUTION');
  const status = String(data.cStat);
  if (!['137', '138', '656'].includes(status)) return { status, documents: [], ultNSU: monitor.ultNSU, maxNSU: monitor.maxNSU };
  const ultNSU = status === '656' ? monitor.ultNSU : nsu(data.ultNSU);
  const maxNSU = status === '656' ? monitor.maxNSU : nsu(data.maxNSU);
  const documents = list(data.loteDistDFeInt?.docZip);
  if (documents.length > 50 || ultNSU < monitor.ultNSU || maxNSU < ultNSU || (status !== '138' && documents.length)) throw new Error('INVALID_DISTRIBUTION');
  let previous = monitor.ultNSU;
  for (const doc of documents) {
    const current = nsu(doc['@_NSU']);
    if (current <= previous || current > ultNSU) throw new Error('INVALID_DISTRIBUTION_ORDER');
    previous = current;
  }
  if (status === '138' && (!documents.length || ultNSU === monitor.ultNSU)) throw new Error('INVALID_DISTRIBUTION_PROGRESS');
  return { status, ultNSU, maxNSU, documents };
}
export function nextPoll(result, now = new Date()) {
  return new Date(+now + (result.status === '138' && result.ultNSU < result.maxNSU ? 15000 : HOUR + 5000));
}
const key = value => { if (!/^\d{6}[A-Z0-9]{12}\d{26}$/.test(String(value))) throw new Error('INVALID_ACCESS_KEY'); return String(value); };
const text = (value, max = 255) => String(value ?? '').slice(0, max)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const date = value => { const d = new Date(value); if (!Number.isFinite(+d)) throw new Error('INVALID_FISCAL_DATE'); return d; };
export function cents(value) {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(String(value))) throw new Error('INVALID_FISCAL_AMOUNT');
  const result = Math.round(Number(value) * 100);
  if (result > 2147483647) throw new Error('FISCAL_AMOUNT_TOO_LARGE');
  return result;
}
function decimal(value, scale) {
  if (!new RegExp(`^\\d{1,10}(\\.\\d{1,${scale}})?$`).test(String(value))) throw new Error('INVALID_FISCAL_QUANTITY');
  return String(value);
}
export function decodeDocument(docZip, monitor) {
  const encoded = typeof docZip === 'string' ? docZip : docZip['#text'];
  if (typeof encoded !== 'string' || encoded.length > 3 * 1024 * 1024 || !/^[A-Za-z0-9+/\s]+=*$/.test(encoded)) throw new Error('INVALID_DOCZIP');
  const inflated = gunzipSync(Buffer.from(encoded, 'base64'), { maxOutputLength: MAX_XML_BYTES });
  try {
    const xml = inflated.toString('utf8');
    const root = parseXml(xml);
    if (root.resNFe) {
      const n = root.resNFe, accessKey = key(n.chNFe);
      // Summaries have no recipient CNPJ; the mutual-TLS distribution query
      // establishes the recipient, and issuer documents are excluded here.
      if (String(n.CNPJ) === monitor.cnpj || accessKey.slice(20,22) !== '55' || String(n.tpNF) !== '1' || String(n.cSitNFe) === '2') return null;
      return { accessKey, supplierCnpj: text(n.CNPJ ?? n.CPF,14), supplierName: text(n.xNome),
        issuedAt: date(n.dhEmi), totalCents: cents(n.vNF), status: n.cSitNFe === '3' ? 'CANCELLED' : 'SUMMARY', items: [] };
    }
    if (root.nfeProc) {
      const n = root.nfeProc.NFe?.infNFe, protocol = root.nfeProc.protNFe?.infProt;
      if (!n || String(n.dest?.CNPJ) !== monitor.cnpj || String(n.emit?.CNPJ) === monitor.cnpj || String(n.ide?.mod) !== '55' || String(n.ide?.tpNF) !== '1') return null;
      if (!['100','150'].includes(String(protocol?.cStat)) || String(protocol.tpAmb) !== String(monitor.environment) || String(n.ide.tpAmb) !== String(monitor.environment)) throw new Error('INVALID_NFE_AUTHORIZATION');
      const accessKey = key(protocol.chNFe);
      const issuer = String(n.emit.CNPJ ?? n.emit.CPF ?? '');
      if (!/^(\d{11}|[A-Z0-9]{12}\d{2})$/.test(issuer) || n['@_Id'] !== `NFe${accessKey}` || accessKey.slice(6,20) !== issuer.padStart(14,'0')) throw new Error('INVALID_NFE_ID');
      const items = list(n.det);
      if (!items.length || items.length > 1000) throw new Error('INVALID_NFE_ITEMS');
      const seen = new Set();
      const parsed = items.map(item => {
        const p = item.prod, line = Number(item['@_nItem']);
        if (!p || !Number.isInteger(line) || line < 1 || line > 9999 || seen.has(line)) throw new Error('INVALID_NFE_LINE');
        seen.add(line);
        return { line, supplierCode: text(p.cProd,60), barcode: text(p.cEAN,30), name: text(p.xProd), unit: text(p.uCom,6), quantity: decimal(p.qCom,6), unitPrice: decimal(p.vUnCom,10), totalCents: cents(p.vProd) };
      });
      return { accessKey, supplierCnpj: issuer, supplierName: text(n.emit.xNome), number: text(n.ide.nNF,10), issuedAt: date(n.ide.dhEmi), totalCents: cents(n.total?.ICMSTot?.vNF), status: 'AVAILABLE', items: parsed, xml };
    }
    const event = root.procEventoNFe;
    if (event) {
      const info = event.evento?.infEvento, ret = event.retEvento?.infEvento;
      if (String(info?.tpEvento) !== '110111' || !['135','155'].includes(String(ret?.cStat))) return null;
      if (String(info.tpAmb) !== String(monitor.environment) || String(ret.chNFe) !== String(info.chNFe)) throw new Error('INVALID_CANCELLATION');
      return { accessKey: key(info.chNFe), status: 'CANCELLED', items: [] };
    }
    // resEvento and other distribution schemas do not authorize stock entry.
    return null;
  } finally { inflated.fill(0); }
}
