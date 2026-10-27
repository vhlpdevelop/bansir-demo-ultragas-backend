import {z} from 'zod';
import {readPdfTable,productReportRows} from './pdf-import.js';
import {productInput,createProduct} from './catalog.js';
import {fiscalDraftHash} from './fiscal.js';
import {httpError} from './database.js';

export async function extractProductPdf(base64){
 const file=await readPdfTable(base64,{maxPages:100}),rows=productReportRows(file.pages);
 return {fileHash:file.fileHash,pages:file.pages.length,rows,warning:'Confira nomes cortados, preços e estoque físico. Código/atalho não são EAN; usamos LEGACY-código como identificador editável. Estoques negativos ficam sem saldo e desmarcados. Vazios e setor são preservados como origem; não viram estoque vendável nem operação de vasilhames.'};
}
const rowSchema=productInput.extend({sourceCode:z.string().regex(/^\d{1,30}$/),sourceStock:z.number().finite().nullable(),empties:z.number().finite().nullable(),sector:z.string().max(200)});
export async function importProducts(c,i,body){
 const data=z.object({requestKey:z.uuid(),fileHash:z.string().regex(/^[a-f0-9]{64}$/),rows:z.array(rowSchema).min(1).max(1000)}).strict().parse(body),fingerprint=fiscalDraftHash(data);
 if(new Set(data.rows.map(r=>r.barcode)).size!==data.rows.length||new Set(data.rows.map(r=>r.sourceCode)).size!==data.rows.length)throw httpError(400,'Há códigos repetidos na seleção.','DUPLICATE_PRODUCT');
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`product-import:${i.tenantId}:${i.establishmentId}`]);
 const previous=(await c.query('SELECT request_hash,result FROM bansir.product_imports WHERE request_key=$1',[data.requestKey])).rows[0];
 if(previous){if(previous.request_hash!==fingerprint)throw httpError(409,'Esta tentativa possui outros produtos.','IDEMPOTENCY_CONFLICT');return previous.result;}
 const result={created:0,skipped:0,total:data.rows.length};
 for(const row of [...data.rows].sort((a,b)=>a.barcode.localeCompare(b.barcode))){
  const sourceMarker=`jasley-product:${row.sourceCode}`;
  const found=await c.query('SELECT id FROM bansir.products WHERE barcode=$1 OR specs LIKE $2',[row.barcode,`%[${sourceMarker}]%`]);
  if(found.rowCount){result.skipped++;continue;}
  const {sourceCode,sourceStock,empties,sector,...product}=row;
  if(!Number.isInteger(product.stock)||product.stock<0)throw httpError(400,'Informe estoque físico não negativo para cada produto.','INVALID_STOCK');
  const source=JSON.stringify({sourceCode,sourceStock,empties,sector});
  await createProduct(c,i,{...product,category:product.category||'Sem categoria',specs:`[${sourceMarker}] Origem PDF: ${source}${product.specs?'\n'+product.specs:''}`});result.created++;
 }
 await c.query('INSERT INTO bansir.product_imports(tenant_id,establishment_id,request_key,source_sha256,request_hash,created_by,result) VALUES($1,$2,$3,$4,$5,$6,$7)',[i.tenantId,i.establishmentId,data.requestKey,data.fileHash,fingerprint,i.userId,result]);
 return result;
}
export function mountProductImport(app,{scoped}){
 app.post('/api/v1/products/import/pdf',scoped('products',false,async(c,req)=>({data:await extractProductPdf(z.object({base64:z.string().max(7000000)}).strict().parse(req.body).base64)})));
 app.post('/api/v1/products/import/confirm',scoped('products',false,async(c,req)=>({status:201,data:await importProducts(c,req.identity,req.body)})));
}
