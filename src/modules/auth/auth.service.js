import jwt from 'jsonwebtoken';
import { User, USER_ROLES } from '../users/user.model.js';
import { config } from '../../config/env.js';
import { requireDatabase } from '../../config/db.js';
export function generateToken(user) {
  return jwt.sign(
    { id: String(user._id), email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}
export async function loginUser(email, password) {
  requireDatabase();
  if (typeof email !== 'string' || typeof password !== 'string') throw new Error('E-mail e senha obrigatórios.');
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+password');
  if (!user || !user.active || !await user.matchPassword(password)) throw new Error('E-mail ou senha incorretos.');
  user.lastLogin = new Date(); await user.save();
  const data = user.toObject(); delete data.password;
  return { user: data, token: generateToken(user) };
}
export async function registerUser({ name, email, password, artisanSpecialty, phone }) {
  requireDatabase();
  const user = await User.create({ name, email, password, role: USER_ROLES.OPERADOR, artisanSpecialty, phone });
  const data = user.toObject(); delete data.password;
  return { user: data, token: generateToken(user) };
}
export async function getProfile(id) {
  requireDatabase();
  const user = await User.findById(id);
  if (!user || !user.active) throw new Error('Usuário não encontrado ou inativo.');
  return user;
}
