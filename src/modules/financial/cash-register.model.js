import mongoose from 'mongoose';

const cashRegisterSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      default: Date.now,
      required: true
    },
    // Calculated by the system
    systemSalesAmount: { type: Number, default: 0 },
    systemReceivedNotes: { type: Number, default: 0 }, // Notas recebidas
    systemPreviousChange: { type: Number, default: 0 }, // Troco dia anterior
    
    // Informed by the user
    informedLargeBills: { type: Number, default: 0 }, // Dinheiro grande
    informedChange: { type: Number, default: 0 }, // Troco
    informedVouchers: { type: Number, default: 0 }, // Vale
    informedGasCount: { type: Number, default: 0 }, // Contagem do gás
    
    // Status
    difference: { type: Number, default: 0 }, // Diferença entre sistema e informado
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    closedByName: { type: String, required: true },
    status: {
      type: String,
      enum: ['balanced', 'surplus', 'shortage'],
      required: true
    }
  },
  { timestamps: true }
);

export const CashRegister = mongoose.model('UltragazCashRegister', cashRegisterSchema);
