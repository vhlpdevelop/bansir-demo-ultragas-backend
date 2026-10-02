import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Razão Social ou Nome do Fornecedor é obrigatório'],
      trim: true,
      index: true
    },
    tradeName: {
      type: String,
      trim: true,
      default: ''
    },
    document: {
      type: String,
      required: [true, 'CNPJ ou CPF do Fornecedor é obrigatório'],
      unique: true,
      trim: true,
      index: true
    },
    stateRegistration: {
      type: String,
      trim: true,
      default: '' // Inscrição Estadual (IE)
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: ''
    },
    phone: {
      type: String,
      trim: true,
      default: ''
    },
    contactPerson: {
      type: String,
      trim: true,
      default: ''
    },
    category: {
      type: String,
      enum: [
        'Materia-Prima',
        'Argila & Ceramica',
        'Madeira & Fibras',
        'Embalagens',
        'Ferramentas',
        'Tintas & Pigmentos',
        'Revenda',
        'Outros'
      ],
      default: 'Materia-Prima'
    },
    address: {
      street: { type: String, default: '' },
      number: { type: String, default: '' },
      complement: { type: String, default: '' },
      neighborhood: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      zipCode: { type: String, default: '' }
    },
    bankDetails: {
      bank: { type: String, default: '' },
      agency: { type: String, default: '' },
      account: { type: String, default: '' },
      pixKey: { type: String, default: '' },
      pixType: { type: String, default: 'cnpj' } // cnpj, email, telefone, aleatoria
    },
    notes: {
      type: String,
      default: ''
    },
    active: {
      type: Boolean,
      default: true,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Text index for search
supplierSchema.index({ name: 'text', tradeName: 'text', document: 'text' });

export const Supplier = mongoose.model('UltragasSupplier', supplierSchema);
