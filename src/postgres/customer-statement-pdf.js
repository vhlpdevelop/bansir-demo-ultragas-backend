import PDFDocument from 'pdfkit';

const ink='#0f172a',navy='#102447',blue='#1e40af',muted='#64748b',line='#e2e8f0',paper='#f8fafc',gold='#e8b758',green='#166534',red='#991b1b',amber='#b45309';
const money=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const quantity=n=>Number(n||0).toLocaleString('pt-BR');
const methodNames={cash:'Dinheiro',pix:'PIX',credit_card:'Cartão de crédito',debit_card:'Cartão de débito',online:'Online',pending:'A receber'};

export async function customerStatementPdf(data,{store={},timeZone='America/Cuiaba'}={}){
 const doc=new PDFDocument({size:'A4',margin:36,bufferPages:true,info:{Title:'Extrato de compras - '+(data.customer?.name||'Cliente'),Author:'Bansir'}});
 const chunks=[];
 const output=new Promise((resolve,reject)=>{
  doc.on('data',chunk=>chunks.push(chunk));
  doc.on('end',()=>resolve(Buffer.concat(chunks)));
  doc.on('error',reject);
 });

 const left=36,width=doc.page.width-2*left,right=left+width;
 const text=(value,x,y,w,{size=10,color=ink,bold=false,align='left',height}={})=>
  doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).fillColor(color)
   .text(String(value??''),x,y,{width:w,align,height,ellipsis:height!==undefined});
 const rule=(y)=>doc.strokeColor(line).lineWidth(.7).moveTo(left,y).lineTo(right,y).stroke();

 function banner(section,title){
  doc.rect(0,0,doc.page.width,110).fill(navy);
  doc.rect(left,26,24,3).fill(gold);
  text('BANSIR  /  RELACIONAMENTO COM O CLIENTE',left,38,width,{size:9,color:gold,bold:true});
  text(title,left,56,width,{size:20,color:'#ffffff',bold:true});
  text(section,left,86,width,{size:9,color:'#dbe7ff'});
 }

 function metric(x,y,w,label,value,emphasis=false,colorScheme=null){
  let bg=paper,txtColor=ink,lblColor=muted;
  if(emphasis){bg=navy;txtColor='#ffffff';lblColor='#dbe7ff';}
  else if(colorScheme==='amber'&&Number(value)!==0){bg='#fef3c7';txtColor=amber;lblColor='#92400e';}
  else if(colorScheme==='green'){bg='#dcfce7';txtColor=green;lblColor='#15803d';}
  doc.roundedRect(x,y,w,58,6).fill(bg);
  text(label,x+10,y+10,w-20,{size:8,color:lblColor,bold:true});
  text(value,x+10,y+27,w-20,{size:15,color:txtColor,bold:true,height:22});
 }

 const customer=data.customer||{};
 const summary=data.summary||{};
 const sales=data.sales||[];
 const validSales=sales.filter(s=>s.status!=='cancelled'&&!s.cancelled_at);

 banner('01  /  RESUMO GERAL','Extrato de compras do cliente');

 // Info grid: Customer & Store
 const boxW=(width-12)/2;
 doc.roundedRect(left,125,boxW,92,6).fill(paper);
 text('DADOS DO CLIENTE',left+12,135,boxW-24,{size:8,color:muted,bold:true});
 text(customer.name||'Não identificado',left+12,148,boxW-24,{size:12,bold:true,height:16});
 text(`CPF/CNPJ: ${customer.document||'Não informado'}`,left+12,168,boxW-24,{size:9,color:ink});
 text(`Telefone: ${customer.phone||'Não informado'}`,left+12,182,boxW-24,{size:9,color:ink});
 text(`Endereço: ${customer.address||'Não informado'}`,left+12,196,boxW-24,{size:8,color:muted,height:12});

 doc.roundedRect(left+boxW+12,125,boxW,92,6).fill(paper);
 text('ESTABELECIMENTO EMISSOR',left+boxW+24,135,boxW-24,{size:8,color:muted,bold:true});
 text(store.store_name||store.name||'Bansir Gás & Água',left+boxW+24,148,boxW-24,{size:12,bold:true,height:16});
 text(`CNPJ: ${store.document_id||'Não informado'}`,left+boxW+24,168,boxW-24,{size:9,color:ink});
 text(`Localização: ${store.merchant_city||store.address||'—'}`,left+boxW+24,182,boxW-24,{size:9,color:ink});
 text(`Emissão: ${new Date().toLocaleString('pt-BR',{timeZone})}`,left+boxW+24,196,boxW-24,{size:8,color:muted});

 rule(230);

 // Metrics Row
 const gap=8,col=(width-3*gap)/4;
 metric(left,244,col,'VENDAS VÁLIDAS',quantity(summary.sales_count||validSales.length));
 metric(left+col+gap,244,col,'TOTAL COMPRADO',money(summary.total_cents||0),true);
 metric(left+2*(col+gap),244,col,'TOTAL PAGO',money(summary.paid_cents||0),false,'green');
 metric(left+3*(col+gap),244,col,'SALDO EM ABERTO',money(summary.outstanding_cents||0),false,summary.outstanding_cents>0?'amber':null);

 text('Totais financeiros consideram apenas compras ativas/concluídas. Vendas canceladas aparecem identificadas no histórico.',left,315,width,{size:8,color:muted});

 rule(332);

 let y=348;
 function detailHeader(){
  text('02  /  HISTÓRICO DETALHADO DE COMPRAS',left,y,width,{size:11,bold:true,color:navy});
  y+=22;
 }
 detailHeader();

 function checkNewPage(neededHeight=120){
  if(y+neededHeight>doc.page.height-50){
   doc.addPage();
   banner('02  /  DETALHAMENTO','Histórico de compras (continuação)');
   text(`Cliente: ${customer.name||''} · ${customer.phone||''}`,left,125,width,{size:10,bold:true,color:navy});
   rule(142);
   y=156;
  }
 }

 if(!sales.length){
  text('Nenhuma compra registrada para este cliente.',left,y,width,{size:10,color:muted});
 }

 for(const sale of sales){
  const items=sale.items||[];
  const payments=sale.payments||[];
  const isCancelled=Boolean(sale.cancelled_at||sale.status==='cancelled');
  const isPaid=!isCancelled&&sale.outstanding_cents<=0;
  const statusLabel=isCancelled?'CANCELADA':isPaid?'QUITADA / PAGA':'A RECEBER / PENDENTE';
  const statusColor=isCancelled?red:isPaid?green:amber;

  // Approximate card height
  const cardHeight=68+(items.length*16)+(payments.length?20:0)+(isCancelled?18:0);
  checkNewPage(Math.min(cardHeight,220));

  // Sale box container
  const boxTop=y;
  doc.roundedRect(left,boxTop,width,cardHeight,6).fill(paper);

  // Top line: Cupom / Venda | Status | Data
  const saleCode=sale.saleNumber||(sale.coupon_number?`#${sale.coupon_number}`:`#${String(sale.id).slice(0,8).toUpperCase()}`);
  text(`Venda ${saleCode}`,left+10,boxTop+9,200,{size:10,bold:true,color:navy});
  text(statusLabel,right-190,boxTop+9,180,{size:9,bold:true,align:'right',color:statusColor});

  const saleDate=sale.created_at?new Date(sale.created_at).toLocaleString('pt-BR',{timeZone}):'—';
  const modeText=sale.delivery_mode==='delivery'?'Entrega':'Retirada no balcão';
  const driverText=sale.delivery_employee_name?` · Entregador: ${sale.delivery_employee_name}`:'';
  text(`${saleDate} · Modalidade: ${modeText}${driverText}`,left+10,boxTop+25,width-20,{size:8,color:muted});

  if(sale.delivery_mode==='delivery'&&sale.delivery_address){
   text(`Endereço de entrega: ${sale.delivery_address}`,left+10,boxTop+38,width-20,{size:8,color:ink,height:11});
  }

  // Items listing
  let itemY=boxTop+(sale.delivery_mode==='delivery'&&sale.delivery_address?53:44);
  for(const item of items){
   const itemTotal=Number(item.gross_cents||(item.quantity*item.unit_price_cents))-Number(item.discount_cents||0);
   text(`${item.quantity}×  ${item.product_name||item.name}`,left+14,itemY,width-140,{size:8,color:ink,height:12});
   text(`Unitário: ${money(item.unit_price_cents)}   Total: ${money(itemTotal)}`,right-200,itemY,190,{size:8,bold:true,align:'right',color:ink});
   itemY+=15;
  }

  // Subtotal / Frete / Total
  const freteText=sale.delivery_fee_cents>0?`Frete: ${money(sale.delivery_fee_cents)} · `:'';
  const descText=sale.discount_cents>0?`Desconto: -${money(sale.discount_cents)} · `:'';
  text(`${freteText}${descText}Subtotal: ${money(sale.subtotal_cents)}`,left+14,itemY+3,width-200,{size:8,color:muted});
  text(`Valor da venda: ${money(sale.total_cents)}`,right-200,itemY+3,190,{size:9,bold:true,align:'right',color:navy});
  itemY+=18;

  // Payments line
  if(payments.length){
   const payText=payments.map(p=>`${money(p.amount_cents)} via ${methodNames[p.method]||p.method}`).join(' · ');
   text(`Pagamentos: ${payText} (Liquidado: ${money(sale.paid_cents||0)}${sale.outstanding_cents>0?` · Saldo: ${money(sale.outstanding_cents)}`:''})`,left+14,itemY,width-28,{size:8,color:isPaid?green:amber,bold:true});
   itemY+=16;
  }

  if(isCancelled&&sale.cancellation_reason){
   text(`Cancelamento: ${sale.cancellation_reason}`,left+14,itemY,width-28,{size:8,color:red});
   itemY+=14;
  }

  y=boxTop+cardHeight+10;
 }

 // Page numbering across all pages
 const range=doc.bufferedPageRange();
 for(let i=0;i<range.count;i++){
  doc.switchToPage(i);
  doc.fontSize(8).fillColor(muted).text(
   `Página ${i+1} de ${range.count}  ·  Documento gerado pelo sistema Bansir Gás`,
   left,
   doc.page.height-24,
   {width,align:'center'}
  );
 }

 doc.end();
 return output;
}

