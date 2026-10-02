import { Notification } from './notification.model.js';
import { User } from '../users/user.model.js';
import { randomUUID } from 'node:crypto';
import { requireDatabase } from '../../config/db.js';
import { webpush, pushConfigured } from '../../config/webpush.js';

export function canReceive(user, type) {
  if (!user || user.active === false) return false;
  const preferences = user.notificationPreferences || {};
  if (preferences[type] === false) return false;
  if (type === 'stock') return true;
  return ['admin', 'superadmin', 'gerente_artesao'].includes(user.role) || preferences[type] === true;
}
export async function getNotificationsForUser(user) {
  requireDatabase();
  const types = ['sales', 'system', 'stock', 'financial'].filter(type => canReceive(user, type));
  const notifications = await Notification.find({ type: { $in: types } }).sort({ timestamp: -1 }).limit(200).lean();
  return notifications.map(({ readBy, ...notification }) => ({ ...notification, read: readBy.includes(String(user._id || user.id)) }));
}
export async function markNotificationAsRead(id, userId) {
  requireDatabase();
  await Notification.updateOne({ id }, { $addToSet: { readBy: String(userId) } });
  return true;
}
export async function markAllNotificationsAsRead(userId) {
  const user = await findDeviceUser(userId);
  const types = ['sales', 'system', 'stock', 'financial'].filter(type => canReceive(user, type));
  await Notification.updateMany({ type: { $in: types } }, { $addToSet: { readBy: String(userId) } });
  return true;
}
async function findDeviceUser(userId) {
  requireDatabase();
  const user = await User.findById(userId);
  if (!user) throw new Error('Usuário não encontrado.');
  return user;
}

function validSubscription(subscription) {
  if (!subscription || typeof subscription.endpoint !== 'string') return false;
  try {
    const url = new URL(subscription.endpoint);
    return url.protocol === 'https:' && !url.username && !url.password &&
      typeof subscription.keys?.p256dh === 'string' &&
      /^[A-Za-z0-9_-]+={0,2}$/.test(subscription.keys.p256dh) &&
      Buffer.from(subscription.keys.p256dh, 'base64url').length === 65 &&
      typeof subscription.keys?.auth === 'string' &&
      /^[A-Za-z0-9_-]+={0,2}$/.test(subscription.keys.auth) &&
      Buffer.from(subscription.keys.auth, 'base64url').length === 16;
  } catch { return false; }
}

function publicDevices(user, currentDeviceId) {
  return (user.devices || []).map(device => {
    const { subscription, ...data } = device.toObject ? device.toObject() : device;
    return { ...data, hasSubscription: validSubscription(subscription),
      isCurrentDevice: device.deviceId === currentDeviceId };
  });
}

async function saveDevices(user) {
  await user.save();
}

export async function getUserDevices(userId, currentDeviceId = null) {
  return publicDevices(await findDeviceUser(userId), currentDeviceId);
}

export async function registerOrUpdateDevice(userId, deviceData) {
  const { deviceId, deviceName, deviceType, browser, os, subscription, pushEnabled } = deviceData;
  if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 200) {
    throw new Error('Identificador do dispositivo inválido.');
  }
  if (pushEnabled !== undefined && typeof pushEnabled !== 'boolean') throw new Error('pushEnabled deve ser booleano.');
  if (subscription !== undefined && subscription !== null && !validSubscription(subscription)) {
    throw new Error('Assinatura push inválida.');
  }
  const user = await findDeviceUser(userId);
  user.devices ||= [];
  let device = user.devices.find(d => d.deviceId === deviceId);
  const effectiveSubscription = subscription === undefined ? device?.subscription : subscription;
  if (pushEnabled === true && !validSubscription(effectiveSubscription)) {
    throw new Error('Ative as notificações no navegador deste aparelho primeiro.');
  }
  // A browser endpoint belongs to one account, including on shared computers.
  if (subscription) {
    if (typeof user.save === 'function') {
      await User.updateMany({ _id: { $ne: user._id }, 'devices.subscription.endpoint': subscription.endpoint },
        { $pull: { devices: { 'subscription.endpoint': subscription.endpoint } } });
    }
    user.devices = user.devices.filter(d => d.deviceId === deviceId || d.subscription?.endpoint !== subscription.endpoint);
    device = user.devices.find(d => d.deviceId === deviceId);
  }
  if (!device) {
    user.devices.push({ deviceId, pushEnabled: false, registeredAt: new Date() });
    device = user.devices[user.devices.length - 1];
  }
  for (const [key, value] of Object.entries({ deviceName, deviceType, browser, os })) {
    if (value !== undefined) device[key] = value;
  }
  if (subscription !== undefined) device.subscription = subscription;
  if (pushEnabled !== undefined) device.pushEnabled = pushEnabled;
  if (!validSubscription(device.subscription)) device.pushEnabled = false;
  device.lastActive = new Date();
  await saveDevices(user);
  return publicDevices(user, deviceId);
}

