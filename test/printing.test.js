import test from 'node:test';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {receiptPdf,danfePdf,printerTestPdf} from '../src/postgres/printing.js';
import {readPdfTable} from '../src/postgres/pdf-import.js';
test('thermal receipts create real PDF at both widths and reject missing fiscal evidence',async()=>{
 const sale={saleNumber:'34543',created_at:'2026-10-27T15:00:00Z',seller_name:'Operador',customer_name:'Cliente',status:'paid',subtotal_cents:15000,delivery_fee_cents:0,discount_cents:0,outstanding_cents:0,total_cents:15000,paid_cents:15000,items:Array.from({length:50},()=>({quantity:1,product_name:'Gás de teste',unit_price_cents:300,gross_cents:300,discount_cents:0})),payments:[{method:'cash',amount_cents:15000,received_cents:16000}]};
 for(const width of [58,80]){const pdf=await receiptPdf(sale,{store_name:'Loja de teste'},width);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);}
 await assert.rejects(danfePdf({status:'queued'}),e=>e.status===409);
 await assert.rejects(danfePdf({status:'authorized',xml:'<nfeProc/>',access_key:'1'.repeat(44),environment:2}),e=>e.code==='INVALID_FISCAL_EVIDENCE');
});

test('DANFE renders authorized NFC-e XML with original QR Code',async()=>{
 const key='50261011222333000181650010000000011000000011';
 const xml=`<nfeProc><NFe><infNFe Id="NFe${key}" versao="4.00"><ide><mod>65</mod><tpAmb>2</tpAmb><tpEmis>1</tpEmis><nNF>1</nNF><serie>1</serie><dhEmi>2026-10-27T10:00:00-04:00</dhEmi></ide><emit><CNPJ>11222333000181</CNPJ><xNome>LOJA TESTE HOMOLOGACAO</xNome><IE>123456789</IE><enderEmit><xLgr>Rua Teste</xLgr><nro>10</nro><xBairro>Centro</xBairro><xMun>Cuiaba</xMun><UF>MT</UF></enderEmit></emit><det nItem="1"><prod><cProd>1</cProd><xProd>NOTA SEM VALOR FISCAL</xProd><qCom>1</qCom><uCom>UN</uCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF><vProd>10.00</vProd></ICMSTot></total><transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>10.00</vPag></detPag><vTroco>0</vTroco></pag></infNFe><infNFeSupl><qrCode><![CDATA[https://example.invalid/nfce?p=${key}|2|2|1|TEST]]></qrCode><urlChave>https://example.invalid/nfce</urlChave></infNFeSupl></NFe><protNFe><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><nProt>150260000000001</nProt><dhRecbto>2026-10-27T10:00:01-04:00</dhRecbto><cStat>100</cStat></infProt></protNFe></nfeProc>`;
 const cancelled=await danfePdf({status:'cancelled',xml,access_key:key,environment:2});assert.equal(cancelled.subarray(0,5).toString(),'%PDF-');
 for(const width of [58,80]){const pdf=await danfePdf({status:'authorized',xml,access_key:key,environment:2},width);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');if(process.env.PRINT_PREVIEW)await writeFile('migration-private/danfe-test-'+width+'.pdf',pdf);}
});

// The DANFE SDK depends on native libxmljs2 supplied by our Linux image.
test('NF-e 55 renders a complete A4 PDF without a NFC-e QR Code',{skip:process.platform==='win32'},async()=>{
 const key='50261011222333000181550010000000011000000011';
 const source=`<nfeProc><NFe><infNFe Id="NFe${key}" versao="4.00"><ide><mod>65</mod><tpAmb>2</tpAmb><tpEmis>1</tpEmis><nNF>1</nNF><serie>1</serie><dhEmi>2026-10-27T10:00:00-04:00</dhEmi></ide><emit><CNPJ>11222333000181</CNPJ><xNome>LOJA TESTE HOMOLOGACAO</xNome><IE>123456789</IE><enderEmit><xLgr>Rua Teste</xLgr><nro>10</nro><xBairro>Centro</xBairro><xMun>Cuiaba</xMun><UF>MT</UF></enderEmit></emit><det nItem="1"><prod><cProd>1</cProd><xProd>NOTA SEM VALOR FISCAL</xProd><qCom>1</qCom><uCom>UN</uCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF><vProd>10.00</vProd></ICMSTot></total><transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>10.00</vPag></detPag><vTroco>0</vTroco></pag></infNFe><infNFeSupl><qrCode><![CDATA[https://example.invalid/nfce?p=${key}|2|2|1|TEST]]></qrCode><urlChave>https://example.invalid/nfce</urlChave></infNFeSupl></NFe><protNFe><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><nProt>150260000000001</nProt><dhRecbto>2026-10-27T10:00:01-04:00</dhRecbto><cStat>100</cStat></infProt></protNFe></nfeProc>`;
 const xml=source.replace('</det>','<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>').replace('<mod>65</mod>','<mod>55</mod>').replace(/<infNFeSupl>[\s\S]*?<\/infNFeSupl>/,'').replace('<total>','<dest><CPF>12345678909</CPF><xNome>CLIENTE TESTE</xNome><indIEDest>9</indIEDest><enderDest><xLgr>Rua Teste</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>5103403</cMun><xMun>Cuiaba</xMun><UF>MT</UF><CEP>78000000</CEP></enderDest></dest><total>');
 const pdf=await danfePdf({status:'authorized',xml,access_key:key,environment:2});assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>3000);assert.match(pdf.toString('latin1'),/%%EOF/);
 await assert.rejects(danfePdf({status:'authorized',xml:xml.replace('<mod>55</mod>','<mod>65</mod>'),access_key:key,environment:2}),e=>e.code==='INVALID_FISCAL_EVIDENCE');
});

