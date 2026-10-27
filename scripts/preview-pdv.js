// Disposable local preview. Never reads application database URLs or touches production data.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {migrate} from '../src/postgres/migrate.js';
import {provisionTenant} from '../src/postgres/provision.js';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {defaultStorefront} from '../src/postgres/storefront.js';
const exec=promisify(execFile),suffix=randomBytes(6).toString('hex'),name=`bansir-pdv-preview-${suffix}`,password=randomBytes(24).toString('hex');
const pricingPreview=process.argv.includes('--pricing');
let created=false,database,server;
try{
 await exec('docker',['run','--detach','--rm','--name',name,'--publish','127.0.0.1::5432','--env',`POSTGRES_PASSWORD=${password}`,'--env',`POSTGRES_DB=bansir_test_${suffix}`,'postgres:17-alpine']);created=true;
 const {stdout}=await exec('docker',['port',name,'5432/tcp']);const port=stdout.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1];if(!port)throw new Error('Invalid preview port');
 const adminUrl=`postgresql://postgres:${password}@127.0.0.1:${port}/bansir_test_${suffix}`;
 for(let n=0;;n++){const check=new pg.Client({connectionString:adminUrl});try{await check.connect();await check.query('SELECT 1');break;}catch(e){if(n>50)throw e;await new Promise(r=>setTimeout(r,200));}finally{await check.end().catch(()=>{});}}
 await migrate(adminUrl);const tenant=await provisionTenant(adminUrl,{slug:'pdv-preview',name:'Ultragas - Teste Local',adminName:'Operador de teste',email:'pdv-preview@example.invalid',password:'PDV-local-preview-2026!'});
 const admin=new pg.Client({connectionString:adminUrl});await admin.connect();try{
  await admin.query(`CREATE ROLE preview_api LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT bansir_runtime TO preview_api`);
  const products=(await admin.query(`INSERT INTO bansir.products(tenant_id,establishment_id,name,barcode,price_cents,cost_cents,stock,ncm) VALUES($1,$2,'Botijão P13 de teste','TEST-P13',12045,9000,20,'27111910'),($1,$2,'Água 20 litros de teste','TEST-AGUA',1001,600,30,'22011000') RETURNING id`,[tenant.id,tenant.establishmentId])).rows;
  if(pricingPreview){
   await admin.query('UPDATE bansir.products SET price_cents=14500,fulfillment_pricing=$2 WHERE id=$1',[products[0].id,{deliveryPrice:150,saturdayPickupPrice:135,saturdayDeliveryPrice:140}]);
   await admin.query('UPDATE bansir.products SET price_cents=1200,fulfillment_pricing=$2 WHERE id=$1',[products[1].id,{deliveryPrice:15,saturdayDeliveryPrice:13}]);
   products.push((await admin.query("INSERT INTO bansir.products(tenant_id,establishment_id,name,barcode,price_cents,stock,gas_do_povo) VALUES($1,$2,'Gás do Povo de teste','TEST-POVO',14500,20,true) RETURNING id",[tenant.id,tenant.establishmentId])).rows[0]);
  }
  await admin.query("INSERT INTO bansir.deliverers(tenant_id,establishment_id,name,phone) VALUES($1,$2,'Entregador de teste','5565999997777')",[tenant.id,tenant.establishmentId]);
  await admin.query("INSERT INTO bansir.customers(tenant_id,establishment_id,name,phone,address) VALUES($1,$2,'Cliente cadastrado de teste','5565999998888','Endereco privado do cadastro')",[tenant.id,tenant.establishmentId]);
  await admin.query("INSERT INTO bansir.storefronts(tenant_id,establishment_id,slug,enabled,config) VALUES($1,$2,'ultragas-teste-local',true,$3)",[tenant.id,tenant.establishmentId,{...defaultStorefront,name:'Ultragas Bela Vista',productIds:products.map(p=>p.id),zones:[{id:'centro',name:'Centro e Bela Vista',feeCents:500}],notices:[{title:'Frete sem surpresa',body:'Confira o valor da entrega antes de enviar. Retirada na loja é grátis.',tone:'info'},{title:'Atendimento próximo de você',body:'A loja confirma seu pedido e combina a entrega pelo telefone informado.',tone:'success'}]}]);
  await admin.query("UPDATE bansir.store_settings SET pix_key='test@example.com',merchant_city='CUIABA' WHERE tenant_id=$1",[tenant.id]);
 }finally{await admin.end();}
 database=createDatabase({connectionString:`postgresql://preview_api:${password}@127.0.0.1:${port}/bansir_test_${suffix}`});await database.ready();
 server=createPostgresApp({database,jwtSecret:randomBytes(48).toString('hex'),nodeEnv:'test',...(process.argv.includes('--saturday')?{clock:()=>new Date('2026-10-31T15:00:00Z')}:{})}).listen(5501,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
 console.log('PDV preview: http://127.0.0.1:5501 | conta exclusivamente de teste: pdv-preview@example.invalid / PDV-local-preview-2026!');
 await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
}finally{if(server?.listening)await new Promise(r=>server.close(r));if(database)await database.close();if(created)await exec('docker',['rm','--force',name]);}
