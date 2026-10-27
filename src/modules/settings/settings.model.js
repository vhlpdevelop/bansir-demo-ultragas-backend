import mongoose from 'mongoose';

const paymentTerminalSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  provider: { type: String, required: true, enum: ['pagbank', 'caixa', 'itau_rede', 'sicredi', 'mercado_pago', 'other'] },
  model: { type: String, required: true, trim: true, maxlength: 100 },
  connectionType: { type: String, required: true, enum: ['usb', 'network', 'bluetooth', 'tef', 'cloud'], default: 'usb' },
  deviceIdentifier: { type: String, trim: true, maxlength: 160, default: '' },
  serialNumber: { type: String, trim: true, maxlength: 100, default: '' },
  partNumber: { type: String, trim: true, maxlength: 100, default: '' },
  enabled: { type: Boolean, default: true }
}, { timestamps: true });

export const StoreSettings = mongoose.model('UltragasStoreSettings', new mongoose.Schema({
  _id: String, storeName: String, pixKey: String, documentId: String, address: String, contact: { type: String, maxlength: 100 },
  merchantCity: String, pixKeyType: String, pixEnabled: { type: Boolean, default: false },
  monthlySalesTarget: { type: Number, default: 15000 },
  paymentTerminals: { type: [paymentTerminalSchema], default: [] }
}));
