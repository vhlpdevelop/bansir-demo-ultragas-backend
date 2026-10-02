import mongoose from 'mongoose';
import { requireDatabase } from '../../config/db.js';
const configSchema = new mongoose.Schema({ _id: String, settings: mongoose.Schema.Types.Mixed });
const FiscalConfig = mongoose.model('UltragasFiscalConfig', configSchema);
const Invoice = mongoose.model('UltragasInvoice', new mongoose.Schema({ id: String, chaveAcesso: String, vendaReferencia: mongoose.Schema.Types.Mixed }, { strict: false }));
export async function getFiscalConfig() {
  requireDatabase();
  return (await FiscalConfig.findById('store').lean())?.settings || {};
}
export async function updateFiscalConfig(settings) {
  requireDatabase();
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Configuração inválida.');
  const config = await FiscalConfig.findByIdAndUpdate('store', { $set: { settings } }, { upsert: true, new: true });
  return config.settings;
}
export async function listInvoices() { requireDatabase(); return Invoice.find().sort({ _id: -1 }).lean(); }
export async function getInvoice(id) {
  requireDatabase();
  return Invoice.findOne({ $or: [{ id }, { chaveAcesso: id }, { 'vendaReferencia.saleId': id }] }).lean();
}
export async function emitNFCeForSale() {
  throw new Error('A emissão de vendas reais ainda não está liberada. Para testar Cielo e NFeWizard, use o painel Pagamentos e notas. Nenhuma nota foi emitida.');
}
