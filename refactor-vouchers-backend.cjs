const fs = require('fs');

// 1. Update employee-voucher.model.js
const voucherPath = 'c:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/modules/employees/employee-voucher.model.js';
let voucherContent = fs.readFileSync(voucherPath, 'utf8');

const voucherOld = `    notes: {
      type: String
    }
  },`;
const voucherNew = `    notes: {
      type: String
    },
    vehicle: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UltragasVehicle'
    },
    vehicleKm: {
      type: Number
    }
  },`;
if (!voucherContent.includes('vehicleKm')) {
  voucherContent = voucherContent.replace(voucherOld, voucherNew);
  fs.writeFileSync(voucherPath, voucherContent, 'utf8');
  console.log('employee-voucher.model.js updated');
}

// 2. Update employee.controller.js
const controllerPath = 'c:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/modules/employees/employee.controller.js';
let controllerContent = fs.readFileSync(controllerPath, 'utf8');

const controllerAdditions = `
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
`;

if (!controllerContent.includes('createVoucher')) {
  controllerContent = controllerContent + controllerAdditions;
  fs.writeFileSync(controllerPath, controllerContent, 'utf8');
  console.log('employee.controller.js updated');
}

// 3. Update employee.routes.js
const routesPath = 'c:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/modules/employees/employee.routes.js';
let routesContent = fs.readFileSync(routesPath, 'utf8');

if (!routesContent.includes("router.post('/vouchers', createVoucher);")) {
  routesContent = routesContent.replace(
    "import { list, getOne, create, update, remove } from './employee.controller.js';",
    "import { list, getOne, create, update, remove, createVoucher, listVouchers } from './employee.controller.js';"
  );
  routesContent = routesContent.replace(
    "router.get('/', list);",
    "router.get('/vouchers', listVouchers);\nrouter.post('/vouchers', createVoucher);\nrouter.get('/', list);"
  );
  fs.writeFileSync(routesPath, routesContent, 'utf8');
  console.log('employee.routes.js updated');
}
