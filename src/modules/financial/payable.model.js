import mongoose from 'mongoose';

const payableSchema = new mongoose.Schema(
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
    category: {
      type: String,
      enum: ['CUSTO_FROTA', 'CUSTO_ADMINISTRATIVO', 'DESPESA_COM_PESSOAL', 'FORNECEDORES', 'OUTROS'],
      default: 'OUTROS'
    },
    status: {
      type: String,
      enum: ['PENDENTE', 'PAGO', 'CANCELADO'],
      default: 'PENDENTE'
    },
    paymentDate: {
      type: Date
    },
    notes: {
      type: String
    }
  },
  { timestamps: true, collection: 'ultragas_payables' }
);

export const Payable = mongoose.model('UltragasPayable', payableSchema);
