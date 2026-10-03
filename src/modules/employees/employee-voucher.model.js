import mongoose from 'mongoose';

const employeeVoucherSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UltragasEmployee',
      required: [true, 'Funcionário é obrigatório']
    },
    amount: {
      type: Number,
      required: [true, 'Valor é obrigatório'],
      min: 0.01
    },
    date: {
      type: Date,
      default: Date.now
    },
    justification: {
      type: String,
      required: [true, 'Justificativa é obrigatória']
    },
    status: {
      type: String,
      enum: ['EMITIDO', 'DESCONTADO', 'CANCELADO'],
      default: 'EMITIDO'
    },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UltragasUser'
    },
    issuedByName: {
      type: String,
      default: ''
    },
    notes: {
      type: String
    }
  },
  { timestamps: true, collection: 'ultragas_employee_vouchers' }
);

export const EmployeeVoucher = mongoose.model('UltragasEmployeeVoucher', employeeVoucherSchema);
