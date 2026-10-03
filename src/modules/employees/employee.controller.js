import { getAllEmployees, getEmployeeById, createEmployee, updateEmployee, deleteEmployee } from './employee.service.js';
import { calculateGasLevel } from './employee.model.js';

export async function list(req, res, next) {
  try {
    const list = await getAllEmployees();
    return res.json({
      success: true,
      data: list
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

export async function getOne(req, res, next) {
  try {
    const emp = await getEmployeeById(req.params.id);
    return res.json({
      success: true,
      data: emp
    });
  } catch (err) {
    return res.status(404).json({
      success: false,
      message: err.message
    });
  }
}

export async function create(req, res, next) {
  try {
    const { name, email, phone, roleTitle, baseSalary, commissionType, commissionValue } = req.body;
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Nome e e-mail do funcionário são obrigatórios.'
      });
    }

    const created = await createEmployee({
      name,
      email,
      phone: phone || '',
      roleTitle: roleTitle || 'Vendedor(a) de Balcão',
      baseSalary: Number(baseSalary) || 0,
      commissionType: commissionType || 'percentage',
      commissionValue: Number(commissionValue) || 0,
      gamificationLevel: calculateGasLevel(0, 0, roleTitle)
    });

    return res.status(201).json({
      success: true,
      message: 'Funcionário cadastrado com sucesso!',
      data: created
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function update(req, res, next) {
  try {
    const updated = await updateEmployee(req.params.id, req.body);
    return res.json({
      success: true,
      message: 'Dados do funcionário atualizados!',
      data: updated
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function remove(req, res, next) {
  try {
    await deleteEmployee(req.params.id);
    return res.json({
      success: true,
      message: 'Funcionário removido com sucesso.'
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

import { EmployeeVoucher } from './employee-voucher.model.js';
import { Vehicle } from '../fleet/vehicle.model.js';

export async function createVoucher(req, res, next) {
  try {
    const { employeeId, amount, justification, notes, vehicleId, vehicleKm } = req.body;
    
    if (!employeeId || !amount || !justification) {
      return res.status(400).json({ success: false, message: 'Funcionário, valor e justificativa são obrigatórios' });
    }

    const voucher = await EmployeeVoucher.create({
      employee: employeeId,
      amount,
      justification,
      notes,
      vehicle: vehicleId || null,
      vehicleKm: vehicleKm || null,
      issuedBy: req.user?._id,
      issuedByName: req.user?.name || 'Admin'
    });

    if (vehicleId && vehicleKm) {
      await Vehicle.findByIdAndUpdate(vehicleId, {
        currentKm: vehicleKm,
        lastKmUpdate: new Date()
      });
    }

    return res.status(201).json({ success: true, data: voucher });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function listVouchers(req, res, next) {
  try {
    const vouchers = await EmployeeVoucher.find().populate('employee', 'name').sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: vouchers });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
