import {prepareAgreement,checkAgreementCredit,attachAgreement} from './agreements.js';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {httpError} from './database.js';
import {stockMovement} from './catalog.js';
import {openCash,recordPayment,cashBalance} from './sales.js';
import {fiscalDraftHash} from './fiscal.js';
const cents=z.number().int().min(0).max(1000000000),positive=cents.refine(n=>n>0);
export const financialEditInput=z.object({confirmed:z.literal(true),useAgreement:z.boolean().optional(),agreementId:z.uuid().optional(),items:z.array(z.object({position:z.number().int().positive(),quantity:z.number().int().min(1).max(1000000),unitPriceCents:positive}).strict()).min(1).max(100),discountCents:cents,deliveryFeeCents:cents,payments:z.array(z.object({method:z.enum(['cash','pix','credit_card','debit_card','online']),amountCents:positive,receivedCents:cents.optional(),installments:z.number().int().min(1).max(24).default(1),reference:z.string().trim().max(200).default('')}).strict()).max(10).optional(),paymentTerm:z.enum(['immediate','credit','delivery','pickup']).optional(),dueDate:z.iso.date().nullable().optional()}).strict();
export const financialProjection=s=>({totalCents:s.total_cents,subtotalCents:s.subtotal_cents,discountCents:s.discount_cents,deliveryFeeCents:s.delivery_fee_cents,paymentTerm:s.payment_term,dueDate:s.due_date,items:s.items.map(i=>({position:i.position,quantity:i.quantity,unitPriceCents:i.unit_price_cents,grossCents:i.gross_cents,discountCents:i.discount_cents})),payments:s.payments});
export async function financialBlock(c,sale){
 if(sale.agreement)return 'Vendas de convênio precisam ser ajustadas pelo fluxo do grupo, preservando limites e fechamento.';
 if(sale.payments.some(p=>p.smartpos_charge_id))return 'Pagamento aprovado em SmartPOS exige estorno pela integração antes de corrigir os valores.';
 if((await c.query('SELECT 1 FROM bansir.vouchers WHERE sale_id=$1 LIMIT 1',[sale.id])).rowCount)return 'Esta venda está vinculada a um vale. Revise o vale antes de alterar os valores.';
 return null;
}
export const financialCashLock=(c,i)=>c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`sale-financial:${i.tenantId}:${i.establishmentId}`]);
const fail=(m,code='SALE_FINANCIAL_INVALID')=>{throw httpError(409,m,code);};
export async function applyFinancialEdit(c,i,sale,b,reason,requestKey,customer,member){
 const blocked=await financialBlock(c,sale);if(blocked)fail(blocked,'SALE_FINANCIAL_LOCKED');
 const cash=await openCash(c,i);
 if(b.items.length!==sale.items.length||new Set(b.items.map(x=>x.position)).size!==sale.items.length||b.items.some(x=>!sale.items.some(y=>y.position===x.position)))fail('Revise os mesmos produtos da venda.','SALE_ITEMS_MISMATCH');
 const items=b.items.map(x=>({...x,old:sale.items.find(y=>y.position===x.position),gross:x.quantity*x.unitPriceCents})),subtotal=items.reduce((n,x)=>n+x.gross,0),total=subtotal-b.discountCents+b.deliveryFeeCents;
 if(!Number.isSafeInteger(subtotal)||subtotal>1000000000||total>1000000000||b.discountCents>=subtotal||total<=0)fail('Total ou desconto inválido.','INVALID_TOTAL');
 if(sale.delivery_mode==='pickup'&&b.deliveryFeeCents)fail('Taxa de entrega exige modalidade entrega.');
 if(total!==sale.total_cents&&(await c.query('SELECT 1 FROM bansir.sale_commissions WHERE sale_id=$1 AND amount_cents>0',[sale.id])).rowCount)fail('Esta venda possui comissão registrada. Revise a comissão antes de alterar o total.','SALE_COMMISSION_REVIEW_REQUIRED');
 const commercialChanged=total!==sale.total_cents||items.some(x=>x.quantity!==x.old.quantity||x.unitPriceCents!==x.old.unit_price_cents)||b.discountCents!==sale.discount_cents||b.deliveryFeeCents!==sale.delivery_fee_cents;
 if(commercialChanged&&(await c.query('SELECT 1 FROM bansir.storefront_orders WHERE sale_id=$1 LIMIT 1',[sale.id])).rowCount)fail('Esta venda veio do link de pedidos. Os produtos e valores do pedido precisam ser revistos pelo fluxo do pedido; aqui você pode corrigir somente os pagamentos.','SALE_ORDER_REVIEW_REQUIRED');
 const paid=b.payments?b.payments.reduce((n,p)=>n+p.amountCents,0):sale.paid_cents;
 if(paid>total)fail('Os pagamentos superam o novo total. Ajuste os recebimentos e confira a devolução.','PAYMENT_EXCEEDS_BALANCE');
 let agreement=null;if(b.useAgreement){if(paid!==0||!sale.customer_id)fail('Convênio exige cliente cadastrado e valor integral a receber.');agreement=await prepareAgreement(c,i,member,{customerId:sale.customer_id,payment:{method:'pending',term:'credit'}});if(!agreement)fail('Associe este cliente a um convênio ativo antes de salvar.');if(agreement.id!==b.agreementId)fail('O convênio do cliente mudou. Confira o grupo antes de salvar.','STALE_AGREEMENT');await checkAgreementCredit(c,agreement,total);}
 const term=b.useAgreement?'credit':paid===total?'immediate':b.paymentTerm&&b.paymentTerm!=='immediate'?b.paymentTerm:sale.payment_term==='immediate'?(sale.delivery_mode==='delivery'?'delivery':'pickup'):sale.payment_term;
 const due=agreement?.dueDate||(b.dueDate===undefined?sale.due_date:b.dueDate);
 if(paid<total&&(!customer.name||!customer.phone))fail('Saldo a receber exige nome e telefone do cliente.','CUSTOMER_REQUIRED');
 if(paid<total&&term==='credit'&&!due)fail('Informe o vencimento do saldo a receber.','DUE_DATE_REQUIRED');
 if(b.payments){for(const p of b.payments){if(p.method!=='credit_card'&&p.installments!==1)fail('Parcelas somente no crédito.');if(p.method==='cash'&&(p.receivedCents??0)<p.amountCents)fail('Dinheiro recebido menor que o valor nesta forma.','INSUFFICIENT_CASH');if(p.method!=='cash'&&p.receivedCents!==undefined&&p.receivedCents!==p.amountCents)fail('Troco somente em dinheiro.');}
 const oldCash=sale.payments.filter(p=>p.method==='cash').reduce((n,p)=>n+p.amount_cents,0),newCash=b.payments.filter(p=>p.method==='cash').reduce((n,p)=>n+p.amountCents,0);
 if(await cashBalance(c,cash)+newCash-oldCash<0)fail('O caixa atual não tem dinheiro suficiente para a devolução.','INSUFFICIENT_CASH');}
 const products=(await c.query('SELECT * FROM bansir.products WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[sale.items.map(x=>x.product_id)])).rows;
 for(const x of items){const p=products.find(p=>p.id===x.old.product_id),delta=x.quantity-x.old.quantity;if(delta>0&&(!p?.active||p.stock<delta))fail('Estoque insuficiente para aumentar a quantidade.','STOCK_UNAVAILABLE');if(delta){await c.query('UPDATE bansir.products SET stock=stock-$2,updated_at=now() WHERE id=$1',[p.id,delta]);await stockMovement(c,i,p,Math.abs(delta),delta>0?'out':'in',`Revisão do cupom ${sale.saleNumber}: ${reason}`);}}
 let remainder=b.discountCents;for(const x of items){x.discount=Number(BigInt(b.discountCents)*BigInt(x.gross)/BigInt(subtotal));remainder-=x.discount;}for(const x of items){if(!remainder)break;x.discount++;remainder--;}
 for(const x of items)await c.query('UPDATE bansir.sale_items SET quantity=$3,unit_price_cents=$4,gross_cents=$5,discount_cents=$6 WHERE sale_id=$1 AND position=$2',[sale.id,x.position,x.quantity,x.unitPriceCents,x.gross,x.discount]);
 await c.query('UPDATE bansir.sales SET subtotal_cents=$2,discount_cents=$3,delivery_fee_cents=$4,total_cents=$5,payment_term=$6,due_date=$7 WHERE id=$1',[sale.id,subtotal,b.discountCents,b.deliveryFeeCents,total,term,due]);
 if(agreement)await attachAgreement(c,i,{...sale,total_cents:total},agreement);
 if(b.payments){for(const p of sale.payments){await c.query('INSERT INTO bansir.sale_payment_reversals(tenant_id,establishment_id,payment_id,sale_id,cash_session_id,user_id,request_key,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp())',[i.tenantId,i.establishmentId,p.id,sale.id,cash.id,i.userId,requestKey,reason]);await c.query('UPDATE bansir.sale_payments SET reversed_at=clock_timestamp() WHERE id=$1 AND reversed_at IS NULL',[p.id]);if(p.method==='cash')await c.query("INSERT INTO bansir.cash_movements(tenant_id,establishment_id,cash_session_id,request_key,request_hash,payment_id,kind,amount_cents,reason) VALUES($1,$2,$3,$4,$5,$6,'refund',$7,$8)",[i.tenantId,i.establishmentId,cash.id,randomUUID(),fiscalDraftHash({requestKey,paymentId:p.id}),p.id,p.amount_cents,'Revisão da venda: '+reason]);}
 for(const p of b.payments)await recordPayment(c,i,sale,cash,{...p,requestKey:randomUUID(),confirmed:true});}
}
