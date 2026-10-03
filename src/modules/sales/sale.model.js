import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema(
  {
    saleNumber: {
      type: String,
      required: true,
      unique: true
    },
    orderNumber: {
      type: String,
      default: ''
    },
    barcode: {
      type: String,
      default: ''
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null
    },
    productName: {
      type: String,
      required: [true, 'Nome do produto é obrigatório']
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantidade não pode ser menor que 1'],
      default: 1
    },
    discountType: {
      type: String,
      enum: ['fixed', 'percentage'],
      default: 'fixed'
    },
    discountValue: {
      type: Number,
      default: 0,
      min: 0
    },
    discountAmount: {
      type: Number,
      default: 0
    },
    subtotal: {
      type: Number,
      required: true
    },
    totalAmount: {
      type: Number,
      required: true
    },
    sellerId: {
      type: String,
      default: ''
    },
    sellerName: {
      type: String,
      default: 'Balcão Principal'
    },
    customerName: {
      type: String,
      default: ''
    },
    customerCpf: {
      type: String,
      default: ''
    },
    deliveryMode: {
      type: String,
      enum: ['local', 'delivery'],
      default: 'local'
    },
    deliveryAddress: {
      type: String,
      default: ''
    },
    deliveryFee: {
      type: Number,
      default: 0
    },
    deliveryTime: {
      type: String,
      default: ''
    },
    deliveryEmployeeId: {
      type: String,
      default: ''
    },
    deliveryEmployeeName: {
      type: String,
      default: ''
    },
    deliveryEmployeePhone: {
      type: String,
      default: ''
    },
    deliveryRouteSent: {
      type: Boolean,
      default: false
    },
    paymentMethod: {
      type: String,
      enum: ['pix', 'cartao_credito', 'cartao_debito', 'dinheiro', 'vale', 'outro', 'pagar_na_entrega', 'pix_entrega', 'maquininha_cartao'],
      default: 'pix'
    },
    isPaid: {
      type: Boolean,
      default: true
    },
    paymentStatus: {
      type: String,
      enum: ['pago', 'pagar_na_entrega', 'pendente'],
      default: 'pago'
    },
    installments: { type: Number, default: 1 },
    paymentFeeRate: { type: Number, default: 0 },
    firstReceiptDate: { type: Date },
    receivedAmount: { type: Number, default: 0 },
    changeAmount: { type: Number, default: 0 },
    financialStatus: { type: String, enum: ['pending', 'posted', 'failed'], default: 'pending' },
    status: {
      type: String,
      enum: ['completed', 'cancelled', 'returned'],
      default: 'completed'
    },
    cancellationReason: {
      type: String,
      default: ''
    },
    cancellationDate: {
      type: Date
    },
    refundAmount: {
      type: Number,
      default: 0
    },
    returnOriginalSaleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      default: null
    },
    invoiceIssued: {
      type: Boolean,
      default: false
    },
    invoiceNumber: {
      type: String,
      default: ''
    },
    date: {
      type: Date,
      default: Date.now
    },
    voucherCode: {
      type: String,
      default: ''
    },
    isGasDoPovo: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

export const Sale = mongoose.model('UltragasSale', saleSchema);
