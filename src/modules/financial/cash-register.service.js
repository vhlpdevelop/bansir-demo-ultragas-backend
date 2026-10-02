import { CashRegister } from './cash-register.model.js';
import { Sale } from '../sales/sale.model.js';
import { requireDatabase } from '../../config/db.js';

export async function closeCashRegister(data, user) {
  requireDatabase();
  
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Calculate system sales
  const todaySales = await Sale.find({
    date: { $gte: startOfDay, $lte: endOfDay },
    status: 'completed'
  });

  const systemSalesAmount = todaySales.reduce((acc, sale) => acc + sale.totalAmount, 0);
  
  // Previous day change
  const lastClosure = await CashRegister.findOne().sort({ date: -1 });
  const systemPreviousChange = lastClosure ? lastClosure.informedChange : 0;
  
  // In a real scenario, received notes might be queried from transactions, we'll keep it simple or based on user input for now if not tracked in a separate model.
  const systemReceivedNotes = data.systemReceivedNotes || 0; 
  
  const expectedTotal = systemSalesAmount + systemReceivedNotes + systemPreviousChange;
  
  const informedLargeBills = Number(data.informedLargeBills || 0);
  const informedChange = Number(data.informedChange || 0);
  const informedVouchers = Number(data.informedVouchers || 0);
  
  const informedTotal = informedLargeBills + informedChange + informedVouchers;
  
  const difference = informedTotal - expectedTotal;
  let status = 'balanced';
  if (difference > 0) status = 'surplus';
  if (difference < 0) status = 'shortage';

  const closure = await CashRegister.create({
    systemSalesAmount,
    systemReceivedNotes,
    systemPreviousChange,
    informedLargeBills,
    informedChange,
    informedVouchers,
    informedGasCount: Number(data.informedGasCount || 0),
    difference,
    status,
    closedBy: user._id || user.id,
    closedByName: user.name
  });

  return closure;
}

export async function getCashRegisterHistory() {
  requireDatabase();
  return CashRegister.find().sort({ date: -1 }).limit(30);
}