export async function toggleDevicePush(userId, deviceId, pushEnabled) {
  if (typeof pushEnabled !== 'boolean') throw new Error('pushEnabled deve ser booleano.');
  const user = await findDeviceUser(userId);
  const device = user.devices?.find(d => d.deviceId === deviceId);
  if (!device) throw new Error('Dispositivo não encontrado.');
  if (pushEnabled && !validSubscription(device.subscription)) {
    throw new Error('Ative as notificações no navegador deste aparelho primeiro.');
  }
  device.pushEnabled = pushEnabled;
  await saveDevices(user);
  return true;
}

export async function removeDevice(userId, deviceId) {
  const user = await findDeviceUser(userId);
  user.devices = (user.devices || []).filter(d => d.deviceId !== deviceId);
  await saveDevices(user);
  return true;
}

async function sendPushToDevice(user, device, payload) {
  try {
    if (!pushConfigured) throw new Error('Push não configurado no servidor.');
    await webpush.sendNotification(device.subscription, JSON.stringify(payload), { timeout: 10000, TTL: 3600 });
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      // Match the endpoint as well, so a renewed subscription is never removed.
      if (typeof user.save === 'function') {
        await User.updateOne({ _id: user._id },
          { $set: { 'devices.$[device].subscription': null, 'devices.$[device].pushEnabled': false } },
          { arrayFilters: [{ 'device.deviceId': device.deviceId, 'device.subscription.endpoint': device.subscription.endpoint }] });
      } else {
        device.subscription = null;
        device.pushEnabled = false;
      }
    } else {
      console.warn(`[Bansir Push] Falha no dispositivo ${device.deviceId}: ${err.statusCode || 'indisponível'}`);
    }
    return false;
  }
}

async function deliverToUsers(users, notification) {
  const payload = { title: notification.title || 'Bansir Notificação', body: notification.desc || '',
    data: { type: notification.type, notifId: notification.id, url: '/', timestamp: notification.timestamp } };
  const targets = users.flatMap(user => (user.devices || [])
    .filter(d => d.pushEnabled && validSubscription(d.subscription))
    .map(device => ({ user, device })));
  const results = await Promise.allSettled(targets.map(({ user, device }) => sendPushToDevice(user, device, payload)));
  const deviceList = targets.map(({ device }, i) => ({
    deviceId: device.deviceId, deviceName: device.deviceName, deviceType: device.deviceType,
    status: results[i].status === 'fulfilled' && results[i].value ? 'accepted' : 'failed'
  }));
  const devicesSent = deviceList.filter(d => d.status === 'accepted').length;
  return { devicesTargeted: targets.length, devicesSent, devicesFailed: targets.length - devicesSent, deviceList };
}

export async function sendTestPushToDevices(user) {
  const recipient = await findDeviceUser(user.id || user._id);
  const notification = { id: `test_${randomUUID()}`, type: 'system', title: 'Teste de notificação Bansir',
    desc: 'Este aparelho está recebendo notificações push da sua conta.', timestamp: new Date().toISOString() };
  return { notification, ...await deliverToUsers([recipient], notification) };
}

export async function createNotification({ type = 'system', title, desc }) {
  const notification = { id: `notif_${randomUUID()}`, type, title, desc, time: 'Agora',
    timestamp: new Date().toISOString(), readBy: [] };
  requireDatabase();
  await Notification.create(notification);
  try {
    const users = await User.find({ active: true, 'devices.pushEnabled': true });
    const recipients = users.filter(user => canReceive(user, notification.type));
    await deliverToUsers(recipients, notification);
  } catch (err) {
    console.warn('[Bansir Push] Não foi possível distribuir a notificação:', err.message);
  }
  return notification;
}
