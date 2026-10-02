import {
  getNotificationsForUser,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  createNotification,
  getUserDevices,
  registerOrUpdateDevice,
  toggleDevicePush,
  removeDevice,
  sendTestPushToDevices
} from './notification.service.js';

export async function list(req, res, next) {
  try {
    const notifications = await getNotificationsForUser(req.user);
    return res.json({
      success: true,
      data: notifications
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

export async function markRead(req, res, next) {
  try {
    const userId = req.user.id || req.user._id;
    await markNotificationAsRead(req.params.id, userId);
    return res.json({
      success: true,
      message: 'Notificação marcada como lida.'
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function markAllRead(req, res, next) {
  try {
    const userId = req.user.id || req.user._id;
    await markAllNotificationsAsRead(userId);
    return res.json({
      success: true,
      message: 'Todas as notificações marcadas como lidas.'
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function create(req, res, next) {
  try {
    const notif = await createNotification(req.body);
    return res.status(201).json({
      success: true,
      data: notif
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

// Multi-Device Management Handlers
export async function listDevices(req, res, next) {
  try {
    const userId = req.user.id || req.user._id;
    const currentDeviceId = req.headers['x-device-id'] || req.query.deviceId || null;
    const devices = await getUserDevices(userId, currentDeviceId);
    return res.json({
      success: true,
      data: devices
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

export async function registerDevice(req, res, next) {
  try {
    const userId = req.user.id || req.user._id;
    const deviceData = req.body;
    const devices = await registerOrUpdateDevice(userId, deviceData);
    return res.json({
      success: true,
      message: `Dispositivo "${deviceData.deviceName || deviceData.deviceId}" registrado com sucesso!`,
      data: devices
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function toggleDevicePushStatus(req, res, next) {
  try {
    const userId = req.user.id || req.user._id;
    const { deviceId } = req.params;
    const { pushEnabled } = req.body;
    await toggleDevicePush(userId, deviceId, pushEnabled);
    return res.json({
      success: true,
      message: pushEnabled ? 'Notificações ativadas neste dispositivo.' : 'Notificações silenciadas neste dispositivo.'
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function removeUserDevice(req, res, next) {
  try {
    const userId = req.user.id || req.user._id;
    const { deviceId } = req.params;
    await removeDevice(userId, deviceId);
    return res.json({
      success: true,
      message: 'Dispositivo desconectado com sucesso.'
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function testPush(req, res, next) {
  try {
    const currentDeviceId = req.headers['x-device-id'] || req.body.deviceId || null;
    const result = await sendTestPushToDevices(req.user, currentDeviceId);
    return res.json({
      success: true,
      message: `Push aceito pelo serviço em ${result.devicesSent} de ${result.devicesTargeted} dispositivo(s). Falhas: ${result.devicesFailed}.`,
      data: result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}
