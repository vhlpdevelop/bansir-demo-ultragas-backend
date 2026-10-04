import mongoose from 'mongoose';

const terminalPaymentSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, index: true, trim: true },
    paymentId: { type: String, required: true, unique: true, trim: true },
    idempotencyKey: { type: String, required: true, unique: true, trim: true },
    amountCents: { type: Number, required: true, min: 1 },
    method: {
      type: String,
      required: true,
      enum: ['pix', 'cartao_debito', 'cartao_credito', 'dinheiro', 'vale', 'outro']
    },
    installments: { type: Number, min: 1, max: 24, default: 1 },
    provider: { type: String, default: '' },
    providerTransactionId: { type: String, default: '' },
    authorizationCode: { type: String, default: '' },
    nsu: { type: String, default: '' },
    terminalId: { type: String, required: true },
    operatorId: { type: String, required: true },
    operatorName: { type: String, required: true },
    approvedAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

const terminalAdjustmentSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, index: true, trim: true },
    adjustmentId: { type: String, required: true, unique: true, trim: true },
    idempotencyKey: { type: String, required: true, unique: true, trim: true },
    amountCents: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    terminalId: { type: String, required: true },
    operatorId: { type: String, required: true },
    operatorName: { type: String, required: true },
    approvedAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

export const TerminalPayment = mongoose.model('UltragasTerminalPayment', terminalPaymentSchema);
export const TerminalAdjustment = mongoose.model('UltragasTerminalAdjustment', terminalAdjustmentSchema);
