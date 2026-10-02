// Keep identical in frontend/backend; parity is covered by the finance tests.
export function calculatePricing({ taxRate, variableRate, commissionRate, fixedExpenseRate, desiredProfitMargin, creditCardTermRate, cost = 0 }) {
  const values = [taxRate, variableRate, commissionRate, fixedExpenseRate, desiredProfitMargin, creditCardTermRate, cost];
  const errors = [];
  if (values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) errors.push('Custos e percentuais devem ser números não negativos.');
  const variableTotal = taxRate + variableRate + commissionRate;
  const totalT = variableTotal + fixedExpenseRate + desiredProfitMargin;
  if (totalT >= 100) errors.push('A taxa de custos fixos (Rateio) + margens está ultrapassando 100%. Tente aumentar a Receita Mensal Prevista ou reduzir despesas.');
  if (totalT + creditCardTermRate >= 100) errors.push('A soma dos percentuais com a taxa adicional de parcelamento deve ser menor que 100%.');
  if (errors.length) return { valid: false, errors, totalT, markupDivisor: 0, markupMultiplier: 0, markupPercent: 0, contributionMarginPercent: 0, suggestedCashPrice: 0, suggestedTermPrice: 0, netProfitCash: 0 };
  const markupDivisor = 1 - totalT / 100;
  const markupMultiplier = 1 / markupDivisor;
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const suggestedCashPrice = round(cost / markupDivisor);
  return { valid: true, errors, totalT, markupDivisor, markupMultiplier, markupPercent: round((markupMultiplier - 1) * 100),
    contributionMarginPercent: round(fixedExpenseRate + desiredProfitMargin),
    suggestedCashPrice, suggestedTermPrice: round(cost / (markupDivisor - creditCardTermRate / 100)),
    netProfitCash: round(suggestedCashPrice * desiredProfitMargin / 100) };
}
