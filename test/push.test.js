import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import webpush from 'web-push';
const testKeys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = testKeys.publicKey;
process.env.VAPID_PRIVATE_KEY = testKeys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@example.com';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/push_test';
const { pushConfigured } = await import('../src/config/webpush.js');
const { Notification } = await import('../src/modules/notifications/notification.model.js');
const { User } = await import('../src/modules/users/user.model.js');
const { connectDB } = await import('../src/config/db.js');
const { registerOrUpdateDevice, toggleDevicePush, createNotification, sendTestPushToDevices } = await import('../src/modules/notifications/notification.service.js');
const { default: app } = await import('../src/app.js');

function subscription(name) {
  const ecdh = createECDH('prime256v1');
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, expirationTime: null,
    keys: { p256dh: ecdh.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
}

test('MongoDB recipient lookup and persistent expired subscription cleanup', async () => {
  const original = { notificationCreate: Notification.create, connect: mongoose.connect, find: User.find, findById: User.findById, updateOne: User.updateOne, updateMany: User.updateMany, send: webpush.sendNotification };
  const updates = [];
  let saved = 0;
  const user = { _id: '507f1f77bcf86cd799439011', role: 'admin', active: true, devices: [], notificationPreferences: { sales: true }, save: async () => { saved++; } };
  try {
    mongoose.connect = async () => { mongoose.connection.readyState = 1; return { connection: { host: 'test', name: 'test' } }; };
    mongoose.connection.readyState = 1;
    Notification.create = async data => data;
    User.findById = async () => user;
    User.find = async () => [user];
    User.updateMany = async () => ({});
    User.updateOne = async (...args) => { updates.push(args); };
    await registerOrUpdateDevice(user._id, { deviceId: 'db', pushEnabled: true, subscription: subscription('db') });
    assert.equal(saved, 1);
    let calls = 0;
    webpush.sendNotification = async () => { calls++; throw Object.assign(new Error('gone'), { statusCode: 404 }); };
    await createNotification({ type: 'sales', title: 'DB sale' });
    assert.equal(calls, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0][1].$set['devices.$[device].subscription'], null);
    assert.equal(updates[0][2].arrayFilters[0]['device.deviceId'], 'db');
  } finally {
    mongoose.connection.readyState = 0;
    Notification.create = original.notificationCreate;
    mongoose.connect = original.connect;
    User.find = original.find;
    User.findById = original.findById;
    User.updateOne = original.updateOne;
    User.updateMany = original.updateMany;
    webpush.sendNotification = original.send;
  }
});
