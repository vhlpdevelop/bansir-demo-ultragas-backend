import {z} from 'zod';
import {requirePermission,productInput,createProduct,moveStock} from './catalog.js';
import {fiscalDraftHash} from './fiscal.js';
import {httpError} from './database.js';
const normalized=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const revision=doc=>fiscalDraftHash({key:doc.access_key,status:doc.status,items:doc.items,xml:!!doc.encrypted_xml});
const available=doc=>{if(doc.status!=='AVAILABLE'||!doc.encrypted_xml||!doc.items.length)throw httpError(409,'A entrada exige o XML completo de uma nota disponível, com itens.','INBOUND_NOT_AVAILABLE');};
const rowInput=z.object({line:z.number().int().positive(),action:z.enum(['link','create','ignore']),productId:z.uuid().optional(),newProduct:productInput.omit({stock:true}).optional(),stockQuantity:z.number().int().positive().max(100000000).optional(),conversionConfirmed:z.boolean().default(false)}).strict();
export function mountFiscalStock(app,{scoped}){
 app.get('/api/v1/fiscal/inbound/:id/stock-preview',scoped('fiscal',true,async(c,r,m)=>{
  requirePermission(m,'products',true);
  const doc=(await c.query('SELECT * FROM bansir.fiscal_inbound WHERE id=$1',[z.uuid().parse(r.params.id)])).rows[0];if(!doc)throw httpError(404,'Nota não encontrada.','NOT_FOUND');
  const receipt=(await c.query('SELECT result,created_at FROM bansir.fiscal_stock_receipts WHERE access_key=$1',[doc.access_key])).rows[0];if(receipt)return {data:{receipt}};
  available(doc);
  const products=(await c.query('SELECT id,name,barcode,unit,stock,price_cents FROM bansir.products WHERE active ORDER BY name,id LIMIT 5001')).rows;
  const links=(await c.query('SELECT supplier_code,product_id FROM bansir.supplier_product_links WHERE supplier_cnpj=$1',[doc.supplier_cnpj])).rows;
  const items=doc.items.map(item=>{const candidates=products.filter(p=>links.some(l=>l.supplier_code===item.supplierCode&&l.product_id===p.id)||(/^(?:\d{8}|\d{12,14})$/.test(item.barcode)&&p.barcode===item.barcode)||normalized(p.name)===normalized(item.name)).slice(0,30).map(p=>({id:p.id,reason:links.some(l=>l.supplier_code===item.supplierCode&&l.product_id===p.id)?'Vínculo conferido do fornecedor':p.barcode===item.barcode?'Código de barras':'Nome semelhante; confira unidade e embalagem'}));return {...item,candidates};});
  return {data:{revision:revision(doc),items,products:products.slice(0,5000),catalogLimited:products.length>5000,accessKey:doc.access_key}};
 }));
 app.post('/api/v1/fiscal/inbound/:id/stock-receipt',scoped('fiscal',false,async(c,r,m)=>{
  requirePermission(m,'products',false);
  const data=z.object({physicallyChecked:z.literal(true),revision:z.string().regex(/^[a-f0-9]{64}$/),rows:z.array(rowInput).min(1).max(1000)}).strict().parse(r.body),i=r.identity,id=z.uuid().parse(r.params.id);
  const doc=(await c.query('SELECT * FROM bansir.fiscal_inbound WHERE id=$1 FOR SHARE',[id])).rows[0];if(!doc)throw httpError(404,'Nota não encontrada.','NOT_FOUND');
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`fiscal-stock:${i.tenantId}:${i.establishmentId}:${doc.access_key}`]);
  const fingerprint=fiscalDraftHash(data),previous=(await c.query('SELECT request_hash,result FROM bansir.fiscal_stock_receipts WHERE access_key=$1',[doc.access_key])).rows[0];
  if(previous){if(previous.request_hash!==fingerprint)throw httpError(409,'Esta nota já possui uma entrada de estoque conferida.','ALREADY_RECEIVED');return {data:previous.result};}
  available(doc);if(revision(doc)!==data.revision)throw httpError(409,'A nota mudou. Reabra a conferência antes de continuar.','INBOUND_CHANGED');
  if(data.rows.length!==doc.items.length||new Set(data.rows.map(x=>x.line)).size!==data.rows.length||doc.items.some(x=>!data.rows.some(y=>y.line===x.line)))throw httpError(400,'Confira todos os itens da nota uma única vez.','INVALID_LINES');
  if(data.rows.every(x=>x.action==='ignore'))throw httpError(400,'Selecione pelo menos um item para dar entrada.','NO_STOCK_ITEMS');
  const result={accessKey:doc.access_key,documentId:doc.id,receivedAt:new Date().toISOString(),rows:[]};
  for(const entry of [...data.rows].sort((a,b)=>(a.productId||'').localeCompare(b.productId||'')||a.line-b.line)){
   const item=doc.items.find(x=>x.line===entry.line);if(entry.action==='ignore'){result.rows.push({line:item.line,action:'ignore'});continue;}
   if(!entry.stockQuantity)throw httpError(400,'Informe a quantidade física que entrará no estoque.','QUANTITY_REQUIRED');
   let product;
   if(entry.action==='create'){
    if(!entry.newProduct||entry.productId)throw httpError(400,'Confira o cadastro do novo produto.','PRODUCT_REQUIRED');
    product=await createProduct(c,i,{...entry.newProduct,stock:0,active:true});
   }else{
    if(!entry.productId||entry.newProduct)throw httpError(400,'Selecione um produto existente.','PRODUCT_REQUIRED');
    product=(await c.query('SELECT id,name,unit FROM bansir.products WHERE id=$1 AND active FOR UPDATE',[entry.productId])).rows[0];if(!product)throw httpError(404,'Produto não disponível nesta loja.','NOT_FOUND');
   }
   if((normalized(product.unit)!==normalized(item.unit)||entry.stockQuantity!==Number(item.quantity))&&!entry.conversionConfirmed)throw httpError(400,'Confirme a conversão entre a unidade da nota e a quantidade física do catálogo.','CONVERSION_REQUIRED');
   const moved=await moveStock(c,i,{productId:product.id,type:'in',quantity:entry.stockQuantity,reason:`NF-e ${doc.access_key} · item ${item.line} · conferência física`});
   if(item.supplierCode)await c.query('INSERT INTO bansir.supplier_product_links(tenant_id,establishment_id,supplier_cnpj,supplier_code,product_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,establishment_id,supplier_cnpj,supplier_code) DO UPDATE SET product_id=EXCLUDED.product_id',[i.tenantId,i.establishmentId,doc.supplier_cnpj,item.supplierCode,product.id]);
   result.rows.push({line:item.line,action:entry.action,productId:product.id,quantity:entry.stockQuantity,stock:moved.product.stock});
  }
  await c.query('INSERT INTO bansir.fiscal_stock_receipts(tenant_id,establishment_id,access_key,document_id,request_hash,created_by,physically_checked,result) VALUES($1,$2,$3,$4,$5,$6,true,$7)',[i.tenantId,i.establishmentId,doc.access_key,doc.id,fingerprint,i.userId,result]);return {status:201,data:result};
 }));
}
