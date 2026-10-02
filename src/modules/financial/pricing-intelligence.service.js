import { getAllEmployees } from '../employees/employee.service.js';
import { Product } from '../products/product.model.js';
import { requireDatabase } from '../../config/db.js';
import { PricingConfig } from './pricing-config.model.js';
import { calculatePricing } from './pricing-calculator.js';

async function readSettings() {
  requireDatabase();
  const document = await PricingConfig.findById('store');
  if (!document) throw new Error('Configure os parâmetros de preços ou execute a seed inicial.');
  return document.settings;
}
function validate(config) {
  const numeric = (value, min, max, label) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} inválido.`);
  };
  const hours = config.businessHours;
  numeric(hours.daysPerWeek, 0, 7, 'Dias por semana');
  numeric(hours.dailyStoreHours, 0, 24, 'Horas da loja');
  numeric(hours.dailyHoursPerPerson, 0, 24, 'Horas por pessoa');
  numeric(hours.workedDaysPerMonth, 0, 31, 'Dias por mês');
  numeric(hours.efficiencyFactor, 0, 1, 'Eficiência');
  if (hours.customNp != null) numeric(hours.customNp, 0, 10000, 'Pessoas produtivas');
  for (const time of [hours.openingTime, hours.closingTime]) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Horário inválido.');
  for (const [items, key] of [[config.fixedExpenses, 'amount'], [config.variableExpenses, 'percentage']]) {
    if (!Array.isArray(items)) throw new Error('Lista de despesas inválida.');
    for (const item of items) {
      if (!item.name?.trim()) throw new Error('Nome da despesa obrigatório.');
      numeric(item[key], 0, key === 'amount' ? 1e12 : 99.99, 'Despesa');
    }
  }
  for (const key of ['taxRate', 'desiredProfitMargin', 'manualCommissionRate', 'creditCardTermRate']) numeric(config.pricingRules[key], 0, 99.99, key);
  numeric(config.pricingRules.expectedMonthlyRevenue, 0.01, 1e12, 'Receita mensal prevista');
  if (!['auto', 'manual'].includes(config.pricingRules.commissionMode)) throw new Error('Modo de comissão inválido.');
}
async function compute(settings) {
  const active = (await getAllEmployees()).filter(e => e.active !== false);
  const modEmployees = active.filter(e => (e.laborType || 'MOD') === 'MOD');
  const moiEmployees = active.filter(e => e.laborType === 'MOI');
  const np = settings.businessHours.customNp ?? modEmployees.length;
  const moiPayroll = moiEmployees.reduce((sum, e) => sum + Number(e.baseSalary || 0), 0);
  const registeredTotal = settings.fixedExpenses.reduce((sum, e) => sum + e.amount, 0);
  const totalFixedExpenses = registeredTotal + moiPayroll;
  const fixedExpenseRate = totalFixedExpenses / settings.pricingRules.expectedMonthlyRevenue * 100;
  const percentEmployees = modEmployees.filter(e => e.commissionType === 'percentage');
  const commissionRate = settings.pricingRules.commissionMode === 'manual' ? settings.pricingRules.manualCommissionRate :
    (percentEmployees.length ? percentEmployees.reduce((s,e) => s + Number(e.commissionValue || 0), 0) / percentEmployees.length : 0);
  const variableRate = settings.variableExpenses.reduce((s,e) => s + e.percentage, 0);
  const calculation = calculatePricing({ ...settings.pricingRules, commissionRate, variableRate, fixedExpenseRate });
  const { dailyHoursPerPerson: hp, workedDaysPerMonth: dtn, efficiencyFactor, daysPerWeek, dailyStoreHours } = settings.businessHours;
  const monthlyProductiveCapacity = np * hp * dtn * efficiencyFactor;
  return {
    businessHours: { ...settings.businessHours, weeklyStoreHours: daysPerWeek * dailyStoreHours, monthlyStoreHours: Math.round(daysPerWeek * dailyStoreHours * 52 / 12) },
    workforce: { totalEmployees: active.length, np, moiCount: moiEmployees.length, moiPayroll, modEmployees, moiEmployees },
    productiveCapacity: { np, hp, dtn, efficiencyFactor, monthlyProductiveCapacity },
    fixedExpenses: { items: settings.fixedExpenses, registeredTotal, moiPayroll, totalFixedExpenses, hourlyStructureCost: monthlyProductiveCapacity > 0 ? totalFixedExpenses / monthlyProductiveCapacity : 0 },
    variableExpenses: { items: settings.variableExpenses, totalVariableExpensesRate: variableRate },
    pricingRules: { ...settings.pricingRules, fixedExpenseRate, effectiveCommissionRate: commissionRate },
    indicators: { ...calculation, totalTaxesAndDeductionsT: calculation.totalT, creditCardTermRate: settings.pricingRules.creditCardTermRate }
  };
}
export async function getPricingIntelligenceData() { return compute(await readSettings()); }
export async function updatePricingIntelligenceData(payload) {
  const current = await readSettings();
  const settings = { businessHours: { ...current.businessHours, ...payload.businessHours },
    pricingRules: { ...current.pricingRules, ...payload.pricingRules },
    fixedExpenses: payload.fixedExpenses ?? current.fixedExpenses,
    variableExpenses: payload.variableExpenses ?? current.variableExpenses };
  validate(settings);
  const result = await compute(settings);
  if (!result.indicators.valid) throw new Error(result.indicators.errors.join(' '));
  await PricingConfig.findByIdAndUpdate('store', { settings }, { upsert: true, new: true, runValidators: true });
  return result;
}
export async function applySuggestedPriceToProduct(productId, newPrice) {
  const numericPrice = Number(newPrice);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) throw new Error('Preço informado inválido.');
  const config = await getPricingIntelligenceData();
  if (!config.indicators.valid) throw new Error('Corrija os parâmetros de precificação antes de aplicar um preço.');
  const product = await Product.findByIdAndUpdate(productId, { price: numericPrice }, { new: true, runValidators: true });
  if (!product) throw new Error('Produto não encontrado.');
  return product;
}
