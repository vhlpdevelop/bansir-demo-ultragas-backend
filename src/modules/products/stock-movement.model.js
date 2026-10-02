import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: String, type: { type: String, enum: ['in', 'out'], required: true },
  quantity: { type: Number, min: 1, required: true }, unitPrice: { type: Number, default: 0 },
  reason: String, notes: String, userName: String, date: { type: Date, default: Date.now }
}, { timestamps: true });
export const StockMovement = mongoose.model('UltragazStockMovement', schema);
