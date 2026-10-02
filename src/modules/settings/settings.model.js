import mongoose from 'mongoose';
export const StoreSettings = mongoose.model('UltragasStoreSettings', new mongoose.Schema({
  _id: String, storeName: String, pixKey: String, documentId: String, address: String,
  merchantCity: String, pixKeyType: String, pixEnabled: { type: Boolean, default: false }
}));
