import './env.js';
import webpush from 'web-push';
import { configureVapid } from './vapid.js';

const vapid = configureVapid(webpush, process.env);
export const VAPID_PUBLIC_KEY = vapid.publicKey;
export const pushConfigured = vapid.configured;
export { webpush };
