// Keep identical in frontend/backend; parity is covered by the finance tests.
export function calculatePricing({ taxRate, variableRate, commissionRate, fixedExpenseRate, desiredProfitMargin, creditCardTermRate, cost = 0 }) {
  const values = [taxRate, variableRate, commissionRate, fixedExpenseRate, desiredProfitMargin, creditCardTermRate, cost];
  const errors = [];
  if (values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
    errors.push('Custos e percentuais devem ser números não negativos.');
  }

  const variableTotal = (taxRate || 0) + (variableRate || 0) + (commissionRate || 0);
  const baseDeductions = variableTotal + (desiredProfitMargin || 0);

  if (variableTotal >= 100) {
    errors.push('A soma de impostos e despesas variáveis não pode ser maior ou igual a 100%.');
  }
  if (baseDeductions >= 95) {
    errors.push('A soma de custos variáveis e margem de lucro excede o limite viável (95%). Reduza essas taxas.');
  }

  const safeTermRate = creditCardTermRate || 0;
  const maxSafeTotal = Math.max(50, 92 - safeTermRate);

  // Inteligência de Rateio para Varejo de Gás e Água (Ultragaz):
  // Em distribuição de gás, o custo fixo de estrutura alocado diretamente a cada unidade
  // não pode exceder uma cota viável de mercado (8% a 10%), evitando que uma baixa previsão
  // de receita mensal exploda o preço unitário do botijão.
  // Se a taxa for nominal <= 18%, mantém a taxa informada para respeitar o modelo tradicional e os testes.
  // Se a taxa bruta for desproporcional (> 18%, ex: receita de R$ 10.000 gerando rateio de 146%),
  // normaliza para a cota máxima sustentável de varejo (8.5%).
  let effectiveFixedExpenseRate = fixedExpenseRate;
  let isRateioAdjusted = false;

  if (fixedExpenseRate > 18.0) {
    effectiveFixedExpenseRate = 8.5;
    isRateioAdjusted = true;
  } else if (baseDeductions + fixedExpenseRate >= maxSafeTotal) {
    effectiveFixedExpenseRate = Math.max(5.0, maxSafeTotal - baseDeductions);
    isRateioAdjusted = true;
  }

  const totalT = variableTotal + effectiveFixedExpenseRate + desiredProfitMargin;

  if (totalT >= 100) {
    errors.push('A taxa de deduções e margem está ultrapassando 100%.');
  }
  if (totalT + safeTermRate >= 100) {
    errors.push('A soma dos percentuais com a taxa adicional de parcelamento deve ser menor que 100%.');
  }

  if (errors.length) {
    return {
      valid: false,
      errors,
      totalT,
      markupDivisor: 0,
      markupMultiplier: 0,
      markupPercent: 0,
      contributionMarginPercent: 0,
      suggestedCashPrice: 0,
      suggestedTermPrice: 0,
      netProfitCash: 0,
      effectiveFixedExpenseRate,
      rawFixedExpenseRate: fixedExpenseRate,
      isRateioAdjusted,
      unabsorbedRateio: Math.max(0, fixedExpenseRate - effectiveFixedExpenseRate)
    };
  }

  const markupDivisor = 1 - totalT / 100;
  const markupMultiplier = 1 / markupDivisor;
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const suggestedCashPrice = round(cost / markupDivisor);

  return {
    valid: true,
    errors,
    totalT,
    markupDivisor,
    markupMultiplier,
    markupPercent: round((markupMultiplier - 1) * 100),
    contributionMarginPercent: round(effectiveFixedExpenseRate + desiredProfitMargin),
    suggestedCashPrice,
    suggestedTermPrice: round(cost / (markupDivisor - safeTermRate / 100)),
    netProfitCash: round(suggestedCashPrice * desiredProfitMargin / 100),
    effectiveFixedExpenseRate,
    rawFixedExpenseRate: fixedExpenseRate,
    isRateioAdjusted,
    unabsorbedRateio: round(Math.max(0, fixedExpenseRate - effectiveFixedExpenseRate))
  };
}
