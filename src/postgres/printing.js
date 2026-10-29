import QRCode from 'qrcode';
import {grantPrint} from './qz-signing.js';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import PDFDocument from 'pdfkit';
import {z} from 'zod';
import {httpError} from './database.js';
import {saleView,ownedSale} from './sales.js';
const widthOf=req=>z.coerce.number().refine(n=>[58,80].includes(n)).default(80).parse(req.query.width);
export async function danfePdf(doc,width=80){
 if(doc.status!=='authorized'||!doc.xml)throw httpError(409,'NFC-e autorizada ainda não disponível.','XML_NOT_AVAILABLE');
 if(Buffer.byteLength(doc.xml)>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(doc.xml)||XMLValidator.validate(doc.xml)!==true)throw httpError(409,'XML fiscal inválido.','INVALID_FISCAL_XML');
 const root=new XMLParser({removeNSPrefix:true,ignoreAttributes:false,parseTagValue:false}).parse(doc.xml).nfeProc;
 const n=root?.NFe?.infNFe,p=root?.protNFe?.infProt;
 if(n?.['@_Id']!=='NFe'+doc.access_key||String(n?.ide?.mod)!=='65'||String(p?.chNFe)!==doc.access_key||Number(p?.tpAmb)!==doc.environment||Number(n?.ide?.tpAmb)!==doc.environment||!['100','150'].includes(String(p?.cStat))||!p?.nProt||!root?.NFe?.infNFeSupl?.qrCode)throw httpError(409,'XML sem autorização ou QR Code correspondente. Consulte a situação fiscal.','INVALID_FISCAL_EVIDENCE');
 const list=v=>v==null?[]:Array.isArray(v)?v:[v],items=list(n.det),w=width*72/25.4;
 const pdf=new PDFDocument({size:[w,Math.max(800,650+items.reduce((sum,i)=>sum+50+String(i.prod?.xProd||'').length*2,0))],margins:{left:10,right:10,top:10,bottom:10}}),chunks=[];
 const result=new Promise((resolve,reject)=>{pdf.on('data',b=>chunks.push(b));pdf.on('end',()=>resolve(Buffer.concat(chunks)));pdf.on('error',reject);});
 const line=(value,center=false)=>pdf.fontSize(width===58?8:9).text(String(value??''),{align:center?'center':'left'}),money=v=>Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
 line(n.emit.xNome,true);line('CNPJ: '+n.emit.CNPJ+'  IE: '+n.emit.IE,true);const a=n.emit.enderEmit;line([a.xLgr,a.nro,a.xBairro,a.xMun,a.UF].filter(Boolean).join(', '),true);
 pdf.moveDown();line('DANFE NFC-e',true);line('Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica',true);
 if(doc.environment===2)line('EMITIDA EM HOMOLOGAÇÃO - SEM VALOR FISCAL',true);
 pdf.moveDown();for(const i of items){const x=i.prod;line(x.cProd+' - '+x.xProd);line(x.qCom+' '+x.uCom+' x R$ '+money(x.vUnCom)+' = R$ '+money(Number(x.vProd)-Number(x.vDesc||0)));}
 const t=n.total.ICMSTot;pdf.moveDown();line('Qtd. total de itens: '+items.length);line('Valor dos produtos R$ '+money(t.vProd));line('Desconto R$ '+money(t.vDesc));line('Frete R$ '+money(t.vFrete));line('Outros R$ '+money(t.vOutro));line('VALOR A PAGAR R$ '+money(t.vNF));
 const methods={'01':'Dinheiro','03':'Cartão de crédito','04':'Cartão de débito','17':'PIX','99':'Outros'};for(const pay of list(n.pag?.detPag))line((methods[pay.tPag]||'Pagamento '+pay.tPag)+' R$ '+money(pay.vPag));if(n.pag?.vTroco)line('Troco R$ '+money(n.pag.vTroco));
 pdf.moveDown();line(n.dest?'Consumidor: '+[n.dest.xNome,n.dest.CPF||n.dest.CNPJ].filter(Boolean).join(' - '):'CONSUMIDOR NÃO IDENTIFICADO');line('NFC-e '+n.ide.nNF+'  Série '+n.ide.serie);line('Emissão: '+n.ide.dhEmi);line('Protocolo: '+p.nProt);line('Autorização: '+p.dhRecbto);line('Chave de acesso:',true);line(doc.access_key.match(/.{1,4}/g).join(' '),true);line('Consulte pela chave em:',true);line(root.NFe.infNFeSupl.urlChave,true);pdf.moveDown();
 const image=await QRCode.toBuffer(root.NFe.infNFeSupl.qrCode,{width:280,margin:2,errorCorrectionLevel:'M'}),qrWidth=Math.min(110,w-20);const qrY=pdf.y;pdf.image(image,(w-qrWidth)/2,qrY,{width:qrWidth});pdf.y=qrY+qrWidth+8;if(t.vTotTrib)line('Tributos totais R$ '+money(t.vTotTrib));if(n.infAdic?.infCpl)line(n.infAdic.infCpl);pdf.page.dictionary.data.MediaBox=[0,Math.max(0,pdf.page.height-pdf.y-18),w,pdf.page.height];pdf.end();return result;
}
export async function receiptPdf(sale,store,width=80){
 const doc=new PDFDocument({size:[width*72/25.4,Math.max(600,480+sale.items.length*60+sale.payments.length*30)],margins:{top:12,left:10,right:10,bottom:12}}),chunks=[];
 const result=new Promise((resolve,reject)=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const money=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),line=s=>doc.fontSize(9).text(String(s??''));
 doc.fontSize(12).text(store.store_name||'Estabelecimento',{align:'center'});line(store.document_id);line(store.address);doc.moveDown();line('RECIBO DE VENDA - SEM VALOR FISCAL');line(sale.saleNumber);line(new Date(sale.created_at).toLocaleString('pt-BR',{timeZone:'America/Cuiaba'}));line('Operador: '+sale.seller_name);line('Terminal: '+(sale.terminal_name||'Não identificado (registro anterior)'));line('Cliente: '+(sale.customer_name||'Não identificado'));
 if(sale.delivery_employee_name)line('Entregador: '+sale.delivery_employee_name);if(sale.delivery_address)line(sale.delivery_address);doc.moveDown();
 for(const i of sale.items){line(i.quantity+' x '+i.product_name);line(money(i.unit_price_cents)+' / un.   '+money(i.gross_cents-i.discount_cents));doc.moveDown(.4);}
 line('Desconto: '+money(sale.discount_cents));line('Entrega: '+money(sale.delivery_fee_cents));doc.fontSize(12).text('TOTAL: '+money(sale.total_cents));line('Situação: '+({paid:'Pago',pending:'A receber',cancelled:'Cancelado'}[sale.status]||sale.status));
 const methods={cash:'Dinheiro',pix:'PIX',credit_card:'Crédito externo',debit_card:'Débito externo'};
 for(const p of sale.payments){line((methods[p.method]||p.method)+': '+money(p.amount_cents));if(p.method==='cash')line('Troco: '+money(p.received_cents-p.amount_cents));}
 line('Recebido: '+money(sale.paid_cents));line('Saldo: '+money(sale.outstanding_cents));if(sale.cancelled_at)line('VENDA CANCELADA: '+sale.cancellation_reason);doc.moveDown();line('Não substitui documento fiscal autorizado.');doc.page.dictionary.data.MediaBox=[0,Math.max(0,doc.page.height-doc.y-18),doc.page.width,doc.page.height];doc.end();return result;
}
export function mountPrinting(app,{scoped}){
 app.get('/api/v1/sales/:id/receipt',scoped('sales',true,async(c,req,member)=>{const id=z.uuid().parse(req.params.id);await ownedSale(c,req.identity,member,id);const sale=await saleView(c,id),store=(await c.query('SELECT store_name,document_id,address FROM bansir.store_settings')).rows[0]||{};const pdf=await receiptPdf(sale,store,widthOf(req));grantPrint(req.identity,pdf);return {data:{base64:pdf.toString('base64'),filename:'recibo-'+sale.saleNumber+'.pdf'}};}));
 app.get('/api/v1/fiscal/documents/:id/danfe',scoped('fiscal',true,async(c,req)=>{const doc=(await c.query('SELECT status,xml,access_key,environment FROM bansir.fiscal_documents WHERE id=$1',[z.uuid().parse(req.params.id)])).rows[0];if(!doc)throw httpError(404,'Documento não encontrado.','NOT_FOUND');const pdf=await danfePdf(doc,widthOf(req));grantPrint(req.identity,pdf);return {data:{base64:pdf.toString('base64'),filename:'nfce-'+doc.access_key+'.pdf'}};}));
}
