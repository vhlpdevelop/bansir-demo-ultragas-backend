import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const USER_ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  GERENTE_ARTESAO: 'gerente_artesao',
  OPERADOR: 'operador'
};

export const ROLE_HIERARCHY = {
  [USER_ROLES.SUPERADMIN]: 4,
  [USER_ROLES.ADMIN]: 3,
  [USER_ROLES.GERENTE_ARTESAO]: 2,
  [USER_ROLES.OPERADOR]: 1
};

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Nome é obrigatório'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'E-mail é obrigatório'],
      unique: true,
      lowercase: true,
      trim: true
    },
    password: {
      type: String,
      required: [true, 'Senha é obrigatória'],
      minlength: 6,
      select: false
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.OPERADOR
    },
    phone: {
      type: String,
      default: ''
    },
    artisanSpecialty: {
      type: String,
      default: 'Geral', // Cerâmica, Marcenaria, Tecelagem, Joalheria Artesanal, Macramê, Escultura
    },
    commissionRate: {
      type: Number,
      default: 15, // Porcentagem de comissão do artesão
      min: 0,
      max: 100
    },
    avatar: {
      type: String,
      default: ''
    },
    allowedRoutes: {
      type: [String],
      default: ['sales']
    },
    notificationPreferences: {
      sales: { type: Boolean, default: false },
      system: { type: Boolean, default: false },
      stock: { type: Boolean, default: true },
      financial: { type: Boolean, default: false }
    },
    devices: [
      {
        deviceId: { type: String, required: true },
        deviceName: { type: String, default: 'Dispositivo Navegador' },
        deviceType: { type: String, enum: ['desktop', 'mobile', 'tablet'], default: 'desktop' },
        browser: { type: String, default: 'Navegador' },
        os: { type: String, default: 'Sistema Operacional' },
        pushEnabled: { type: Boolean, default: false },
        subscription: { type: Object, default: null },
        lastActive: { type: Date, default: Date.now },
        registeredAt: { type: Date, default: Date.now }
      }
    ],
    active: {
      type: Boolean,
      default: true
    },
    lastLogin: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export const User = mongoose.model('UltragazUser', userSchema);
