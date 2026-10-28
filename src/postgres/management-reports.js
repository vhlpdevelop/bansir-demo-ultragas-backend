import {z} from 'zod';
import PDFDocument from 'pdfkit';
import {httpError} from './database.js';
import {employees,financeEntries} from './management.js';
const modes=['consolidado','vendas','estoque','fiscal','funcionarios','vales'];
const currency=v=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export async function managementReport(c,query){
 const now=new Date().toISOString().slice(0,10),d=z.object({startDate:z.iso.date().default(now.slice(0,8)+'01'),endDate:z.iso.date().default(now),mode:z.enum(modes).default('consolidado'),seller:z.string().max(200).default(''),category:z.string().max(200).default(''),paymentMethod:z.enum(['','cash','pix','credit_card','debit_card']).default(''),saleStatus:z.enum(['','paid','pending','cancelled']).default('')}).strict().parse(query);
 if(d.endDate<d.startDate||(+new Date(d.endDate)-+new Date(d.startDate))>366*86400000)throw httpError(400,'Selecione um período de até um ano.','INVALID_PERIOD');
 const timezone=(await c.query("SELECT coalesce(config->>'timeZone','America/Cuiaba') AS tz FROM bansir.storefronts")).rows[0]?.tz||'America/Cuiaba';
 const rawSales=(await c.query(`SELECT s.*,x.sale_id IS NOT NULL AS cancelled,coalesce((SELECT sum(p.amount_cents) FROM bansir.sale_payments p WHERE p.sale_id=s.id),0) AS paid,
 coalesce((SELECT sum(i.quantity*i.unit_cost_cents) FROM bansir.sale_items i WHERE i.sale_id=s.id),0) AS cost
 FROM bansir.sales s LEFT JOIN bansir.sale_cancellations x ON x.sale_id=s.id
 WHERE (s.created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date AND ($4='' OR s.seller_name=$4)
 AND ($5='' OR EXISTS(SELECT 1 FROM bansir.sale_items i JOIN bansir.products p ON p.id=i.product_id WHERE i.sale_id=s.id AND p.category=$5))
 AND ($6='' OR EXISTS(SELECT 1 FROM bansir.sale_payments p WHERE p.sale_id=s.id AND p.method=$6)) ORDER BY s.created_at DESC LIMIT 5001`,[d.startDate,d.endDate,timezone,d.seller,d.category,d.paymentMethod])).rows;
 if(rawSales.length>5000)throw httpError(400,'Reduza o período para exportar até 5.000 vendas.','REPORT_TOO_LARGE');
 const sales=rawSales.map(s=>({...s,status:s.cancelled?'cancelled':Number(s.paid)>=Number(s.total_cents)?'paid':'pending'})).filter(s=>!d.saleStatus||d.saleStatus===s.status);
 if(sales.length>5000)throw httpError(400,'Reduza o período para exportar até 5.000 vendas.','REPORT_TOO_LARGE');
 const valid=sales.filter(s=>!s.cancelled),total=valid.reduce((n,s)=>n+Number(s.total_cents),0)/100,cost=valid.reduce((n,s)=>n+Number(s.cost),0)/100;
 const ledger=await financeEntries(c);const dated=await c.query("SELECT ($1::date AT TIME ZONE $3) AS start,(($2::date+1) AT TIME ZONE $3) AS finish",[d.startDate,d.endDate,timezone]);const bounds=dated.rows[0];
 const entries=ledger.filter(e=>new Date(e.settledAt||e.date)>=bounds.start&&new Date(e.settledAt||e.date)<bounds.finish),received=entries.filter(e=>e.status==='completed'&&e.type==='income').reduce((n,e)=>n+Math.round(e.amount*100),0)/100,spent=entries.filter(e=>e.status==='completed'&&e.type==='expense').reduce((n,e)=>n+Math.round(e.amount*100),0)/100;
 const data={mode:d.mode,period:d,startDate:d.startDate,endDate:d.endDate,timeZone:timezone,kpis:{salesTotal:total,productCost:cost,grossMargin:total-cost,received,spent,balance:received-spent,salesCount:valid.length},columns:[],rows:[]};
 if(d.mode==='vendas'||d.mode==='consolidado'){data.columns=['Venda','Data','Vendedor','Cliente','Situação','Valor','Recebido'];data.rows=sales.map(s=>[s.id.slice(0,8),new Date(s.created_at).toLocaleString('pt-BR',{timeZone:timezone}),s.seller_name,s.customer_name,s.status,currency(Number(s.total_cents)/100),currency(Number(s.paid)/100)]);}
 if(d.mode==='estoque'){data.columns=['Produto','Categoria','Estoque atual','Custo unitário','Preço','Alerta'];data.rows=(await c.query("SELECT * FROM bansir.products WHERE active AND ($1='' OR category=$1) ORDER BY stock,name LIMIT 5000",[d.category])).rows.map(p=>[p.name,p.category,p.stock,currency(Number(p.cost_cents)/100),currency(Number(p.price_cents)/100),p.stock<=5?'Estoque baixo':'Regular']);}
 if(d.mode==='fiscal'){data.columns=['Documento','Data','Ambiente','Situação','Protocolo','Chave'];data.rows=(await c.query('SELECT * FROM bansir.fiscal_documents WHERE (created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date ORDER BY created_at DESC LIMIT 5000',[d.startDate,d.endDate,timezone])).rows.map(f=>[f.id.slice(0,8),new Date(f.created_at).toLocaleString('pt-BR',{timeZone:timezone}),f.environment===1?'Produção':'Homologação',f.status,f.protocol||'',f.access_key||'']);}
 if(d.mode==='funcionarios'){data.columns=['Funcionário','Cargo','Vendas no período','Total vendido','Comissão de vendas pagas'];const commissions=(await c.query('SELECT * FROM bansir.sale_commissions WHERE sale_id=ANY($1::uuid[])',[sales.filter(s=>s.status==='paid').map(s=>s.id)])).rows;data.rows=(await employees(c)).map(e=>{const rows=commissions.filter(x=>x.employee_id===e.id),ids=new Set(rows.map(x=>x.sale_id));return [e.name,e.roleTitle,rows.length,currency(sales.filter(s=>ids.has(s.id)).reduce((n,s)=>n+Number(s.total_cents),0)/100),currency(rows.reduce((n,s)=>n+Number(s.amount_cents),0)/100)];});}
 if(d.mode==='vales'){data.columns=['Código','Cliente','Emissor','Situação','Valor','Resgatado por'];data.rows=(await c.query('SELECT * FROM bansir.vouchers WHERE (issued_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date ORDER BY issued_at DESC LIMIT 5000',[d.startDate,d.endDate,timezone])).rows.map(v=>[v.code,v.customer_name,v.issued_by_name,v.status,currency(Number(v.total_cents)/100),v.redeemed_by_name]);}
 return data;
}
async function reportPdf(data){const doc=new PDFDocument({size:'A4',layout:'landscape',margin:28}),chunks=[];const finished=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});doc.fontSize(17).text('Bansir · Relatório '+data.mode);doc.fontSize(10).text(data.startDate+' a '+data.endDate+' · '+data.timeZone).moveDown();doc.text('Vendas: '+currency(data.kpis.salesTotal)+' | Recebimentos: '+currency(data.kpis.received)+' | Saídas: '+currency(data.kpis.spent)).moveDown();doc.fontSize(8).text(data.columns.join(' | '));for(const row of data.rows){if(doc.y>520)doc.addPage();doc.moveDown(.5).text(row.join(' | '),{width:780});}doc.end();return finished;}
export function mountManagementReports(app,{scoped}){
 app.get('/api/v1/reports/sellers',scoped('reports',true,async c=>({data:(await c.query('SELECT DISTINCT seller_name AS name FROM bansir.sales ORDER BY seller_name')).rows})));
 app.get('/api/v1/reports/summary',scoped('reports',true,async(c,req)=>({data:await managementReport(c,req.query)})));
 app.get('/api/v1/reports/pdf',scoped('reports',true,async(c,req)=>({data:{base64:(await reportPdf(await managementReport(c,req.query))).toString('base64')}})));
}
