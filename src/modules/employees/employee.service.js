import { Employee } from './employee.model.js';
import { requireDatabase } from '../../config/db.js';
export async function getAllEmployees() { requireDatabase(); return Employee.find().sort({ createdAt: -1 }); }
export async function getEmployeeById(id) { requireDatabase(); const e = await Employee.findById(id); if (!e) throw new Error('Funcionário não encontrado.'); return e; }
export async function createEmployee(data) { requireDatabase(); return Employee.create(data); }
export async function updateEmployee(id, data) { requireDatabase(); const e = await Employee.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true }); if (!e) throw new Error('Funcionário não encontrado.'); return e; }
export async function deleteEmployee(id) { requireDatabase(); const e = await Employee.findByIdAndDelete(id); if (!e) throw new Error('Funcionário não encontrado.'); return true; }
