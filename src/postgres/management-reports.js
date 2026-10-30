import {reportCatalog} from './report-catalog.js';
import {reportDetails} from './report-details.js';
import {tenantFeatures} from './features.js';
import {z} from 'zod';
import PDFDocument from 'pdfkit';
import {httpError} from './database.js';
import {employees,financeEntries} from './management.js';
const modes=reportCatalog.map(x=>x.key);
const dateOnly=v=>v instanceof Date?`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`:String(v).slice(0,10);
const currency=v=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export async function managementReport(c,query,member={role:'admin'},context=null){
 const now=new Date().toISOString().slice(0,10),d=z.object({startDate:z.iso.date().default(now.slice(0,8)+'01'),endDate:z.iso.date().default(now),mode:z.enum(modes).default('consolidado'),driverId:z.union([z.uuid(),z.literal('')]).default(''),seller:z.string().max(200).default(''),category:z.string().max(200).default(''),paymentMethod:z.enum(['','cash','pix','credit_card','debit_card']).default(''),saleStatus:z.enum(['','paid','pending','cancelled']).default('')}).strict().parse(query);
 if(d.endDate<d.startDate||(+new Date(d.endDate)-+new Date(d.startDate))>366*86400000)throw httpError(400,'Selecione um período de até um ano.','INVALID_PERIOD');
 const features=context?.features||await tenantFeatures(c),isAdmin=['admin','superadmin'].includes(member.role);
 const coverage=reportCatalog.map(x=>({...x,available:(!x.feature||features[x.feature]===true)&&(!x.adminOnly||isAdmin)}));
 const chosen=coverage.find(x=>x.key===d.mode);if(!chosen.available)throw httpError(403,'Relatório indisponível no contrato ou nas permissões deste usuário.','REPORT_UNAVAILABLE');
 if(!context){
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
 context={timezone,sales,valid,total,cost,received,spent,ledger,entries,bounds,features};
 }
 const {timezone,sales,valid,total,cost,received,spent,ledger,entries,bounds}=context;
 const data={mode:d.mode,period:d,startDate:d.startDate,endDate:d.endDate,timeZone:timezone,kpis:{salesTotal:total,productCost:cost,grossMargin:total-cost,received,spent,balance:received-spent,salesCount:valid.length},columns:[],rows:[],coverage,basis:chosen.basis,generatedAt:new Date().toISOString()};
 if(d.mode==='vendas'||d.mode==='consolidado'){data.columns=['Venda','Data','Vendedor','Cliente','Situação','Valor','Recebido','Telefone','Subtotal','Desconto','Entrega','Modalidade','Endereço','Caixa','Vencimento'];data.rows=sales.map(s=>[s.id,new Date(s.created_at).toLocaleString('pt-BR',{timeZone:timezone}),s.seller_name,s.customer_name,s.status,currency(Number(s.total_cents)/100),currency(Number(s.paid)/100),s.customer_phone,currency(Number(s.subtotal_cents)/100),currency(Number(s.discount_cents)/100),currency(Number(s.delivery_fee_cents)/100),s.delivery_mode,s.delivery_address,s.cash_session_id,s.due_date?dateOnly(s.due_date):'']);}
 if(d.mode==='estoque'){data.columns=['Produto','Categoria','Estoque atual','Custo unitário','Preço','Alerta','Cadastro'];data.rows=(await c.query("SELECT * FROM bansir.products WHERE ($1='' OR category=$1) ORDER BY stock,name LIMIT 5001",[d.category])).rows.map(p=>[p.name,p.category,p.stock,currency(Number(p.cost_cents)/100),currency(Number(p.price_cents)/100),p.stock<=5?'Estoque baixo':'Regular',p.active?'Ativo':'Inativo']);}
 if(d.mode==='fiscal'){data.columns=['Documento','Data','Ambiente','Situação','Protocolo','Chave'];data.rows=(await c.query('SELECT * FROM bansir.fiscal_documents WHERE (created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date ORDER BY created_at DESC LIMIT 5001',[d.startDate,d.endDate,timezone])).rows.map(f=>[f.id.slice(0,8),new Date(f.created_at).toLocaleString('pt-BR',{timeZone:timezone}),f.environment===1?'Produção':'Homologação',f.status,f.protocol||'',f.access_key||'']);}
 if(d.mode==='funcionarios'){data.columns=['Funcionário','Cargo','Vendas no período','Total vendido','Comissão de vendas pagas'];const commissions=(await c.query('SELECT * FROM bansir.sale_commissions WHERE sale_id=ANY($1::uuid[])',[sales.filter(s=>s.status==='paid').map(s=>s.id)])).rows;data.rows=(await employees(c)).map(e=>{const rows=commissions.filter(x=>x.employee_id===e.id),ids=new Set(rows.map(x=>x.sale_id));return [e.name,e.roleTitle,rows.length,currency(sales.filter(s=>ids.has(s.id)).reduce((n,s)=>n+Number(s.total_cents),0)/100),currency(rows.reduce((n,s)=>n+Number(s.amount_cents),0)/100)];});}
 if(d.mode==='vales'){data.columns=['Código','Cliente','Emissor','Situação','Valor','Resgatado por','Emitido em','Resgatado em','Origem','Venda','Itens'];data.rows=(await c.query('SELECT * FROM bansir.vouchers WHERE (issued_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date ORDER BY issued_at DESC LIMIT 5001',[d.startDate,d.endDate,timezone])).rows.map(v=>[v.code,v.customer_name,v.issued_by_name,v.status,currency(Number(v.total_cents)/100),v.redeemed_by_name,new Date(v.issued_at).toLocaleString('pt-BR',{timeZone:timezone}),v.redeemed_at?new Date(v.redeemed_at).toLocaleString('pt-BR',{timeZone:timezone}):'',v.source,v.sale_id||'',JSON.stringify(v.items)]);}
 if(['financeiro','pagar','receber'].includes(d.mode)){
  const source=d.mode==='financeiro'?entries:ledger.filter(e=>{const day=e.dueDate?dateOnly(e.dueDate):new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(e.date));return e.type===(d.mode==='pagar'?'expense':'income')&&day>=d.startDate&&day<=d.endDate;});
  data.columns=['Lançamento','Tipo','Categoria','Origem','Valor','Situação','Vencimento','Liquidação','Pagamento'];
  data.rows=source.map(e=>[e.title,e.type==='income'?'Entrada':'Saída',e.category,e.source,currency(e.amount),e.status,e.dueDate?dateOnly(e.dueDate):'',e.settledAt?new Date(e.settledAt).toLocaleString('pt-BR',{timeZone:timezone}):'',e.paymentMethod]);
 }
 const detail=await reportDetails(c,d.mode,d,timezone);if(detail)Object.assign(data,detail);
 if(data.rows.length>5000)throw httpError(400,'Mais de 5.000 registros. Selecione um período menor.','REPORT_TOO_LARGE');
 if(d.mode==='consolidado'){
  data.sections=[];let count=data.rows.length;
  for(const item of coverage.filter(x=>x.available&&!['consolidado','vendas'].includes(x.key))){const child=await managementReport(c,{...d,mode:item.key},member,context);count+=child.rows.length;if(count>20000)throw httpError(400,'O consolidado supera 20.000 registros. Use relatórios por módulo ou reduza o período.','REPORT_TOO_LARGE');data.sections.push({key:item.key,label:item.label,basis:item.basis,columns:child.columns,rows:child.rows});}
 }
 return data;
}
async function reportPdf(data){
 const doc=new PDFDocument({size:'A4',layout:'landscape',margin:28}),chunks=[];
 const finished=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.fontSize(17).text('Bansir · '+reportCatalog.find(x=>x.key===data.mode).label);doc.fontSize(9).text(data.startDate+' a '+data.endDate+' · '+data.timeZone).moveDown();
 doc.text('Vendas: '+currency(data.kpis.salesTotal)+' | Recebimentos: '+currency(data.kpis.received)+' | Saídas: '+currency(data.kpis.spent)).moveDown();
 for(const section of [{label:reportCatalog.find(x=>x.key===data.mode).label,basis:data.basis,columns:data.columns,rows:data.rows},...(data.sections||[])]){
  if(doc.y>440)doc.addPage();doc.fontSize(12).text(section.label);doc.fontSize(8).text(section.basis).moveDown(.4);
  const header=()=>{doc.fontSize(8).fillColor('#285c48').text(section.columns.join(' | '),{width:780}).fillColor('#222222').moveDown(.3);};header();
  if(!section.rows.length)doc.text('Sem registros.');
  for(const row of section.rows){const line=row.join(' | '),h=doc.heightOfString(line,{width:780});if(doc.y+h>550){doc.addPage();header();}doc.text(line,{width:780}).moveDown(.5);}
  doc.moveDown();
 }
 doc.end();return finished;
}
function reportCsv(data){
 const cell=x=>{const text=String(x??''),safe=/^[\s\u0000]*[=+@-]/.test(text)?"'"+text:text;return '"'+safe.replace(/"/g,'""')+'"';};
 const sections=[{label:reportCatalog.find(x=>x.key===data.mode).label,columns:data.columns,rows:data.rows},...(data.sections||[])];
 const rows=data.sections?[['Relatório','Registro','Campo','Valor'],...sections.flatMap(s=>s.rows.flatMap((r,i)=>r.map((v,j)=>[s.label,i+1,s.columns[j],v])))]:[data.columns,...data.rows];
 return Buffer.from('\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n'),'utf8');
}
export function mountManagementReports(app,{scoped}){
 app.get('/api/v1/reports/catalog',scoped('reports',true,async(c,r,m)=>{const f=await tenantFeatures(c);return {data:{modes:reportCatalog.map(x=>({...x,available:(!x.feature||f[x.feature]===true)&&(!x.adminOnly||['admin','superadmin'].includes(m.role))})),drivers:(await c.query('SELECT id,name FROM bansir.deliverers ORDER BY name')).rows}};}));
 app.get('/api/v1/reports/csv',scoped('reports',true,async(c,r,m)=>({data:{base64:reportCsv(await managementReport(c,r.query,m)).toString('base64')}})));
 app.get('/api/v1/reports/sellers',scoped('reports',true,async c=>({data:(await c.query('SELECT DISTINCT seller_name AS name FROM bansir.sales ORDER BY seller_name')).rows})));
 app.get('/api/v1/reports/summary',scoped('reports',true,async(c,req,m)=>({data:await managementReport(c,req.query,m)})));
 app.get('/api/v1/reports/pdf',scoped('reports',true,async(c,req,m)=>({data:{base64:(await reportPdf(await managementReport(c,req.query,m))).toString('base64')}})));
}
