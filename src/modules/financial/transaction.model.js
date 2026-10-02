import mongoose from 'mongoose';

export const TRANSACTION_TYPES = {
  INCOME: 'income',
  EXPENSE: 'expense'
};

export const TRANSACTION_CATEGORIES = {
  VENDA_VAREJO: 'venda_artesanato',
  ESTOQUE_PRODUTOS: 'estoque_produtos',
  EMBALAGEM: 'embalagem',
  SALARIO_COMISSAO: 'salario_comissao',
  CUSTO_LOJA: 'custo_loja',
  FRETE_LOGISTICA: 'frete_logistica',
  OUTROS: 'outros'
};

const transactionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Título da transação é obrigatório'],
      trim: true
    },
    type: {
      type: String,
      enum: Object.values(TRANSACTION_TYPES),
      required: true,
      default: TRANSACTION_TYPES.INCOME
    },
    category: {
      type: String,
      enum: Object.values(TRANSACTION_CATEGORIES),
      default: TRANSACTION_CATEGORIES.VENDA_VAREJO
    },
    amount: {
      type: Number,
      required: [true, 'Valor é obrigatório'],
      min: [0.01, 'Valor deve ser positivo']
    },
    sellerName: {
      type: String,
      default: 'Loja Varejo Bansir'
    },
    status: {
      type: String,
      enum: ['completed', 'pending', 'cancelled'],
      default: 'completed'
    },
    paymentMethod: {
      type: String,
      enum: ['pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'transferencia', 'boleto', 'vale', 'outro', 'pagar_na_entrega', 'pix_entrega', 'maquininha_cartao'],
      default: 'pix'
    },
    date: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      default: ''
    },
    settledAt: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    saleId: { type: String },
    installment: { type: Number },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  {
    timestamps: true
  }
);

transactionSchema.index({ saleId: 1, installment: 1 }, { unique: true, partialFilterExpression: { saleId: { $type: 'string' }, installment: { $type: 'number' } } });

export const Transaction = mongoose.model('UltragasTransaction', transactionSchema);
