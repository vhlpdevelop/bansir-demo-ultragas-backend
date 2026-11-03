import {receiptCustomerAddress} from './customer-fiscal.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import QRCode from 'qrcode';
import {grantPrint} from './qz-signing.js';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import PDFDocument from 'pdfkit';
import {z} from 'zod';
import {httpError} from './database.js';
import {saleView,ownedSale} from './sales.js';
const widthOf=req=>z.coerce.number().refine(n=>[58,80].includes(n)).default(80).parse(req.query.width);
export async function danfePdf(doc,width=80){
 if(!['authorized','cancelled'].includes(doc.status)||!doc.xml)throw httpError(409,'Documento fiscal autorizado ainda não disponível.','XML_NOT_AVAILABLE');
 if(Buffer.byteLength(doc.xml)>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(doc.xml)||XMLValidator.validate(doc.xml)!==true)throw httpError(409,'XML fiscal inválido.','INVALID_FISCAL_XML');
 const root=new XMLParser({removeNSPrefix:true,ignoreAttributes:false,parseTagValue:false}).parse(doc.xml).nfeProc;
 const n=root?.NFe?.infNFe,p=root?.protNFe?.infProt,model=doc.access_key.slice(20,22);
 if(n?.['@_Id']!=='NFe'+doc.access_key||!['55','65'].includes(model)||String(n?.ide?.mod)!==model||String(p?.chNFe)!==doc.access_key||Number(p?.tpAmb)!==doc.environment||Number(n?.ide?.tpAmb)!==doc.environment||!['100','150'].includes(String(p?.cStat))||!p?.nProt||(model==='65'&&!root?.NFe?.infNFeSupl?.qrCode))throw httpError(409,'XML sem autorização ou QR Code correspondente. Consulte a situação fiscal.','INVALID_FISCAL_EVIDENCE');
 if(model==='55'){
  const directory=await mkdtemp(join(tmpdir(),'bansir-danfe-'));
  try{const {NFeGerarDanfe}=await import('@nfewizard/danfe');const outputPath=join(directory,'danfe.pdf');
   // The standard A4 renderer consumes only the already validated authorized XML.
   const data=structuredClone(root);for(const who of ['emit','dest'])if(data.NFe.infNFe[who])data.NFe.infNFe[who].CNPJCPF=data.NFe.infNFe[who].CNPJ||data.NFe.infNFe[who].CPF;
   // The renderer formats dates in the server timezone. Preserve each XML clock value for display only.
   for(const [object,fields] of [[data.NFe.infNFe.ide,['dhEmi','dhSaiEnt']],[data.protNFe.infProt,['dhRecbto']]])for(const field of fields)if(object[field])object[field]=object[field].replace(/(Z|[+-]\d{2}:\d{2})$/,'');
   const renderer=new NFeGerarDanfe({data,chave:doc.access_key,outputPath}),chunks=[];
   if(doc.status==='cancelled'){const header=renderer.drawHeader.bind(renderer);renderer.drawHeader=(...args)=>{header(...args);const x=renderer.doc.x,y=renderer.doc.y;renderer.doc.save().fontSize(42).fillColor('#d9a6a6').text('CANCELADA',160,420,{lineBreak:false});renderer.doc.restore();renderer.doc.x=x;renderer.doc.y=y;};}
   // The SDK resolves generatePDF before its file is flushed. Await the PDF stream instead.
   const result=new Promise((resolve,reject)=>{renderer.doc.on('data',chunk=>chunks.push(chunk));renderer.doc.once('end',()=>resolve(Buffer.concat(chunks)));renderer.doc.once('error',reject);});
   await renderer.generatePDF(false);return await result;
  }finally{await rm(directory,{recursive:true,force:true});}
 }
 const list=v=>v==null?[]:Array.isArray(v)?v:[v],items=list(n.det),w=width*72/25.4;
 const pdf=new PDFDocument({size:[w,Math.max(800,650+items.reduce((sum,i)=>sum+50+String(i.prod?.xProd||'').length*2,0))],margins:{left:10,right:10,top:10,bottom:10}}),chunks=[];
 const result=new Promise((resolve,reject)=>{pdf.on('data',b=>chunks.push(b));pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);});
 const line=(value,center=false)=>pdf.fontSize(width===58?8:9).text(String(value??''),{align:center?'center':'left'}),money=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
 line(n.emit.xNome,true);line('CNPJ: '+n.emit.CNPJ+'  IE: '+n.emit.IE,true);const a=n.emit.enderEmit;line([a.xLgr,a.nro,a.xBairro,a.xMun,a.UF].filter(Boolean).join(', '),true);
 pdf.moveDown();line('DANFE NFC-e',true);line('Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica',true);
 if(doc.status==='cancelled'){pdf.fillColor('#b91c1c');line('DOCUMENTO CANCELADO - SEM VALIDADE FISCAL',true);pdf.fillColor('black');}
 if(doc.environment===2)line('EMITIDA EM HOMOLOGAÇÃO - SEM VALOR FISCAL',true);
 pdf.moveDown();for(const i of items){const x=i.prod;line(x.cProd+' - '+x.xProd);line(x.qCom+' '+x.uCom+' x R$ '+money(x.vUnCom)+' = R$ '+money(Number(x.vProd)-Number(x.vDesc||0)));}
 const t=n.total.ICMSTot;pdf.moveDown();line('Qtd. total de itens: '+items.length);line('Valor dos produtos R$ '+money(t.vProd));line('Desconto R$ '+money(t.vDesc));line('Frete R$ '+money(t.vFrete));line('Outros R$ '+money(t.vOutro));line('VALOR A PAGAR R$ '+money(t.vNF));
 const methods={'01':'Dinheiro','03':'Cartão de crédito','04':'Cartão de débito','17':'PIX','99':'Outros'};for(const pay of list(n.pag?.detPag))line((methods[pay.tPag]||'Pagamento '+pay.tPag)+' R$ '+money(pay.vPag));if(n.pag?.vTroco)line('Troco R$ '+money(n.pag.vTroco));
 pdf.moveDown();line(n.dest?'Consumidor: '+[n.dest.xNome,n.dest.CPF||n.dest.CNPJ].filter(Boolean).join(' - '):'CONSUMIDOR NÃO IDENTIFICADO');line('NFC-e '+n.ide.nNF+'  Série '+n.ide.serie);line('Emissão: '+n.ide.dhEmi);line('Protocolo: '+p.nProt);line('Autorização: '+p.dhRecbto);line('Chave de acesso:',true);line(doc.access_key.match(/.{1,4}/g).join(' '),true);line('Consulte pela chave em:',true);line(root.NFe.infNFeSupl.urlChave,true);pdf.moveDown();
 const image=await QRCode.toBuffer(root.NFe.infNFeSupl.qrCode,{width:280,margin:2,errorCorrectionLevel:'M'}),qrWidth=Math.min(110,w-20);const qrY=pdf.y;pdf.image(image,(w-qrWidth)/2,qrY,{width:qrWidth});pdf.y=qrY+qrWidth+8;if(t.vTotTrib)line('Tributos totais R$ '+money(t.vTotTrib));if(n.infAdic?.infCpl)line(n.infAdic.infCpl);pdf.page.dictionary.data.MediaBox=[0,Math.max(0,pdf.page.height-pdf.y-18),w,pdf.page.height];pdf.end();return result;
}
export async function receiptPdf(sale,store,width=80){
 const w=width*72/25.4,margin=12,inner=w-margin*2,font=width===58?7.5:8.5,chars=Math.floor(inner/(font*.6));
 const address=receiptCustomerAddress(sale),notes=sale.customer_details?.notes||sale.receipt_customer_notes||'',district=sale.customer_details?.fiscal?.enderDest?.xBairro||sale.customer_district||'';
 const textLines=v=>String(v||'').split('\n').reduce((n,l)=>n+Math.max(1,Math.ceil(l.length/chars)),0);
 const height=Math.max(700,600+sale.items.reduce((n,i)=>n+35+textLines(i.product_name)*12,0)+sale.payments.length*22+[notes,address,store.address,store.store_name,sale.customer_name].reduce((n,v)=>n+textLines(v)*12,0));
 const doc=new PDFDocument({size:[w,height],margins:{top:12,left:margin,right:margin,bottom:12}}),chunks=[];
 const result=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const money=v=>(Number(v||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
 const line=(text,align='left',size=font,bold=false)=>{doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).text(String(text??''),margin,doc.y,{width:inner,align,lineGap:2});};
 const rule=()=>{doc.moveDown(.35);const y=doc.y;doc.save().lineWidth(.5).dash(2,{space:2}).moveTo(margin,y).lineTo(w-margin,y).stroke().restore();doc.y=y+7;};
 const pair=(label,value,size=font,bold=false)=>{doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);const valueWidth=Math.max(inner*.35,doc.widthOfString(value)+2),leftWidth=inner-valueWidth-4,y=doc.y;doc.text(label,margin,y,{width:leftWidth,lineGap:2});const labelEnd=doc.y;doc.text(value,margin+inner-valueWidth,y,{width:valueWidth,align:'right',lineGap:2});doc.y=Math.max(labelEnd,doc.y)+2;};
 const cnpj=String(store.document_id||'').replace(/\D/g,'');
 line(store.store_name||'Estabelecimento','center',width===58?10.5:12.5,true);
 line('CNPJ: '+(cnpj.length===14?cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):store.document_id||'Não informado'),'center');
 if(store.contact)line('Contato: '+store.contact,'center');if(store.address)line(store.address,'center');rule();
 const stamp=new Date(sale.created_at).toLocaleString('pt-BR',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
 if(width===80&&sale.saleNumber.length<=6){pair('Cupom: '+sale.saleNumber,'Data: '+stamp,font,true);}else{line('Cupom: '+sale.saleNumber,'left',13.5,true);line('Data: '+stamp);}rule();
 if(sale.revision>0)line('Revisão administrativa: '+sale.revision);
 line('Cliente....: '+(sale.customer_name||'Consumidor não identificado'));line('Endereço...: '+(address||'Não informado'));line('Bairro.....: '+(district||'Não informado'));line('Telefone...: '+(sale.customer_phone||'Não informado'));rule();
 if(sale.agreement){line('Convênio: '+sale.agreement.snapshot.name);line('Responsável: '+sale.agreement.snapshot.payerName);line('Vencimento: '+sale.agreement.due_date.split('-').reverse().join('/'));line(sale.outstanding_cents>0?'PAGAMENTO POR CONVENIO - A RECEBER':'PAGAMENTO POR CONVENIO - QUITADO');rule();}
 line('*** Observações do cliente ***','center',font,true);rule();line(notes||'Sem observações.');rule();
 const qtyWidth=inner*.23,priceWidth=inner*.25,subWidth=inner*.29,qtyX=margin+inner-qtyWidth-priceWidth-subWidth,priceX=qtyX+qtyWidth,subX=priceX+priceWidth;
 const tableRow=(left,qty,price,total,bold=false)=>{doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(font);const y=doc.y;let bottom=y;doc.text(left,margin,y,{width:qtyX-margin-3});bottom=Math.max(bottom,doc.y);doc.text(qty,qtyX,y,{width:qtyWidth-3,align:'right'});bottom=Math.max(bottom,doc.y);doc.text(price,priceX,y,{width:priceWidth-3,align:'right'});bottom=Math.max(bottom,doc.y);doc.text(total,subX,y,{width:subWidth,align:'right'});doc.y=Math.max(bottom,doc.y)+4;};
 tableRow(width===58?'Prod.':'Produto','Qt','Preço','Subtotal',true);rule();
 for(const item of sale.items){line(item.product_name);tableRow('........',Number(item.quantity).toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3}),money(item.unit_price_cents),money(item.gross_cents));doc.y+=3;}
 rule();pair('(+) Subtotal',money(sale.subtotal_cents));pair('(+) Taxa entrega',money(sale.delivery_fee_cents));pair('(-) Desconto',money(sale.discount_cents));pair('(=) TOTAL',money(sale.total_cents),width===58?12.5:15.5,true);rule();
 const labels={cash:'Dinheiro',pix:'PIX',credit_card:'Cartão de crédito',debit_card:'Cartão de débito'},totals={};
 let received=0,change=0;for(const p of sale.payments){const amount=Number(p.amount_cents),cashReceived=Number(p.received_cents??amount);totals[p.method]=(totals[p.method]||0)+amount;received+=p.method==='cash'?cashReceived:amount;if(p.method==='cash')change+=cashReceived-amount;}
 for(const [method,value]of Object.entries(totals))pair('(=) '+(labels[method]||method),money(value));
 pair('(=) Total recebido',money(received),font,true);pair('(=) Troco',money(change));rule();
 pair('Saldo devedor:','R$ '+money(sale.outstanding_cents),font,true);rule();
 if(sale.cancelled_at){line('VENDA CANCELADA','center',font+1,true);line(sale.cancellation_reason||'');rule();}
 line('Que nosso dia seja abençoado.','center',font,true);doc.moveDown(.5);line('RECIBO DE VENDA - SEM VALOR FISCAL','center',width===58?6:7);line('Não substitui documento fiscal autorizado.','center',width===58?6:7);
 doc.page.dictionary.data.MediaBox=[0,Math.max(0,doc.page.height-doc.y-14),w,doc.page.height];doc.end();return result;
}
export async function printerTestPdf(width=80){
 const doc=new PDFDocument({size:[width*72/25.4,90*72/25.4],margin:12});const chunks=[];
 const output=new Promise((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 doc.fontSize(13).text('BANSIR',{align:'center'}).moveDown().fontSize(10).text('TESTE DE IMPRESSAO',{align:'center'}).moveDown();
 doc.fontSize(9).text(`Papel: ${width} mm`).text('0123456789').text('ABCDEFGHIJKLMNOPQRSTUVWXYZ').moveDown().text('Se este texto esta legivel, o envio pelo Bansir e QZ Tray funcionou.').moveDown().text('SEM VALOR FISCAL',{align:'center'});doc.end();return output;
}
export function mountPrinting(app,{scoped}){
 app.get('/api/v1/printing/test',scoped('sales',true,async(_c,req)=>{const pdf=await printerTestPdf(widthOf(req));grantPrint(req.identity,pdf);return {data:{base64:pdf.toString('base64'),filename:'bansir-teste-impressora.pdf'}};}));
 app.get('/api/v1/sales/:id/receipt',scoped('sales',true,async(c,req,member)=>{const id=z.uuid().parse(req.params.id);await ownedSale(c,req.identity,member,id);const sale=await saleView(c,id);if(sale.customer_id){const customer=(await c.query('SELECT address,notes FROM bansir.customers WHERE id=$1',[sale.customer_id])).rows[0];sale.receipt_customer_address=customer?.address||'';sale.receipt_customer_notes=customer?.notes||'';}const store=(await c.query('SELECT store_name,document_id,address,contact FROM bansir.store_settings')).rows[0]||{};const pdf=await receiptPdf(sale,store,widthOf(req));grantPrint(req.identity,pdf);return {data:{base64:pdf.toString('base64'),filename:'recibo-'+sale.saleNumber+'.pdf'}};}));
 app.get('/api/v1/fiscal/documents/:id/danfe',scoped('fiscal',true,async(c,req)=>{const doc=(await c.query('SELECT status,xml,access_key,environment FROM bansir.fiscal_documents WHERE id=$1',[z.uuid().parse(req.params.id)])).rows[0];if(!doc)throw httpError(404,'Documento não encontrado.','NOT_FOUND');const pdf=await danfePdf(doc,widthOf(req));grantPrint(req.identity,pdf);return {data:{base64:pdf.toString('base64'),filename:(doc.access_key.slice(20,22)==='55'?'nfe-':'nfce-')+doc.access_key+'.pdf'}};}));
}
