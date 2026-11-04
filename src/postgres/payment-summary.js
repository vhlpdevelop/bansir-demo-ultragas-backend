export const paymentLabels={cash:'Dinheiro',pix:'Pix',credit_card:'Cartão de crédito',debit_card:'Cartão de débito',online:'Pagamento online',transferencia:'Transferência',boleto:'Boleto',vale:'Vale',outro:'Outros'};
const aliases={dinheiro:'cash',cartao_credito:'credit_card',cartao_debito:'debit_card'};
// Entries already carry their ledger sign and scope. Pending balances are never receipts.
export function paymentSummary(entries){
 const methods=Object.fromEntries(Object.keys(paymentLabels).map(key=>[key,{method:key,label:paymentLabels[key],receivedCents:0,outflowCents:0,netCents:0}]));let pendingCents=0;
 for(const e of entries){const cents=Math.round(Number(e.amount)*100);if(e.status==='pending'&&e.type==='income'){pendingCents+=cents;continue;}if(e.status!=='completed')continue;const method=aliases[e.paymentMethod]||e.paymentMethod;const row=methods[method]||methods.outro;if(e.type==='income')row.receivedCents+=cents;else if(e.type==='expense')row.outflowCents+=cents;row.netCents=row.receivedCents-row.outflowCents;}
 return {methods:Object.values(methods),pendingCents};
}
