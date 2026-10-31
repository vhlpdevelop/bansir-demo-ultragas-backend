import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import pg from 'pg';
import forge from 'node-forge';
import {createDatabase} from '../src/postgres/database.js';
import {createPostgresApp} from '../src/postgres/app.js';
import {provisionTenant,assignPlan,createEstablishment} from '../src/postgres/provision.js';
import {createAuth} from '../src/postgres/auth.js';
import {createQueue} from '../src/postgres/queue.js';
import {processInbound} from '../src/postgres/fiscal-monitor.js';
import {parseDistribution,decodeDocument} from '../src/postgres/inbound-parser.js';

function cert(password){const keys=forge.pki.rsa.generateKeyPair(2048),c=forge.pki.createCertificate();c.publicKey=keys.publicKey;c.serialNumber='14';c.validity.notBefore=new Date(Date.now()-60000);c.validity.notAfter=new Date(Date.now()+86400000*60);c.setSubject([{name:'commonName',value:'TEST:11222333000181'}]);c.setIssuer(c.subject.attributes);c.sign(keys.privateKey,forge.md.sha256.create());return forge.util.encode64(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey,[c],password,{algorithm:'3des'})).getBytes());}
test('Suppliers, fiscal recipients and inbound monitoring',{skip:!process.env.TEST_POSTGRES_URL,timeout:90000},async t=>{
 assert.match(new URL(process.env.TEST_POSTGRES_URL).pathname,/^\/bansir_test_[a-f0-9]+$/);process.env.FISCAL_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const admin=new pg.Client({connectionString:process.env.TEST_POSTGRES_ADMIN_URL});await admin.connect();const db=createDatabase({connectionString:process.env.TEST_POSTGRES_URL}),queue=createQueue(process.env.TEST_WORKER_URL);let server;
 try{
  const password=randomBytes(20).toString('hex'),tenant=await provisionTenant(process.env.TEST_POSTGRES_ADMIN_URL,{slug:'fiscal-inbound-test',name:'Fiscal Test',adminName:'Admin',email:'inbound@test.invalid',password});
  const user=(await admin.query("SELECT id FROM bansir.users WHERE email='inbound@test.invalid'")).rows[0];await assignPlan(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,code:'inbound-two',name:'Test',maxEstablishments:2});
  const unit=await createEstablishment(process.env.TEST_POSTGRES_ADMIN_URL,{tenantSlug:tenant.slug,name:'Second',memberships:[{userId:user.id,role:'admin',allowedRoutes:[]}]});
  const secret=randomBytes(48).toString('hex'),auth=createAuth(db,{jwtSecret:secret}),login=await auth.login({email:'inbound@test.invalid',password}),s=await auth.select({selectionToken:login.selectionToken,tenantId:tenant.id,establishmentId:tenant.establishmentId});
  const login2=await auth.login({email:'inbound@test.invalid',password}),s2=await auth.select({selectionToken:login2.selectionToken,tenantId:tenant.id,establishmentId:unit.establishmentId});
  server=createPostgresApp({database:db,jwtSecret:secret,nodeEnv:'test',onError:e=>{if(!e.status&&!e.issues)console.error('Fiscal test:',e.code,e.message);}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const send=async(path,method='GET',body,token=s.token)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1`+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  let monitor,job;
  await t.test('supplier contact and bank data are scoped, validated and deactivated without deletion',async()=>{
   const data={name:'Distribuidora teste',document:'22.333.444/0001-55',tradeName:'Parceiro teste',phone:'65999991111',category:'Gás e GLP',address:{city:'Cuiabá'},bankDetails:{pixKey:'teste@example.invalid'}};
   const created=await send('/suppliers','POST',data);assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.data.id;
   assert.equal((await send('/suppliers?search=Distribuidora')).body.data.length,1);assert.equal((await send('/suppliers','GET',null,s2.token)).body.data.length,0);assert.equal((await send('/suppliers/'+id,'GET',null,s2.token)).status,404);
   assert.equal((await send('/suppliers','POST',data)).status,409);
   assert.equal((await send('/suppliers/'+id,'PUT',{active:false})).status,200);assert.equal((await send('/suppliers/'+id)).body.data.active,false);
   assert.equal((await send('/suppliers/'+id,'DELETE')).status,200);assert.equal((await send('/suppliers/'+id)).status,200);
  });
  await t.test('certificate activation gates monitor and isolates recipients',async()=>{
   assert.equal((await send('/fiscal/monitor','POST',{uf:'MT',environment:2})).status,409);
   const uploaded=await send('/fiscal/certificate','POST',{name:'A1 de teste',base64:cert('pfx-test'),password:'pfx-test'});assert.equal(uploaded.status,201);
   const settings=(await send('/fiscal/settings')).body.data;assert.equal(settings.certificate.name,'A1 de teste');assert.equal(settings.certificate.active,true);assert.equal(JSON.stringify(settings).includes('encrypted_bundle'),false);
   await send('/fiscal/certificate','PATCH',{active:false});assert.equal((await send('/fiscal/monitor','POST',{uf:'MT',environment:2})).status,409);await send('/fiscal/certificate','PATCH',{active:true});
   const created=await send('/fiscal/monitor','POST',{uf:'MT',environment:2});assert.equal(created.status,201,JSON.stringify(created.body));monitor=created.body.data;
   assert.equal((await send('/fiscal/monitor','GET',null,s2.token)).body.data.length,0);
   assert.equal((await send('/fiscal/recipients')).body.data[0].eligible,true);
   await queue.ready();await queue.pool.query('SELECT bansir.schedule_fiscal_monitors()');
   // Discard only preceding disposable test fixtures, never contact an external provider.
   for(let n=0;n<100;n++){const next=await queue.claim('fiscal');if(!next)break;if(next.payload.monitorId===monitor.id){job=next;break;}await queue.finish(next,'dead','TEST_FIXTURE');}assert.ok(job);
   await queue.pool.query('SELECT bansir.schedule_fiscal_monitors()');assert.equal((await admin.query("SELECT count(*)::int AS n FROM bansir.jobs WHERE payload->>'monitorId'=$1 AND state IN('pending','running')",[monitor.id])).rows[0].n,1);
  });
  await t.test('bounded distribution keeps NSU, emits one scoped alert and requires consent for science',async()=>{
   const key='50261022333444000155550010000000011000000011';assert.equal(key.length,44);
   const summary=`<resNFe><chNFe>${key}</chNFe><CNPJ>22333444000155</CNPJ><xNome>Fornecedor teste</xNome><dhEmi>2026-10-20T10:00:00-04:00</dhEmi><tpNF>1</tpNF><vNF>145.50</vNF><cSitNFe>1</cSitNFe></resNFe>`;
   const zipped=gzipSync(summary).toString('base64'),xml=`<retDistDFeInt><tpAmb>2</tpAmb><cStat>138</cStat><ultNSU>000000000000001</ultNSU><maxNSU>000000000000001</maxNSU><loteDistDFeInt><docZip NSU="000000000000001">${zipped}</docZip></loteDistDFeInt></retDistDFeInt>`;
   await processInbound(queue,job,{wizard:async()=>({result:xml})});await queue.finish(job,'done',null);
   const docs=(await send('/fiscal/inbound')).body.data;assert.equal(docs.length,1);assert.equal(Number(docs[0].total_cents),14550);assert.equal(docs[0].status,'SUMMARY');assert.equal(docs[0].xml_available,false);assert.equal((await send('/fiscal/inbound','GET',null,s2.token)).body.data.length,0);
   assert.equal((await send('/fiscal/monitor')).body.data[0].ult_nsu,'000000000000001');assert.equal((await send('/notifications')).body.data.filter(n=>n.title==='Nova nota de fornecedor').length,1);
   assert.equal((await send(`/fiscal/inbound/${docs[0].id}/xml`)).status,409);assert.equal((await send(`/fiscal/inbound/${docs[0].id}/science`,'POST',{})).status,400);
   assert.equal((await send(`/fiscal/inbound/${docs[0].id}/science`,'POST',{consent:true})).status,202);
   const science=await queue.claim('fiscal');assert.equal(science.payload.action,'science');
   await processInbound(queue,science,{wizard:async()=>({result:{retEvento:{infEvento:{cStat:'135',tpAmb:2,chNFe:key,tpEvento:'210210',nSeqEvento:1}}}})});await queue.finish(science,'done',null);
   assert.equal((await send('/fiscal/inbound')).body.data[0].science_status,'acknowledged');
   assert.throws(()=>parseDistribution(xml,{environment:1,ultNSU:'000000000000000',maxNSU:'000000000000000'}));
   assert.throws(()=>decodeDocument({'#text':gzipSync('x'.repeat(3*1024*1024)).toString('base64')},{cnpj:'11222333000181',environment:2}));
   await send('/fiscal/recipients/'+user.id,'PUT',{enabled:false});
   assert.equal((await queue.pool.query('SELECT bansir.fiscal_recipient_allowed($1,$2,$3) AS allowed',[tenant.id,tenant.establishmentId,user.id])).rows[0].allowed,false);
   assert.equal((await send('/fiscal/recipients')).body.data[0].enabled,false);
  });
  await t.test('full XML stays encrypted and download is scoped; blocked distribution preserves the cursor',async()=>{
   const key='50261022333444000155550010000000011000000011';
   const document=`<nfeProc><NFe><infNFe Id="NFe${key}"><ide><mod>55</mod><tpNF>1</tpNF><tpAmb>2</tpAmb><nNF>1</nNF><dhEmi>2026-10-20T10:00:00-04:00</dhEmi></ide><emit><CNPJ>22333444000155</CNPJ><xNome>Fornecedor teste</xNome></emit><dest><CNPJ>11222333000181</CNPJ></dest><det nItem="1"><prod><cProd>P13</cProd><cEAN>SEM GTIN</cEAN><xProd>Gás P13</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>145.50</vUnCom><vProd>145.50</vProd></prod></det><total><ICMSTot><vNF>145.50</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe><tpAmb>2</tpAmb><cStat>100</cStat></infProt></protNFe></nfeProc>`;
   await admin.query('UPDATE bansir.fiscal_monitors SET next_poll_at=now() WHERE id=$1',[monitor.id]);await queue.pool.query('SELECT bansir.schedule_fiscal_monitors()');
   const next=await queue.claim('fiscal');assert.equal(next.payload.monitorId,monitor.id);
   await processInbound(queue,next,{wizard:async()=>({result:`<retDistDFeInt><tpAmb>2</tpAmb><cStat>138</cStat><ultNSU>000000000000002</ultNSU><maxNSU>000000000000002</maxNSU><loteDistDFeInt><docZip NSU="000000000000002">${gzipSync(document).toString('base64')}</docZip></loteDistDFeInt></retDistDFeInt>`})});await queue.finish(next,'done',null);
   const doc=(await send('/fiscal/inbound')).body.data[0];assert.equal(doc.status,'AVAILABLE');assert.equal(doc.items[0].name,'Gás P13');assert.equal(doc.science_status,'acknowledged');
   assert.equal((await send(`/fiscal/inbound/${doc.id}/xml`)).body.data.xml,document);assert.equal((await send(`/fiscal/inbound/${doc.id}/xml`,'GET',null,s2.token)).status,404);
   const stored=(await admin.query('SELECT encrypted_xml FROM bansir.fiscal_inbound WHERE id=$1',[doc.id])).rows[0];assert.ok(!stored.encrypted_xml.includes('nfeProc'));
   const blocked=parseDistribution('<retDistDFeInt><tpAmb>2</tpAmb><cStat>656</cStat></retDistDFeInt>',{environment:2,ultNSU:'000000000000002',maxNSU:'000000000000002'});assert.equal(blocked.ultNSU,'000000000000002');assert.equal(blocked.documents.length,0);
  });
  await t.test('stock receipt matches catalog, requires physical checking and never double credits',async()=>{
   const doc=(await send('/fiscal/inbound')).body.data[0];
   const product=(await send('/products','POST',{name:'Gás P13',barcode:'GAS-MATCH',price:190,costPrice:100,stock:3,unit:'UN'})).body.data;
   const quoteBody={line:1,productId:product.id,stockQuantity:1};
   const noConfig=await send(`/fiscal/inbound/${doc.id}/pricing-preview`,'POST',quoteBody);assert.equal(noConfig.status,200);assert.equal(noConfig.body.data.suggestion,null);
   assert.equal((await send('/financial/pricing-intelligence','PUT',{pricingRules:{desiredProfitMargin:20}})).status,200);
   const quote=await send(`/fiscal/inbound/${doc.id}/pricing-preview`,'POST',quoteBody);assert.equal(quote.status,200,JSON.stringify(quote.body));assert.equal(quote.body.data.currentUnitCost,100);assert.equal(quote.body.data.invoiceUnitCost,145.5);assert.equal(quote.body.data.currentSalePrice,190);assert.equal(quote.body.data.suggestion.cash,181.88);assert.ok(Math.abs(quote.body.data.costChangePercent-45.5)<0.001);assert.equal(quote.body.data.weightedCost,111.375);
   assert.equal((await send(`/fiscal/inbound/${doc.id}/pricing-preview`,'POST',quoteBody,s2.token)).status,404);
   await admin.query("INSERT INTO bansir.tenant_contracts(tenant_id,features) VALUES($1,'{\"financialIntelligence\":false}') ON CONFLICT(tenant_id) DO UPDATE SET features=bansir.tenant_contracts.features||excluded.features",[tenant.id]);
   assert.equal((await send(`/fiscal/inbound/${doc.id}/pricing-preview`,'POST',quoteBody)).status,403);
   await admin.query("UPDATE bansir.tenant_contracts SET features=features-'financialIntelligence' WHERE tenant_id=$1",[tenant.id]);
   const preview=await send(`/fiscal/inbound/${doc.id}/stock-preview`);assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.data.items[0].candidates[0].id,product.id);
   const body={revision:preview.body.data.revision,physicallyChecked:true,rows:[{line:1,action:'link',productId:product.id,stockQuantity:1}]};
   assert.equal((await send(`/fiscal/inbound/${doc.id}/stock-receipt`,'POST',{...body,physicallyChecked:false})).status,400);
   assert.equal((await send(`/fiscal/inbound/${doc.id}/stock-receipt`,'POST',body,s2.token)).status,404);
   assert.equal((await send(`/fiscal/inbound/${doc.id}/stock-receipt`,'POST',{...body,rows:[{...body.rows[0],stockQuantity:12}]})).body.code,'CONVERSION_REQUIRED');
   const received=await send(`/fiscal/inbound/${doc.id}/stock-receipt`,'POST',body);assert.equal(received.status,201,JSON.stringify(received.body));assert.equal(received.body.data.rows[0].stock,4);
   assert.equal((await send(`/fiscal/inbound/${doc.id}/stock-receipt`,'POST',body)).status,200);
   assert.equal((await send(`/fiscal/inbound/${doc.id}/stock-receipt`,'POST',{...body,rows:[{...body.rows[0],stockQuantity:12,conversionConfirmed:true}]})).status,409);
   const stocked=(await send('/products')).body.data.find(p=>p.id===product.id);assert.equal(stocked.stock,4);assert.equal(stocked.price,190);
   assert.ok((await send(`/fiscal/inbound/${doc.id}/stock-preview`)).body.data.receipt);
   const second=(await admin.query("INSERT INTO bansir.fiscal_inbound(tenant_id,establishment_id,monitor_id,access_key,supplier_cnpj,supplier_name,status,items,encrypted_xml) SELECT tenant_id,establishment_id,monitor_id,'50261022333444000155550010000000021000000022',supplier_cnpj,supplier_name,'AVAILABLE',items,encrypted_xml FROM bansir.fiscal_inbound WHERE id=$1 RETURNING id",[doc.id])).rows[0];
   const plan=(await send(`/fiscal/inbound/${second.id}/stock-preview`)).body.data;assert.equal(plan.items[0].candidates[0].reason,'Vínculo conferido do fornecedor');
   const create={revision:plan.revision,physicallyChecked:true,rows:[{line:1,action:'create',stockQuantity:2,conversionConfirmed:true,newProduct:{name:'Novo produto conferido',barcode:'NF-NEW',price:200,unit:'UN',ncm:'27111910'}}]};
   assert.equal((await send(`/fiscal/inbound/${second.id}/stock-receipt`,'POST',{...create,revision:'0'.repeat(64)})).body.code,'INBOUND_CHANGED');
   const created=await send(`/fiscal/inbound/${second.id}/stock-receipt`,'POST',create);assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.data.rows[0].stock,2);
   const counts=(await admin.query('SELECT count(*)::int AS n FROM bansir.fiscal_stock_receipts WHERE tenant_id=$1',[tenant.id])).rows[0];assert.equal(counts.n,2);
   await admin.query("UPDATE bansir.establishment_memberships SET role='operador',allowed_routes=ARRAY['fiscal']::text[] WHERE user_id=$1 AND establishment_id=$2",[user.id,tenant.establishmentId]);
   assert.equal((await send(`/fiscal/inbound/${second.id}/stock-receipt`,'POST',create)).status,403);
   await admin.query("UPDATE bansir.establishment_memberships SET role='admin' WHERE user_id=$1 AND establishment_id=$2",[user.id,tenant.establishmentId]);
  });

 }finally{if(server)await new Promise(r=>server.close(r));await queue.close();await db.close();await admin.end();}
});
