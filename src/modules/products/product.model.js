import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Nome da categoria é obrigatório'],
      unique: true,
      trim: true
    },
    description: {
      type: String,
      default: ''
    },
    color: {
      type: String,
      default: '#c85a32'
    }
  },
  {
    timestamps: true
  }
);

export const Category = mongoose.model('UltragasCategory', categorySchema);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Nome do produto é obrigatório'],
      trim: true,
      index: true
    },
    barcode: {
      type: String,
      required: [true, 'Código de barras é obrigatório'],
      unique: true,
      trim: true,
      index: true
    },
    category: {
      type: String,
      default: 'Gás de Cozinha'
    },
    price: {
      type: Number,
      required: [true, 'Preço de venda é obrigatório'],
      min: 0.01
    },
    costPrice: {
      type: Number,
      min: 0,
      default: 0
    },
    stock: {
      type: Number,
      required: true,
      default: 1,
      min: 0
    },
    sku: {
      type: String,
      default: ''
    },
    unit: {
      type: String,
      default: 'UN'
    },
    brand: {
      type: String,
      default: 'Ultragas'
    },
    specs: {
      type: String,
      default: ''
    },
    ncm: {
      type: String,
      default: ''
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      default: null
    },
    active: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

// Text index for fast and fuzzy-like partial search
productSchema.index({ name: 'text', category: 'text' });

export const Product = mongoose.model('UltragasProduct', productSchema);

