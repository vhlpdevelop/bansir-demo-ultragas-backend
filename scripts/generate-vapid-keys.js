import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import webpush from 'web-push';
import dotenv from 'dotenv';

const envPath = new URL('../.env', import.meta.url);
const existing = existsSync(envPath) ? dotenv.parse(readFileSync(envPath)) : {};
if (existing.VAPID_PUBLIC_KEY || existing.VAPID_PRIVATE_KEY) {
  if (!existing.VAPID_PUBLIC_KEY || !existing.VAPID_PRIVATE_KEY) {
    throw new Error('Par VAPID incompleto em .env; corrija-o antes de gerar novas chaves.');
  }
  console.log('Chaves VAPID existentes preservadas em .env.');
} else {
  const keys = webpush.generateVAPIDKeys();
  appendFileSync(envPath, `\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n${existing.VAPID_SUBJECT ? '' : 'VAPID_SUBJECT=mailto:admin@bansir.com\n'}`);
  console.log('Chaves VAPID geradas e salvas em .env (ignorado pelo Git).');
}
