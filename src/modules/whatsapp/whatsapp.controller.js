import { whatsappService } from '../../services/whatsapp.service.js';

export function getStatus(req, res) {
  const status = whatsappService.getStatus();
  return res.json({ success: true, data: status });
}

export async function logout(req, res) {
  await whatsappService.logout();
  return res.json({ success: true, message: 'Desconectado com sucesso' });
}

export function start(req,res){return res.status(410).json({success:false,code:'META_SETUP_REQUIRED',message:'Pareamento Baileys removido. Configure a Meta API no ambiente PostgreSQL.'});}
