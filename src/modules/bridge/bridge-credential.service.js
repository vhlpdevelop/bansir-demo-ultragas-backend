import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { BridgeCredential } from './bridge-credential.model.js';

const hash = value => createHash('sha256').update(value).digest('hex');

export async function createBridgeCredential({ label, createdBy, tenantKey = 'default' }) {
  const cleanLabel = String(label || '').trim();
  if (!cleanLabel) throw Object.assign(new Error('Informe um nome para o computador do caixa.'), { status: 400 });
  const tokenId = randomBytes(9).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  const rawToken = `bpdv_${tokenId}.${secret}`;
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const credential = await BridgeCredential.create({ tokenId, tokenHash: hash(rawToken), label: cleanLabel, tenantKey, createdBy, expiresAt });
  return { id: credential.id, label: credential.label, token: rawToken, expiresAt, warning: 'Copie agora. O token não será exibido novamente.' };
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
