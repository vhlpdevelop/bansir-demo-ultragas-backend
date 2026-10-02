import { whatsappService } from '../../services/whatsapp.service.js';

export function getStatus(req, res) {
  const status = whatsappService.getStatus();
  return res.json({ success: true, data: status });
}

export async function logout(req, res) {
  await whatsappService.logout();
  return res.json({ success: true, message: 'Desconectado com sucesso' });
}

export function start(req, res) {
  try {
    whatsappService.client.initialize();
  } catch (e) {
    console.error('Error starting whatsapp', e);
  }
  return res.json({ success: true, message: 'WhatsApp Client inicializado' });
}
