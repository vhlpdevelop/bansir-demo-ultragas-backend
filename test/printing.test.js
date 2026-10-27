import test from 'node:test';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {receiptPdf,danfePdf} from '../src/postgres/printing.js';
test('thermal receipts create real PDF at both widths and reject missing fiscal evidence',async()=>{
 const sale={saleNumber:'V-TEST',created_at:'2026-10-27T15:00:00Z',seller_name:'Operador',customer_name:'Cliente',status:'paid',total_cents:15000,paid_cents:15000,items:Array.from({length:50},()=>({quantity:1,product_name:'Gás de teste',unit_price_cents:300,gross_cents:300,discount_cents:0})),payments:[{method:'cash',amount_cents:15000,received_cents:16000}]};
 for(const width of [58,80]){const pdf=await receiptPdf(sale,{store_name:'Loja de teste'},width);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>1000);}
 await assert.rejects(danfePdf({status:'queued'}),e=>e.status===409);
 await assert.rejects(danfePdf({status:'authorized',xml:'<nfeProc/>',access_key:'1'.repeat(44),environment:2}),e=>e.code==='INVALID_FISCAL_EVIDENCE');
});

test('DANFE renders authorized NFC-e XML with original QR Code',async()=>{
 const key='50261011222333000181650010000000011000000011';
 const xml=`<nfeProc><NFe><infNFe Id="NFe${key}" versao="4.00"><ide><mod>65</mod><tpAmb>2</tpAmb><tpEmis>1</tpEmis><nNF>1</nNF><serie>1</serie><dhEmi>2026-10-27T10:00:00-04:00</dhEmi></ide><emit><CNPJ>11222333000181</CNPJ><xNome>LOJA TESTE HOMOLOGACAO</xNome><IE>123456789</IE><enderEmit><xLgr>Rua Teste</xLgr><nro>10</nro><xBairro>Centro</xBairro><xMun>Cuiaba</xMun><UF>MT</UF></enderEmit></emit><det nItem="1"><prod><cProd>1</cProd><xProd>NOTA SEM VALOR FISCAL</xProd><qCom>1</qCom><uCom>UN</uCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF><vProd>10.00</vProd></ICMSTot></total><transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>10.00</vPag></detPag><vTroco>0</vTroco></pag></infNFe><infNFeSupl><qrCode><![CDATA[https://example.invalid/nfce?p=${key}|2|2|1|TEST]]></qrCode><urlChave>https://example.invalid/nfce</urlChave></infNFeSupl></NFe><protNFe><infProt><tpAmb>2</tpAmb><chNFe>${key}</chNFe><nProt>150260000000001</nProt><dhRecbto>2026-10-27T10:00:01-04:00</dhRecbto><cStat>100</cStat></infProt></protNFe></nfeProc>`;
 for(const width of [58,80]){const pdf=await danfePdf({status:'authorized',xml,access_key:key,environment:2},width);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');if(process.env.PRINT_PREVIEW)await writeFile('migration-private/danfe-test-'+width+'.pdf',pdf);}
});
