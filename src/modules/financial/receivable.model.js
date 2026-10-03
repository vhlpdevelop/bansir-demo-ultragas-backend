import mongoose from 'mongoose';

const receivableSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: [true, 'Descrição é obrigatória'],
      trim: true
    },
    amount: {
      type: Number,
      required: [true, 'Valor é obrigatório'],
      min: 0
    },
    dueDate: {
      type: Date,
      required: [true, 'Data de vencimento é obrigatória']
    },
    customerName: {
      type: String
    },
    status: {
      type: String,
      enum: ['PENDENTE', 'RECEBIDO', 'CANCELADO'],
      default: 'PENDENTE'
    },
    receiptDate: {
      type: Date
    },
    notes: {
      type: String
    }
  },
  { timestamps: true, collection: 'ultragas_receivables' }
);

export const Receivable = mongoose.model('UltragasReceivable', receivableSchema);
