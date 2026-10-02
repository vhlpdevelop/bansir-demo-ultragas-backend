import mongoose from 'mongoose';

const voucherItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productName: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 }
});

const voucherSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  items: [voucherItemSchema],
  totalAmount: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['ACTIVE', 'REDEEMED', 'CANCELLED'], default: 'ACTIVE' },
  issuedAt: { type: Date, default: Date.now },
  redeemedAt: { type: Date },
  redeemedBy: { type: String, default: '' },
  redeemedByName: { type: String, default: '' }
}, {
  timestamps: true
});

// Generate unique code before saving if not provided
voucherSchema.pre('validate', function(next) {
  if (!this.code) {
    const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
    const ts = Date.now().toString().slice(-4);
    this.code = `VGL-${ts}${randomStr}`;
  }
  next();
});

export const Voucher = mongoose.model('Voucher', voucherSchema);
