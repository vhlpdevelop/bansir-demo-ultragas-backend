import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import PDFDocument from 'pdfkit';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {provisionTenant} from '../src/postgres/provision.js';
import {createAuth} from '../src/postgres/auth.js';
import {extractCustomerPdf} from '../src/postgres/customers.js';
import {extractProductPdf} from '../src/postgres/product-import.js';
import {defaultStorefront} from '../src/postgres/storefront.js';

async function report(type){
 const doc=new PDFDocument({size:[842,595],margin:20}),chunks=[];const done=new Promise(r=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>r(Buffer.concat(chunks)));});
 const print=(text,x,y)=>doc.fontSize(8).text(text,x,y,{lineBreak:false});
 if(type==='customers'){
  [['Cód.',32],['Nome',100],['Telefone',250],['Celular',374],['Último Pedido',494],['Nascimento',562],['E-mail',634],['Endereço',773]].forEach(([s,x])=>print(s,x,60));
  [['10',32],['Cliente de Teste',100],['67 99999-1111',250],['03/10/2026',494],['03/10/2026',562],['260',778]].forEach(([s,x])=>print(s,x,90));
  doc.addPage();[['11',32],['Sem telefone',100],['67 9903-2107',250],['02/10/2026',494],['01/10/2000',562],['teste@example.invalid',634],['Rua Um 2',778]].forEach(([s,x])=>print(s,x,90));
 }else{
  [['Código',35],['Atalho',101],['Produto',183],['Categoria',367],['Setor',474],['(R$) Custo',568],['R$ Preço',642],['Estoque',725],['Vazios',776]].forEach(([s,x])=>print(s,x,60));
  [['173',56],['13',100],['GÁS GLP 13KG',182],['0',567],['145',640],['-1339',732],['1338',781]].forEach(([s,x])=>print(s,x,90));
  [['3',56],['1',100],['GALÃO TESTE',182],['1,93',567],['2,50',640],['7',740],['0',788]].forEach(([s,x])=>print(s,x,120));
 }
 doc.end();return (await done).toString('base64');
}

