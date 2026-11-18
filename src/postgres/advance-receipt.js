import PDFDocument from 'pdfkit';

const units=['','um','dois','três','quatro','cinco','seis','sete','oito','nove'];
const teens=['dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
const tens=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];
const hundreds=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
function words(n){
 if(n===100)return 'cem';
 for(const [size,label] of [[1000000,'milhão'],[1000,'mil']]){
  if(n<size)continue;
  const q=Math.floor(n/size),r=n%size;
  const head=size===1000&&q===1?'mil':words(q)+' '+(size===1000000&&q>1?'milhões':label);
  return head+(r?(r<100||r%100===0?' e ':' ')+words(r):'');
 }
 const r=n%100;
 return [hundreds[Math.floor(n/100)],r>=10&&r<20?teens[r-10]:[tens[Math.floor(r/10)],units[r%10]].filter(Boolean).join(' e ')].filter(Boolean).join(' e ');
}
export function amountWords(cents){
 const reais=Math.floor(cents/100),rest=cents%100;
 return [reais?(words(reais)+(reais%1000000===0?' de':'')+(reais===1?' real':' reais')):'',rest?words(rest)+(rest===1?' centavo':' centavos'):''].filter(Boolean).join(' e ')||'zero reais';
}
export function advanceReceiptPdf(row,fields,width){
 if(width)return thermalReceiptPdf(row,fields,width);
 const doc=new PDFDocument({size:'A4',margin:54}), chunks=[];
 const result=new Promise((resolve,reject)=>{
  doc.on('data',chunk=>chunks.push(chunk));
  doc.once('end',()=>resolve(Buffer.concat(chunks)));
  doc.once('error',reject);
 });
 const money=Number(row.amount_cents)/100;
 const line=(label,value)=>doc.font('Helvetica').fontSize(11).fillColor('#17263b').text(label+' '+value,{lineGap:4});
 doc.rect(0,0,595,130).fill('#102542');
 doc.fillColor('#eac172').font('Helvetica-Bold').fontSize(11).text('DOCUMENTO PARA ASSINATURA',54,39);
 doc.fillColor('white').fontSize(24).text('Recibo de adiantamento / vale',54,65);
 doc.y=155;
 line('Empregador:',row.legal_name);
 line('CNPJ:',row.document_id);
 doc.moveDown();
 line('Funcionário:',row.employee_name);
 line('CPF:',fields.cpf);
 line('Cargo:',row.role_title);
 if(fields.registration)line('Matrícula:',fields.registration);
 doc.moveDown();
 doc.font('Helvetica-Bold').fontSize(25).fillColor('#102542').text(money.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
 line('Por extenso:',amountWords(Number(row.amount_cents)));
 doc.moveDown();
 line('Natureza:',fields.nature);
 if(fields.method)line('Forma de entrega:',fields.method);
 if(fields.period)line('Competência da folha:',fields.period.split('-').reverse().join('/'));
 doc.moveDown();
 line('Declaro que recebi do empregador acima identificado o valor indicado neste recibo, referente à natureza descrita.', '');
 doc.moveDown();
 line('Local e data:',fields.location+', '+fields.date.split('-').reverse().join('/'));
 doc.moveDown(3);
 doc.moveTo(54,doc.y).lineTo(350,doc.y).strokeColor('#748399').stroke();
 doc.moveDown(.5);
 line('Assinatura do empregado', '');
 line('',row.employee_name);
 doc.end();
 return result;
}

function thermalReceiptPdf(row,fields,width){
 const pageWidth=width*72/25.4;
 const margin=10, inner=pageWidth-margin*2;
 const doc=new PDFDocument({size:[pageWidth,2400],margin}),chunks=[];
 const result=new Promise((resolve,reject)=>{
  doc.on('data',chunk=>chunks.push(chunk));
  doc.once('end',()=>resolve(Buffer.concat(chunks)));
  doc.once('error',reject);
 });
 const line=(value,{bold=false,size=9,align='left'}={})=>{
  doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size).text(value,margin,doc.y,{width:inner,align,lineGap:2});
 };
 const divider=()=>{
  const y=doc.y+5;
  doc.moveTo(margin,y).lineTo(pageWidth-margin,y).lineWidth(.5).stroke();
  doc.y=y+7;
 };
 line('RECIBO DE VALE',{bold:true,size:13,align:'center'});
 divider();
 line(row.legal_name,{bold:true});
 line('CNPJ: '+row.document_id);
 divider();
 line(row.employee_name,{bold:true});
 line('CPF: '+fields.cpf);
 line('Cargo: '+row.role_title);
 if(fields.registration)line('Matrícula: '+fields.registration);
 divider();
 line((Number(row.amount_cents)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),{bold:true,size:15});
 line(amountWords(Number(row.amount_cents)));
 divider();
 line('Natureza: '+fields.nature);
 if(fields.method)line('Forma de entrega: '+fields.method);
 if(fields.period)line('Competência da folha: '+fields.period.split('-').reverse().join('/'));
 doc.moveDown();
 line('Declaro que recebi do empregador identificado acima o valor indicado, referente à natureza descrita.');
 doc.moveDown();
 line(fields.location+', '+fields.date.split('-').reverse().join('/'));
 doc.y+=48;
 divider();
 line('Assinatura do funcionário',{align:'center'});
 line(row.employee_name,{align:'center'});
 doc.page.dictionary.data.MediaBox=[0,doc.page.height-doc.y-14,pageWidth,doc.page.height];
 doc.end();
 return result;
}
