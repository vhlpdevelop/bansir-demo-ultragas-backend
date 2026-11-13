import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptPdf} from '../src/postgres/printing.js';
import {readPdfTable} from '../src/postgres/pdf-import.js';
import {receiptBalancePlan} from '../src/postgres/agreements.js';

const base={saleNumber:'1',created_at:'2026-11-07T15:00:00Z',seller_name:'Op',customer_name:'Elenir',status:'pending',subtotal_cents:3900,delivery_fee_cents:0,discount_cents:0,outstanding_cents:3900,total_cents:3900,paid_cents:0,items:[{quantity:1,product_name:'Gas',unit_price_cents:3900,gross_cents:3900,discount_cents:0}],payments:[]};
const both={entryCents:3900,scope:'individual',previousCents:3000,totalCents:6900,individual:{previousCents:3000,totalCents:6900},group:{previousCents:9000,totalCents:12900}};
const sale=(balanceAtEntry,flags,currentBalances)=>({...base,agreement:{agreement_id:'x',customer_id:'c',due_date:'2026-12-10',snapshot:{name:'J B Feitosa',payerName:'J B Feitosa',...(balanceAtEntry?{balanceAtEntry}:{})},...flags,...(currentBalances?{currentBalances}:{})}});
async function text(s){const t=await readPdfTable((await receiptPdf(s,{store_name:'Loja'},80)).toString('base64'));return t.pages.flatMap(p=>p.lines.map(l=>l.items.map(i=>i.text).join(' '))).join('\n');}

test('receipt shows only the participant balance when the group balance is hidden',async()=>{
 const out=await text(sale(both,{showIndividualBalance:true,showGroupBalance:false}));
 assert.match(out,/Saldo anterior do cliente R\$ 30,00/);assert.match(out,/Saldo após lançamento R\$ 69,00/);assert.doesNotMatch(out,/grupo/i);assert.doesNotMatch(out,/90,00|129,00/);
});
test('receipt shows only the group balance when the participant balance is hidden',async()=>{
 const out=await text(sale(both,{showIndividualBalance:false,showGroupBalance:true}));
 assert.match(out,/Saldo anterior do grupo R\$ 90,00/);assert.match(out,/Saldo após lançamento R\$ 129,00/);assert.doesNotMatch(out,/cliente R\$/);
});
test('receipt can show participant and group together, or neither',async()=>{
 const both_=await text(sale(both,{showIndividualBalance:true,showGroupBalance:true}));
 assert.match(both_,/Total cliente após venda R\$ 69,00/);assert.match(both_,/Total grupo após venda R\$ 129,00/);
 const none=await text(sale(both,{showIndividualBalance:false,showGroupBalance:false}));
 assert.match(none,/Lançamento desta venda R\$ 39,00/);assert.doesNotMatch(none,/Saldo anterior|Total (cliente|grupo)/);
});
test('sales saved before both positions existed keep their scope and fall back to current balances',()=>{
 const legacyIndividual={scope:'individual',previousCents:3000,entryCents:3900,totalCents:6900};
 const plan=receiptBalancePlan(sale(legacyIndividual,{showIndividualBalance:true,showGroupBalance:true}).agreement);
 assert.deepEqual(plan.items.map(x=>[x.scope,!!x.position]),[['individual',true],['group',false]]);
 const noScope=receiptBalancePlan(sale({previousCents:1,entryCents:2,totalCents:3},{showIndividualBalance:true,showGroupBalance:false}).agreement);
 assert.equal(noScope.items[0].position,null);
});
test('legacy sale without a balance snapshot prints the current balances requested',async()=>{
 const out=await text(sale(null,{showIndividualBalance:true,showGroupBalance:true},{individual:3000,group:9000}));
 assert.match(out,/Saldo atual do cliente R\$ 30,00/);assert.match(out,/Saldo atual do grupo R\$ 90,00/);
});
