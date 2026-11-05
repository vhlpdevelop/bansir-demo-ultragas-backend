import PDFDocument from 'pdfkit';

const ink='#102447',blue='#204d91',muted='#526581',line='#dbe4f0',paper='#f3f7fc',gold='#e8b758';
const money=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const quantity=n=>n.toLocaleString('pt-BR');
const units=sale=>(sale.items||[]).reduce((sum,item)=>sum+Number(item.quantity),0);
const date=value=>value.split('-').reverse().join('/');

export async function agreementReportPdf(data,{month,period,timeZone}){
 const doc=new PDFDocument({size:'A4',margin:36,bufferPages:true,info:{Title:'Relatório de convênio',Author:'Bansir'}});
 const chunks=[];
 const output=new Promise((resolve,reject)=>{
  doc.on('data',chunk=>chunks.push(chunk));
  doc.on('end',()=>resolve(Buffer.concat(chunks)));
  doc.on('error',reject);
 });
 const left=36,width=doc.page.width-2*left,right=left+width;
 const reference=period?'Ciclo de cobrança  '+date(period):'Mês das vendas  '+month.split('-').reverse().join('/');
 const text=(value,x,y,w,{size=10,color=ink,bold=false,align='left',height}={})=>
  doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color)
   .text(String(value),x,y,{width:w,align,height,ellipsis:height!==undefined});
 const rule=(y)=>doc.strokeColor(line).lineWidth(.7).moveTo(left,y).lineTo(right,y).stroke();
 function banner(section,title){
  doc.rect(0,0,doc.page.width,124).fill(ink);
  doc.rect(left,34,24,3).fill(gold);
  text('BANSIR  /  CONVÊNIOS',left,47,width,{size:10,color:gold,bold:true});
  text(title,left,69,width,{size:24,color:'#ffffff',bold:true});
  text(section,left,101,width,{size:9,color:'#dbe7ff'});
 }
 function metric(x,y,w,label,value,emphasis=false){
  doc.roundedRect(x,y,w,68,9).fill(emphasis?ink:paper);
  text(label,x+14,y+13,w-28,{size:9,color:emphasis?'#dbe7ff':muted,bold:true});
  text(value,x+14,y+32,w-28,{size:18,color:emphasis?'#ffffff':ink,bold:true,height:23});
 }
 const valid=data.sales.filter(sale=>!sale.cancelled_at);
 const total=field=>valid.reduce((sum,sale)=>sum+sale[field],0);
 banner('01  /  RESUMO DO PERÍODO','Relatório de convênio');
 text(data.agreement.name,left,150,width,{size:21,bold:true,height:52});
 text('RESPONSÁVEL PELO PAGAMENTO',left,216,width,{size:9,color:muted,bold:true});
 text(data.agreement.payer_name,left,233,width,{size:12,height:32});
 text(reference,left,278,width,{size:11,color:blue,bold:true});
 rule(308);
 const gap=12,col=(width-2*gap)/3;
 metric(left,330,col,'VENDAS VÁLIDAS',quantity(valid.length));
 metric(left+col+gap,330,col,'UNIDADES VENDIDAS',quantity(valid.reduce((sum,sale)=>sum+units(sale),0)));
 metric(left+2*(col+gap),330,col,'VENDAS CANCELADAS',quantity(data.sales.length-valid.length));
 metric(left,410,col,'VALOR DAS VENDAS',money(total('total_cents')));
 metric(left+col+gap,410,col,'VALOR RECEBIDO',money(total('paid_cents')));
 metric(left+2*(col+gap),410,col,'SALDO A RECEBER',money(data.outstandingCents),true);
 text('Os totais financeiros consideram as vendas válidas. Os cupons cancelados estão identificados no detalhamento.',left,502,width,{size:10,color:muted});

 let y;
 function detailPage(){
  doc.addPage();
  banner('02  /  DETALHAMENTO','Vendas do convênio');
  text(data.agreement.name,left,145,width,{size:14,bold:true,height:36});
  text(reference,left,187,width,{size:10,color:muted});
  rule(210);y=226;
 }
 function saleHeader(sale,continued=false){
  const issued=new Date(sale.created_at).toLocaleString('pt-BR',{timeZone});
  const status=sale.cancelled_at?'CANCELADA':sale.outstanding_cents?'A RECEBER':'QUITADA';
  doc.roundedRect(left,y,width,76,8).fill(paper);
  text('Cupom '+sale.coupon_number+(continued?' (continuação)':''),left+12,y+10,width-150,{size:11,bold:true});
  text(status,right-126,y+10,114,{size:9,bold:true,align:'right',color:sale.cancelled_at?'#a52a38':blue});
  text(sale.customer_name||'Cliente não identificado',left+12,y+27,width-24,{size:10,height:13});
  text(issued+'  |  Vencimento '+date(sale.due_date),left+12,y+43,width-24,{size:9,color:muted});
  text('Itens '+quantity(units(sale))+'  |  Venda '+money(sale.total_cents)+'  |  Recebido '+money(sale.paid_cents)+'  |  Saldo '+money(sale.outstanding_cents),left+12,y+58,width-24,{size:9,bold:true});
  y+=85;
 }
 detailPage();
 if(!data.sales.length)text('Nenhuma venda no período selecionado.',left,y,width,{color:muted});
 for(const sale of data.sales){
  if(y+110>754)detailPage();
  saleHeader(sale);
  for(const item of sale.items||[]){
   const nameWidth=width-90;
   const height=Math.max(18,doc.font('Helvetica').fontSize(9).heightOfString(item.name,{width:nameWidth})+7);
   if(y+height>754){detailPage();saleHeader(sale,true);}
   text(item.name,left+12,y,nameWidth,{size:9});
   text(quantity(Number(item.quantity)),right-65,y,53,{size:9,align:'right'});
   y+=height;
  }
  y+=12;
 }
 const pages=doc.bufferedPageRange();
 for(let page=0;page<pages.count;page++){
  doc.switchToPage(pages.start+page);
  rule(778);
  text('Bansir  /  Demonstrativo sem valor fiscal',left,789,width-90,{size:8,color:muted});
  text('Página '+(page+1)+' de '+pages.count,right-80,789,80,{size:8,color:muted,align:'right'});
 }
 doc.end();
 return output;
}
