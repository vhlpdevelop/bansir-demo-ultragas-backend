import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  cpf: {
    type: String,
    default: '',
    trim: true
  },
  address: {
    type: String,
    default: '',
    trim: true
  },
  ordersCompleted: {
    type: Number,
    default: 0
  },
  issuedVouchersCount: {
    type: Number,
    default: 0
  },
  debtBalance: {
    type: Number,
    default: 0
  }
}, { timestamps: true, collection: 'ultragas_customers' });

export const Customer = mongoose.model('UltragasCustomer', customerSchema);
