import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BridgeCredential } from './bridge-credential.model.js';

const hash = value => createHash('sha256').update(value).digest('hex');

export function createBridgeSetupCode(apiToken, publicApiUrl) {
  if (!apiToken?.startsWith('bpdv_')) throw new Error('Token interno do Bansir PDV inválido.');
  const parsed = new URL(publicApiUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) throw new Error('A URL pública do Bansir PDV deve usar HTTPS.');
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  const apiBaseUrl = `${parsed.origin}${cleanPath.endsWith('/api/v1') ? cleanPath : `${cleanPath}/api/v1`}`;
  const webSocketUrl = `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}${new URL(apiBaseUrl).pathname}/bridge/ws`;
  const profile = Buffer.from(JSON.stringify({ version: 1, apiBaseUrl, webSocketUrl, apiToken }), 'utf8').toString('base64url');
  return `bpdv1_${profile}`;
}

export async function createBridgeCredential({ label, createdBy, tenantKey = 'default', publicApiUrl }) {
  const cleanLabel = String(label || '').trim();
  if (!cleanLabel) throw Object.assign(new Error('Informe um nome para o computador do caixa.'), { status: 400 });
  const tokenId = randomBytes(9).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  const rawToken = `bpdv_${tokenId}.${secret}`;
  const setupCode = createBridgeSetupCode(rawToken, publicApiUrl);
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const credential = await BridgeCredential.create({ tokenId, tokenHash: hash(rawToken), label: cleanLabel, tenantKey, createdBy, expiresAt });
  return { id: credential.id, label: credential.label, token: setupCode, expiresAt, warning: 'Copie agora. O código de conexão não será exibido novamente.' };
}

export async function authenticateBridgeToken(rawToken) {
  if (typeof rawToken !== 'string' || !rawToken.startsWith('bpdv_') || rawToken.length > 160) return null;
  const tokenId = rawToken.slice(5).split('.', 1)[0];
  if (!tokenId) return null;
  const credential = await BridgeCredential.findOne({ tokenId, revokedAt: null, expiresAt: { $gt: new Date() } }).select('+tokenHash');
  if (!credential) return null;
  const actual = Buffer.from(hash(rawToken), 'hex');
  const expected = Buffer.from(credential.tokenHash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  BridgeCredential.updateOne({ _id: credential._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  return credential;
}

export async function listBridgeCredentials() {
  return BridgeCredential.find().select('-tokenHash').sort({ createdAt: -1 }).lean();
}

export async function revokeBridgeCredential(id) {
  const credential = await BridgeCredential.findByIdAndUpdate(id, { revokedAt: new Date() }, { new: true });
  if (!credential) throw Object.assign(new Error('Credencial do Bansir PDV não encontrada.'), { status: 404 });
  return credential;
}
