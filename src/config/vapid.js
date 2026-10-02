import { createECDH } from 'node:crypto';

function clean(value = '') {
  const text = value.trim();
  // Environment dashboards may preserve quotes that dotenv normally strips.
  return ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
    ? text.slice(1, -1).trim() : text;
}
export function configureVapid(webpush, env, warn = console.warn) {
  const publicKey = clean(env.VAPID_PUBLIC_KEY);
  const privateKey = clean(env.VAPID_PRIVATE_KEY);
  const subject = clean(env.VAPID_SUBJECT) || 'mailto:admin@bansir.com';
  try {
    if (!publicKey && !privateKey) return { publicKey: '', configured: false };
    for (const [name, key, size] of [['VAPID_PUBLIC_KEY', publicKey, 65], ['VAPID_PRIVATE_KEY', privateKey, 32]]) {
      if (!/^[A-Za-z0-9_-]+={0,2}$/.test(key) || Buffer.from(key, 'base64url').length !== size) {
        throw new Error(`${name} inválida: use apenas o valor Base64URL completo (${size} bytes decodificados).`);
      }
    }
    const curve = createECDH('prime256v1');
    curve.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (!curve.getPublicKey().equals(Buffer.from(publicKey, 'base64url'))) throw new Error('As chaves VAPID não pertencem ao mesmo par.');
    webpush.setVapidDetails(subject, publicKey, privateKey);
    return { publicKey, configured: true };
  } catch {
    // Never print environment values, including errors from third-party validators.
    warn('[Bansir Push] Configuração VAPID inválida. Confira VAPID_PUBLIC_KEY (65 bytes), VAPID_PRIVATE_KEY (32 bytes), o par e VAPID_SUBJECT. Push desativado; API permanece disponível.');
    return { publicKey: '', configured: false };
  }
}
