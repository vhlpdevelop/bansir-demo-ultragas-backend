import { Router } from 'express';
import mongoose from 'mongoose';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';
import { StoreSettings } from './settings.model.js';
import { broadcastTerminalConfiguration, getTerminalStatuses } from '../bridge/bridge.gateway.js';
const router = Router();
router.use(protect);

const providers = new Set(['pagbank', 'caixa', 'itau_rede']);
const connections = new Set(['usb', 'network', 'bluetooth', 'tef', 'cloud']);
function terminalInput(body = {}) {
  const terminal = {
    name: String(body.name || '').trim(), provider: String(body.provider || ''), model: String(body.model || '').trim(),
    connectionType: String(body.connectionType || 'usb'), deviceIdentifier: String(body.deviceIdentifier || '').trim(), enabled: body.enabled !== false
  };
  if (!terminal.name || terminal.name.length > 80) throw Object.assign(new Error('Informe um nome de até 80 caracteres para a maquininha.'), { status: 400 });
  if (!providers.has(terminal.provider)) throw Object.assign(new Error('Operadora de maquininha inválida.'), { status: 400 });
  if (!terminal.model || terminal.model.length > 100) throw Object.assign(new Error('Informe o modelo da maquininha.'), { status: 400 });
  if (!connections.has(terminal.connectionType)) throw Object.assign(new Error('Tipo de conexão inválido.'), { status: 400 });
  if (terminal.deviceIdentifier.length > 160) throw Object.assign(new Error('Identificador do equipamento muito longo.'), { status: 400 });
  return terminal;
}
function hardwareResponse(settings) {
  const runtime = getTerminalStatuses();
  return (settings?.paymentTerminals || []).map(item => {
    const terminal = item.toObject ? item.toObject() : item;
    const current = runtime.get(String(terminal._id));
    return { ...terminal, connected: ['connected', 'ready', 'busy'].includes(current?.status), runtimeStatus: current?.status || 'disconnected', lastSeenAt: current?.lastSeenAt || null };
  });
}

router.get('/hardware', async (req, res, next) => {
  try { const settings = await StoreSettings.findById('store').select('paymentTerminals').lean(); res.json({ success: true, data: { terminals: hardwareResponse(settings) } }); } catch (e) { next(e); }
});

router.use(requireMinHierarchy(3));
router.get('/', async (req, res, next) => {
  try { res.json({ success: true, data: await StoreSettings.findById('store').lean() || {} }); } catch (e) { next(e); }
});
router.post('/hardware/terminals', async (req, res, next) => {
  try {
    const settings = await StoreSettings.findByIdAndUpdate('store', { $push: { paymentTerminals: terminalInput(req.body) } }, { upsert: true, new: true, runValidators: true });
    broadcastTerminalConfiguration(settings.paymentTerminals);
    res.status(201).json({ success: true, data: hardwareResponse(settings) });
  } catch (e) { next(e); }
});
router.put('/hardware/terminals/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw Object.assign(new Error('Maquininha inválida.'), { status: 400 });
    const terminal = terminalInput(req.body);
    const settings = await StoreSettings.findOneAndUpdate({ _id: 'store', 'paymentTerminals._id': req.params.id }, { $set: Object.fromEntries(Object.entries(terminal).map(([key, value]) => [`paymentTerminals.$.${key}`, value])) }, { new: true, runValidators: true });
    if (!settings) throw Object.assign(new Error('Maquininha não encontrada.'), { status: 404 });
    broadcastTerminalConfiguration(settings.paymentTerminals);
    res.json({ success: true, data: hardwareResponse(settings) });
  } catch (e) { next(e); }
});
router.delete('/hardware/terminals/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw Object.assign(new Error('Maquininha inválida.'), { status: 400 });
    const settings = await StoreSettings.findByIdAndUpdate('store', { $pull: { paymentTerminals: { _id: req.params.id } } }, { new: true });
    if (!settings) throw Object.assign(new Error('Configurações da loja não encontradas.'), { status: 404 });
    broadcastTerminalConfiguration(settings.paymentTerminals);
    res.json({ success: true, data: hardwareResponse(settings) });
  } catch (e) { next(e); }
});
router.put('/', async (req, res, next) => {
  try {
    const data = Object.fromEntries(['storeName', 'pixKey', 'documentId', 'address', 'merchantCity', 'contact'].filter(k => typeof req.body[k] === 'string').map(k => [k, req.body[k]]));
    res.json({ success: true, data: await StoreSettings.findByIdAndUpdate('store', { $set: data }, { upsert: true, new: true, runValidators: true }) });
  } catch (e) { next(e); }
});
export default router;
