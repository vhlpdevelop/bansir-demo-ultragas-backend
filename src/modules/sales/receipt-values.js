const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
export function receiptPaymentValues(data, total, isPaid) {
  const supplied = data.receivedAmount != null && data.receivedAmount !== '';
  const receivedAmount = round(Number(supplied ? data.receivedAmount : isPaid ? total : 0));
  const changeFor = round(Number(data.changeFor ?? 0));
  if (!Number.isFinite(receivedAmount) || receivedAmount < 0 || !Number.isFinite(changeFor) || changeFor < 0) throw new Error('Valores de recebimento ou troco inválidos.');
  if (!isPaid && receivedAmount > 0) throw new Error('Pagamento parcial não está habilitado. Informe o valor da cédula no campo Troco para.');
  if (isPaid && receivedAmount < total) throw new Error('O valor recebido deve cobrir o total da venda.');
  if (isPaid && data.paymentMethod !== 'dinheiro' && receivedAmount !== total) throw new Error('Troco é permitido apenas em dinheiro.');
  if (changeFor && (isPaid || data.paymentMethod !== 'dinheiro' || changeFor < total)) throw new Error('Troco para deve cobrir o total e só se aplica a dinheiro a receber na entrega.');
  return { receivedAmount, changeAmount: isPaid ? round(receivedAmount - total) : 0,
    outstandingAmount: isPaid ? 0 : total, changeFor, plannedChangeAmount: changeFor ? round(changeFor - total) : 0 };
}
