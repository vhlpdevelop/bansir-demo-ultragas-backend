// Keep identical in frontend/backend; parity is covered by the finance tests.
export function calculatePricing({ taxRate, variableRate, commissionRate, fixedExpenseRate, desiredProfitMargin, creditCardTermRate, cost = 0 }) {
  const values = [taxRate, variableRate, commissionRate, fixedExpenseRate, desiredProfitMargin, creditCardTermRate, cost];
  const errors = [];
  const warnings = [];
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

  // Rateio Real baseado nas despesas fixas e receita prevista da revenda:
  // Utiliza a taxa real de despesas fixas informada pela empresa, garantindo que
  // todo o custo de estrutura seja coberto pelo preço sugerido.
  // Somente limita a taxa se a soma total de deduções inviabilizar matematicamente
  // a formação de preço (quando custos fixos + variáveis + margem excederem a capacidade viável da margem divisor).
  let effectiveFixedExpenseRate = fixedExpenseRate;
  let isRateioAdjusted = false;

  if (baseDeductions + fixedExpenseRate >= maxSafeTotal) {
    effectiveFixedExpenseRate = Math.max(5.0, maxSafeTotal - baseDeductions);
    isRateioAdjusted = true;
    warnings.push('As despesas fixas da revenda ultrapassam o teto viável por unidade. O rateio foi limitado a ' + effectiveFixedExpenseRate.toFixed(1) + '% para manter a viabilidade matemática.');
  } else if (fixedExpenseRate > 25.0) {
    warnings.push('A taxa de custos fixos está elevada (' + fixedExpenseRate.toFixed(1) + '% da receita). Preço calculado com a taxa real para cobertura integral.');
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
      warnings,
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
    warnings,
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
