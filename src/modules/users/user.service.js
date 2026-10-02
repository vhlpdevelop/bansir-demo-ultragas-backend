import { User, USER_ROLES, ROLE_HIERARCHY } from './user.model.js';
import { requireDatabase } from '../../config/db.js';
export async function getAllUsers() { requireDatabase(); return User.find().sort({ createdAt: -1 }); }
export async function getUserById(id) {
  requireDatabase(); const user = await User.findById(id);
  if (!user) throw new Error('Usuário não encontrado.'); return user;
}
export async function updateUserRole(id, role, operatorUser) {
  if (!Object.values(USER_ROLES).includes(role)) throw new Error('Cargo inválido.');
  if ((ROLE_HIERARCHY[role] || 0) > (ROLE_HIERARCHY[operatorUser.role] || 0)) throw new Error('Privilégio insuficiente.');
  const user = await getUserById(id); user.role = role; await user.save(); return user;
}
export async function updateUserStatus(id, active) {
  if (typeof active !== 'boolean') throw new Error('Status inválido.');
  const user = await getUserById(id); user.active = active; await user.save(); return user;
}
export async function updateUserPermissions(id, data) {
  const user = await getUserById(id);
  for (const key of ['name','email','role','allowedRoutes','notificationPreferences','artisanSpecialty','commissionRate','phone','pixKey','password','employeeId']) {
    if (data[key] !== undefined && data[key] !== '') user[key] = data[key];
  }
  await user.save(); return user;
}
export async function deleteUser(id) { requireDatabase(); const user = await User.findByIdAndDelete(id); if (!user) throw new Error('Usuário não encontrado.'); return true; }
export async function createArtisanUser(data) {
  requireDatabase();
  if (!data.password) throw new Error('Senha inicial obrigatória.');
  const role = data.role || USER_ROLES.OPERADOR;
  const routes = role === USER_ROLES.OPERADOR ? ['sales'] : ['dashboard','sales','products','suppliers','financial','employees','reports'];
  const user = await User.create({ name: data.name, email: data.email, password: data.password, role,
    artisanSpecialty: data.artisanSpecialty, commissionRate: data.commissionRate ?? 0, phone: data.phone, pixKey: data.pixKey, employeeId: data.employeeId,
    allowedRoutes: data.allowedRoutes || routes, notificationPreferences: data.notificationPreferences,
    active: true });
  const result = user.toObject(); delete result.password; return result;
}
