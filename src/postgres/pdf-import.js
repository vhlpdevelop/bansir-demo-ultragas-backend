import {httpError} from './database.js';
export {readPdfTable} from './pdf-reader.js';

export const pdfLine=line=>line.items.map(i=>i.text).join('\t');
export const pdfCell=(line,start,end)=>line.items.filter(i=>i.x>=start&&i.x<end).map(i=>i.text).join(' ').trim();
export const fold=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

export function customerReportRows(pages,normalizePhone){
 const first=pages[0];const header=first?.lines.find(l=>l.items.some(i=>fold(i.text).trim()==='nome')&&l.items.some(i=>fold(i.text).trim()==='celular'));
 if(!header)return null;
 const pos=label=>header.items.find(i=>fold(i.text).trim()===label)?.x;
 const starts=[pos('nome'),pos('telefone'),pos('celular'),pos('ultimo pedido')??header.items.find(i=>fold(i.text).startsWith('ultimo'))?.x,pos('nascimento'),pos('e-mail'),pos('endereco')];
 if(starts.some(x=>!Number.isFinite(x)))throw httpError(400,'Cabeçalho de clientes incompleto. Confira o formato do relatório.','PDF_LAYOUT');
 const rows=[];
 for(const page of pages)for(const line of page.lines){
  const sourceCode=pdfCell(line,0,starts[0]-2);if(!/^\d+$/.test(sourceCode))continue;
  const values=starts.map((x,n)=>pdfCell(line,x-2,(starts[n+1]??Infinity)-2));const [name,telephone,mobile,lastOrder,birthDate,email,address]=values;
  if(!name)continue;
  const issues=[];const normalize=(value,label)=>{if(!value)return '';try{return normalizePhone(value);}catch{issues.push(`${label} inválido ou antigo: confira o original.`);return '';}};
  const cell=normalize(mobile,'Celular'),tel=normalize(telephone,'Telefone'),phone=cell||tel;
  if(!phone)issues.push('Sem telefone válido; cadastro será preservado pelo código de origem.');
  if(!address||/^\d+[a-z\s]*$/i.test(address))issues.push('Endereço incompleto no arquivo de origem.');
  rows.push({sourceCode,name,phone,document:'',address,sourceMetadata:{telephone,mobile,lastOrder,birthDate,email,page:page.number},sourceLine:pdfLine(line).slice(0,1500),issues,selected:sourceCode!=='999999'});
 }
 if(rows.length>8000)throw httpError(400,'O relatório deve ter até 8000 clientes.','PDF_TOO_LARGE');
 const grouped=new Map(),unique=[];
 const signature=r=>JSON.stringify([r.name,r.phone,r.document,r.address,r.sourceMetadata.telephone,r.sourceMetadata.mobile,r.sourceMetadata.lastOrder,r.sourceMetadata.birthDate,r.sourceMetadata.email]);
 for(const row of rows){
  const same=grouped.get(row.sourceCode)?.find(r=>signature(r)===signature(row));
  if(same){same.sourceMetadata.occurrences++;if(!same.sourceMetadata.pages.includes(row.sourceMetadata.page))same.sourceMetadata.pages.push(row.sourceMetadata.page);continue;}
  row.sourceMetadata={...row.sourceMetadata,occurrences:1,pages:[row.sourceMetadata.page]};
  if(!grouped.has(row.sourceCode))grouped.set(row.sourceCode,[]);grouped.get(row.sourceCode).push(row);unique.push(row);
 }
 const counts=new Map();for(const r of unique)if(r.phone)counts.set(r.phone,(counts.get(r.phone)||0)+1);
 for(const r of unique){
  if(r.phone&&counts.get(r.phone)>1){r.issues.push('Telefone repetido no PDF: selecione apenas um cadastro por telefone ou corrija-o.');r.selected=false;}
  if(grouped.get(r.sourceCode).length>1){r.issues.push('Mesmo código com dados diferentes: confira a origem e selecione apenas um.');r.selected=false;}
 }
 return unique;
}

export function productReportRows(pages){
 const header=pages[0]?.lines.find(l=>l.items.some(i=>fold(i.text).trim()==='atalho')&&l.items.some(i=>fold(i.text).includes('estoque')));
 if(!header)throw httpError(400,'Use a Relação de produtos com Código, Atalho, Produto, Custo, Preço, Estoque e Vazios.','PDF_LAYOUT');
 const x=label=>header.items.find(i=>fold(i.text).includes(label))?.x;
 const bounds=[x('atalho'),x('produto'),x('categoria'),x('setor'),x('(r$)'),x('r$ preco')??x('r$ preço')??x('preco'),x('estoque'),x('vazios')];
 if(bounds.some(v=>!Number.isFinite(v)))throw httpError(400,'Colunas de produtos não reconhecidas.','PDF_LAYOUT');
 const number=value=>{if(!/^-?(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{1,2})?$/.test(value))return null;return Number(value.replaceAll('.','').replace(',','.'));};
 const rows=[];
 for(const page of pages)for(const line of page.lines){
  const code=pdfCell(line,0,bounds[0]-3);if(!/^\d+$/.test(code))continue;
  // Numeric cells in this report are right aligned, starting slightly before their headings.
  const shortcut=pdfCell(line,bounds[0]-3,bounds[1]-3),name=pdfCell(line,bounds[1]-3,bounds[2]-3),category=pdfCell(line,bounds[2]-3,bounds[3]-3),sector=pdfCell(line,bounds[3]-3,bounds[4]-3);
  const cost=number(pdfCell(line,bounds[4]-3,bounds[5]-3)),price=number(pdfCell(line,bounds[5]-3,bounds[6]-20)),sourceStock=number(pdfCell(line,bounds[6]-20,bounds[7]-8)),empties=number(pdfCell(line,bounds[7]-8,Infinity));
  const issues=[];if(!name)issues.push('Confira o nome, possivelmente cortado pelo relatório.');if(price===null||price<=0)issues.push('Informe preço de venda maior que zero.');if(cost===null||cost<0)issues.push('Confira o custo.');if(sourceStock===null||sourceStock<0)issues.push('Saldo original inválido ou negativo; informe a contagem física antes de selecionar.');if(shortcut.length>10)issues.push('Atalho extenso pode sobrepor o nome: confira a origem.');
  rows.push({sourceCode:code,name,barcode:`LEGACY-${code}`,sku:shortcut,category,price:price??0,costPrice:cost??0,stock:sourceStock===null||sourceStock<0?'':sourceStock,sourceStock,empties,sector,unit:'UN',ncm:'',sourceLine:pdfLine(line).slice(0,1500),issues,selected:issues.length===0});
 }
 if(rows.length>1000)throw httpError(400,'O relatório deve ter até 1000 produtos.','PDF_TOO_LARGE');
 return rows;
}
