import {httpError} from './database.js';
import {requireFeature} from './features.js';
export const agreementAllowed=(m,action)=>['admin','superadmin'].includes(m.role)||m.allowed_routes?.includes('agreements-'+action)||(action==='view'&&m.allowed_routes?.some(r=>['financial','financial-receivables','agreements-manage','agreements-close','agreements-collect'].includes(r)));
export function agreementPermission(m,action){if(!agreementAllowed(m,action))throw httpError(403,'Sem permissão para esta operação de convênio.','FORBIDDEN');}
export const agreementLock=(c,i)=>c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`agreements:${i.tenantId}:${i.establishmentId}`]);
export async function agreementToday(c){return (await c.query("SELECT (now() AT TIME ZONE coalesce((SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=config->>'timeZone') THEN config->>'timeZone' END FROM bansir.storefronts LIMIT 1),'America/Cuiaba'))::date::text AS today")).rows[0].today;}
const iso=d=>d.toISOString().slice(0,10);
const day=(year,month,date)=>new Date(Date.UTC(year,month,Math.min(date,new Date(Date.UTC(year,month+1,0)).getUTCDate())));
export function agreementTerms(today,cutDay,dueDay){
 const date=new Date(today+'T00:00:00Z'),year=date.getUTCFullYear(),month=date.getUTCMonth();
 let end=day(year,month,cutDay);if(iso(end)<today)end=day(year,month+1,cutDay);
 let due=day(end.getUTCFullYear(),end.getUTCMonth(),dueDay);if(due<=end)due=day(end.getUTCFullYear(),end.getUTCMonth()+1,dueDay);
 return {periodEnd:iso(end),dueDate:iso(due)};
}
export async function customerAgreement(c,id){return (await c.query(`SELECT a.*,m.customer_id,m.limit_cents AS member_limit_cents,p.name AS payer_name,p.document AS payer_document
 FROM bansir.agreement_members m JOIN bansir.agreements a ON(a.tenant_id,a.establishment_id,a.id)=(m.tenant_id,m.establishment_id,m.agreement_id)
 JOIN bansir.customers p ON(p.tenant_id,p.establishment_id,p.id)=(a.tenant_id,a.establishment_id,a.payer_customer_id)
 WHERE m.customer_id=$1 AND m.active`,[id])).rows[0]||null;}
export async function prepareAgreement(c,i,m,input){
 if(input.payment.method!=='pending'||input.payment.term!=='credit'||!input.customerId)return null;
 await agreementLock(c,i);const a=await customerAgreement(c,input.customerId);if(!a)return null;
 await requireFeature(c,'agreements');agreementPermission(m,'use');
 if(!a.active)throw httpError(409,'Convênio suspenso. Escolha pagamento imediato ou consulte o administrador.','AGREEMENT_SUSPENDED');
 const today=await agreementToday(c),terms=await nextAgreementTerms(c,a,today);
 input.payment.dueDate=terms.dueDate;return {...a,...terms,today};
}
export const agreementBalancesSql=`SELECT l.sale_id,l.agreement_id,l.customer_id,l.period_end::text,l.due_date::text,l.snapshot,s.coupon_number,s.customer_name,s.created_at,s.total_cents,
 CASE WHEN x.sale_id IS NOT NULL THEN 0 ELSE s.total_cents-coalesce(p.paid,0) END AS outstanding_cents,x.created_at AS cancelled_at,
 coalesce(p.paid,0) AS paid_cents,
 (SELECT jsonb_agg(jsonb_build_object('name',i.product_name,'quantity',i.quantity,'unitPriceCents',i.unit_price_cents) ORDER BY i.position) FROM bansir.sale_items i WHERE i.sale_id=s.id) AS items
 FROM bansir.sale_agreements l JOIN bansir.sales s ON(s.tenant_id,s.establishment_id,s.id)=(l.tenant_id,l.establishment_id,l.sale_id)
 LEFT JOIN bansir.sale_cancellations x ON(x.tenant_id,x.establishment_id,x.sale_id)=(s.tenant_id,s.establishment_id,s.id)
 LEFT JOIN LATERAL(SELECT sum(amount_cents) AS paid FROM bansir.active_sale_payments p WHERE(p.tenant_id,p.establishment_id,p.sale_id)=(s.tenant_id,s.establishment_id,s.id))p ON true`;
export async function checkAgreementCredit(c,a,total){
 if(!a)return;
 const balance=(await c.query(`SELECT coalesce(sum(outstanding_cents),0) AS total,
 coalesce(sum(outstanding_cents) FILTER(WHERE customer_id=$2),0) AS member,
 count(*) FILTER(WHERE outstanding_cents>0 AND due_date<$3) AS overdue FROM (${agreementBalancesSql} WHERE l.agreement_id=$1)b`,[a.id,a.customer_id,a.today])).rows[0];
 if(a.block_overdue&&Number(balance.overdue)>0)throw httpError(409,'O convênio possui saldo vencido. Procure o responsável financeiro.','AGREEMENT_OVERDUE');
 if(a.limit_cents!==null&&Number(balance.total)+total>Number(a.limit_cents))throw httpError(409,'Limite disponível do convênio insuficiente.','AGREEMENT_LIMIT');
 if(a.member_limit_cents!==null&&Number(balance.member)+total>Number(a.member_limit_cents))throw httpError(409,'Limite disponível do participante insuficiente.','AGREEMENT_MEMBER_LIMIT');
}
export async function attachAgreement(c,i,sale,a){if(!a)return;await c.query(`INSERT INTO bansir.sale_agreements(tenant_id,establishment_id,sale_id,agreement_id,customer_id,period_end,due_date,snapshot)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[i.tenantId,i.establishmentId,sale.id,a.id,a.customer_id,a.periodEnd,a.dueDate,{name:a.name,payerName:a.payer_name,payerDocument:a.payer_document,payerCustomerId:a.payer_customer_id,cutDay:a.cut_day,dueDay:a.due_day,limitCents:a.limit_cents}]);}

export async function nextAgreementTerms(c,a,today){
 let terms=agreementTerms(today,a.cut_day,a.due_day);
 for(let attempts=0;(await c.query('SELECT 1 FROM bansir.agreement_cycles WHERE agreement_id=$1 AND period_end=$2',[a.id,terms.periodEnd])).rowCount;attempts++){
  if(attempts>=12)throw httpError(409,'Revise os períodos fechados do convênio.','AGREEMENT_CYCLE_CONFLICT');
  const next=new Date(terms.periodEnd+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);terms=agreementTerms(iso(next),a.cut_day,a.due_day);
 }
 return terms;
}