test('printer test is a server-generated thermal PDF in both widths',async()=>{for(const width of [58,80]){const pdf=await printerTestPdf(width);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);}});

test('receipt hides empty customer/note fields and zero financial totals while bolding payment method',async()=>{
 const baseSale={saleNumber:'42',created_at:'2026-10-27T15:00:00Z',seller_name:'Operador',customer_name:'João',status:'paid',subtotal_cents:11000,delivery_fee_cents:0,discount_cents:0,outstanding_cents:0,total_cents:11000,paid_cents:11000,items:[{quantity:1,product_name:'Gás P13',unit_price_cents:11000,gross_cents:11000,discount_cents:0}],payments:[{method:'pix',amount_cents:11000}]};
 const compactPdf=await receiptPdf(baseSale,{store_name:'Loja Teste',document_id:'11222333000181',address:'Rua A, 10',contact:'99999-0000'},80);
 const compactTable=await readPdfTable(compactPdf.toString('base64'));
 const compactText=compactTable.pages.flatMap(p=>p.lines.map(l=>l.items.map(i=>i.text).join(' '))).join('\n');
 assert.doesNotMatch(compactText,/Sem observações|Não informado|Taxa entrega|Desconto|Total recebido|Troco|Saldo devedor|Que nosso dia seja abençoado/i);
 assert.match(compactText,/\(=\) Pix 110,00/);
 assert.match(compactText,/SEM VALOR FISCAL/);
 assert.match(compactPdf.toString('latin1'),/Helvetica-Bold/);

 const detailedSale={...baseSale,delivery_fee_cents:500,discount_cents:200,total_cents:11300,outstanding_cents:1300,paid_cents:10000,delivery_address:'Rua B, 20',customer_phone:'65999998888',customer_details:{notes:'Ligar ao chegar'},payments:[{method:'cash',amount_cents:10000,received_cents:12000}]};
 const detailedPdf=await receiptPdf(detailedSale,{store_name:'Loja Teste'},80);
 const detailedTable=await readPdfTable(detailedPdf.toString('base64'));
 const detailedText=detailedTable.pages.flatMap(p=>p.lines.map(l=>l.items.map(i=>i.text).join(' '))).join('\n');
 assert.match(detailedText,/Endereço.*Rua B, 20/);
 assert.match(detailedText,/Telefone.*65999998888/);
 assert.match(detailedText,/Obs\.: Ligar ao chegar/);
 assert.match(detailedText,/Taxa entrega 5,00/);
 assert.match(detailedText,/Desconto 2,00/);
 assert.match(detailedText,/Total recebido 120,00/);
 assert.match(detailedText,/Troco 20,00/);
 assert.match(detailedText,/Saldo devedor: R\$ 13,00/);
});