test('Report imports and establishment owner freight',{skip:!process.env.TEST_POSTGRES_URL,timeout:180000},async t=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL});let server;
 try{
  const password=randomBytes(20).toString('hex'),secret=randomBytes(48).toString('hex'),tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'jasley-report',name:'Report Test',adminName:'Owner',email:'owner-report@test.invalid',password});
  const auth=createAuth(db,{jwtSecret:secret}),owner=await auth.login({email:'owner-report@test.invalid',password});assert.equal(owner.user.isEstablishmentOwner,true);
  const otherId=randomUUID();await admin.query("INSERT INTO bansir.users(id,email,name,password_hash) SELECT $1,'other-report@test.invalid','Another admin',password_hash FROM bansir.users WHERE id=$2",[otherId,owner.user.id]);
  await admin.query("INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",[tenant.id,otherId]);
  await admin.query("INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role) VALUES($1,$2,$3,'admin')",[tenant.id,tenant.establishmentId,otherId]);
  const other=await auth.login({email:'other-report@test.invalid',password});assert.equal(other.user.isEstablishmentOwner,false);
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test'}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const send=async(path,body,{token=owner.token,method=body?'POST':'GET',checkout}={})=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(checkout?{'X-Checkout-Token':checkout}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  let p,settings;
  await t.test('column parser preserves empty phones, dates, source identity and both stock columns',async()=>{
   const customers=await extractCustomerPdf(await report('customers'));assert.equal(customers.rows.length,2);assert.equal(customers.layout,'jasley-clientes');assert.equal(customers.rows[0].phone,'5567999991111');assert.equal(customers.rows[0].address,'260');assert.equal(customers.rows[1].phone,'5567999032107');assert.equal(customers.rows[1].sourceMetadata.telephone,'67 9903-2107');assert.equal(customers.rows[1].sourceMetadata.page,2);
   const payload={requestKey:randomUUID(),fileHash:customers.fileHash,rows:customers.rows.map(({name,phone,document,address,sourceCode,sourceMetadata})=>({name,phone,document,address,sourceCode,sourceMetadata}))};
   const first=await send('/customers/import/confirm',payload);assert.equal(first.status,201);assert.equal(first.body.data.created,2);assert.deepEqual((await send('/customers/import/confirm',payload)).body,first.body);assert.equal((await send('/customers/import/confirm',{...payload,requestKey:randomUUID()})).body.data.skipped,2);
   const rows=(await send('/customers')).body.data;assert.equal(rows.find(r=>r.source_code==='11').import_metadata.birthDate,'01/10/2000');
   const products=await extractProductPdf(await report('products'));assert.equal(products.rows.length,2);assert.equal(products.rows[0].sourceStock,-1339);assert.equal(products.rows[0].empties,1338);assert.equal(products.rows[0].stock,'');assert.equal(products.rows[0].selected,false);assert.equal(products.rows[1].price,2.5);assert.equal(products.rows[1].costPrice,1.93);
   const product=products.rows[0];const {issues,selected,sourceLine,...row}=product;void issues;void selected;void sourceLine;
   const command={requestKey:randomUUID(),fileHash:products.fileHash,rows:[{...row,stock:-1}]};assert.equal((await send('/products/import/confirm',command)).status,400);
   command.rows[0].stock=8;const imported=await send('/products/import/confirm',command);assert.equal(imported.status,201);assert.equal(imported.body.data.created,1);assert.deepEqual((await send('/products/import/confirm',command)).body,imported.body);assert.equal((await send('/products/import/confirm',{...command,requestKey:randomUUID()})).body.data.skipped,1);
   p=(await send('/products')).body.data[0];assert.equal(p.stock,8);assert.equal(p.price,145);assert.match(p.specs,/1338/);
  });
  await t.test('only explicit owner may choose fixed or region fees, including forged SQL/API writes',async()=>{
   settings={slug:'report-orders',enabled:true,config:{...defaultStorefront,shippingMode:'fixed',fixedShippingCents:900,allowPickup:true,productIds:[p.id]}};
   assert.equal((await send('/storefront/settings',settings,{method:'PUT'})).status,200);
   assert.equal((await send('/storefront/settings',{...settings,config:{...settings.config,fixedShippingCents:1}},{method:'PUT',token:other.token})).status,403);
   assert.equal((await send('/storefront/settings',{...settings,config:{...settings.config,shippingMode:'regions',zones:[{id:'centro',name:'Centro',feeCents:1}]}},{method:'PUT',token:other.token})).status,403);
   assert.equal((await send('/storefront/settings',{...settings,config:{...settings.config,headline:'Outra chamada permitida'}},{method:'PUT',token:other.token})).status,200);
   await assert.rejects(db.transaction({userId:otherId,tenantId:tenant.id,establishmentId:tenant.establishmentId},c=>c.query("UPDATE bansir.storefronts SET config=jsonb_set(config,'{fixedShippingCents}','1')")),e=>e.code==='42501');
   const checkout=(await send('/public/stores/report-orders/start',{phone:'67999998888'},{token:null})).body.data;
   const order={requestKey:randomUUID(),customerName:'Public test',deliveryAddress:'Rua teste 10',fulfillment:'delivery',zoneId:'',expectedShippingCents:900,items:[{productId:p.id,quantity:1,expectedUnitPriceCents:14500}]};
   const placed=await send('/public/stores/report-orders/orders',order,{token:null,checkout:checkout.token});assert.equal(placed.status,201);assert.equal(placed.body.data.totalCents,15400);
   assert.equal((await send('/public/stores/report-orders/orders',{...order,requestKey:randomUUID(),expectedShippingCents:0},{token:null,checkout:checkout.token})).status,409);
   settings.config={...settings.config,shippingMode:'regions',zones:[{id:'centro',name:'Centro',feeCents:500}]};assert.equal((await send('/storefront/settings',settings,{method:'PUT'})).status,200);
   assert.equal((await send('/public/stores/report-orders/orders',{...order,requestKey:randomUUID(),zoneId:'centro',expectedShippingCents:500},{token:null,checkout:checkout.token})).body.data.totalCents,15000);
  });
  if(process.env.TEST_CUSTOMER_PDF&&process.env.TEST_PRODUCT_PDF)await t.test('actual Jasley PDFs parse completely and import the selected customers in disposable PostgreSQL',async()=>{
   const customers=await extractCustomerPdf((await readFile(process.env.TEST_CUSTOMER_PDF)).toString('base64')),products=await extractProductPdf((await readFile(process.env.TEST_PRODUCT_PDF)).toString('base64'));
   assert.equal(customers.pages,183);assert.equal(customers.rows.length,5219);assert.equal(customers.repeatedLines,232);assert.equal(products.rows.length,56);assert.equal(new Set(customers.rows.map(r=>r.sourceCode)).size,5219);
   const gas=products.rows.find(r=>r.sourceCode==='173');assert.equal(gas.price,145);assert.equal(gas.sourceStock,-1339);assert.equal(gas.empties,1338);
   const rows=customers.rows.filter(r=>r.selected).map(({name,phone,document,address,sourceCode,sourceMetadata})=>({name,phone,document,address,sourceCode,sourceMetadata}));
   // Clear only synthetic fixtures in this isolated test unit before validating the full report.
   await admin.query('DELETE FROM bansir.customers WHERE tenant_id=$1',[tenant.id]);
   const imported=await send('/customers/import/confirm',{requestKey:randomUUID(),fileHash:customers.fileHash,rows});assert.equal(imported.status,201,imported.body.code);assert.equal(imported.body.data.created,rows.length);
   console.log(`PDFs reais: ${customers.pages} páginas, ${customers.rows.length} clientes, ${rows.length} selecionados, ${products.rows.length} produtos; banco descartável.`);
  });
 }finally{if(server)await new Promise(r=>server.close(r));await db.close();await admin.end();}
});
