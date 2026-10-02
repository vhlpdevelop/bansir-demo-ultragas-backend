import mongoose from 'mongoose';

export const COMMISSION_TYPES = {
  PERCENTAGE: 'percentage', // Porcentagem sobre o total da venda (ex: 5%)
  FIXED: 'fixed'            // Valor fixo em R$ por venda realizada (ex: R$ 15,00)
};

export const LABOR_TYPES = {
  MOD: 'MOD', // Mão de Obra Direta (Produtivo - Gera Receita / Produção & Vendas)
  MOI: 'MOI'  // Mão de Obra Indireta (Não Produtivo - Apoio / Administrativo)
};

const employeeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Nome do funcionário é obrigatório'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'E-mail do funcionário é obrigatório'],
      lowercase: true,
      trim: true
    },
    phone: {
      type: String,
      default: ''
    },
    pixKey: {
      type: String,
      default: ''
    },
    roleTitle: {
      type: String,
      required: [true, 'Cargo é obrigatório'],
      default: 'Vendedor(a) de Balcão'
    },
    laborType: {
      type: String,
      enum: Object.values(LABOR_TYPES),
      default: LABOR_TYPES.MOD
    },
    baseSalary: {
      type: Number,
      required: [true, 'Salário base é obrigatório'],
      min: 0,
      default: 2000.00
    },
    commissionType: {
      type: String,
      enum: Object.values(COMMISSION_TYPES),
      default: COMMISSION_TYPES.PERCENTAGE
    },
    commissionValue: {
      type: Number,
      required: [true, 'Valor ou porcentagem de comissão é obrigatório'],
      min: 0,
      default: 5.0
    },
    active: {
      type: Boolean,
      default: true
    },
    totalSalesCount: {
      type: Number,
      default: 0
    },
    totalSalesAmount: {
      type: Number,
      default: 0
    },
    totalCommissionsEarned: {
      type: Number,
      default: 0
    },
    gamificationPoints: {
      type: Number,
      default: 0
    },
    gamificationLevel: {
      type: String,
      default: 'Novato do Gás Bronze 🎯'
    },
    badges: {
      type: [String],
      default: []
    },
    hiredAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

export function calculateGasLevel(points = 0, salesCount = 0, roleTitle = '') {
  const isDelivery = /entregador|motorista/i.test(roleTitle || '');

  if (points >= 600 || salesCount >= 50) {
    return isDelivery ? 'Campeão das Rotas Diamante 💎' : 'Mestre do Gás Diamante 💎';
  }
  if (points >= 300 || salesCount >= 25) {
    return isDelivery ? 'Mestre das Entregas Ouro 🥇' : 'Especialista Ultragas Ouro 🏆';
  }
  if (points >= 100 || salesCount >= 10) {
    return isDelivery ? 'Entregador Ágil Prata 🥈' : 'Vendedor Destaque Prata 🥈';
  }
  return isDelivery ? 'Entregador Bronze 🛵' : 'Novato do Gás Bronze 🎯';
}

export const Employee = mongoose.model('UltragasEmployee', employeeSchema);
