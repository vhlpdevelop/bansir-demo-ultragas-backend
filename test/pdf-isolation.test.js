import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import PDFDocument from 'pdfkit';
import {createPdfReader,withPdfRequest} from '../src/postgres/pdf-reader.js';
import {EventEmitter} from 'node:events';

const fixture=new URL('../scripts/testing/pdf-worker-fixture.mjs',import.meta.url);
const sample=mode=>Buffer.from('%PDF-1.7\n'+mode).toString('base64');
const scope=(tenantId='a',userId='one')=>({tenantId,userId});
async function document(pages=1){const pdf=new PDFDocument(),chunks=[];const done=new Promise(resolve=>{pdf.on('data',b=>chunks.push(b));pdf.on('end',()=>resolve(Buffer.concat(chunks)));});for(let n=1;n<=pages;n++){if(n>1)pdf.addPage();pdf.text('PDF de teste '+n);}pdf.end();return done;}

test('PDF isolation: valid extraction, SHA and actual page limits survive the process boundary',async()=>{
 const read=createPdfReader(),bytes=await document(2),result=await read(bytes.toString('base64'));
 assert.equal(result.fileHash,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.pages.length,2);
 assert.ok(result.pages[0].lines.some(l=>l.items.some(i=>i.text.includes('PDF de teste 1'))));
 await assert.rejects(read(bytes.toString('base64'),{maxPages:1}),e=>e.code==='PDF_TOO_LARGE');
 await assert.rejects(read(Buffer.from('%PDF-invalid').toString('base64')),e=>e.code==='PDF_READ_FAILED');
 await assert.rejects(read('x'.repeat(7000000)),e=>e.code==='INVALID_PDF');
});
test('PDF isolation: per-tenant, per-user and global quotas reject without spawning a queue',async()=>{
 const read=createPdfReader({workerUrl:fixture,maxConcurrent:2,timeoutMs:10000});
 const first=read(sample('delay'),{scope:scope()});
 await assert.rejects(read(sample('delay'),{scope:scope('a','two')}),e=>e.status===429&&e.code==='PDF_BUSY');
 await assert.rejects(read(sample('delay'),{scope:scope('b','one')}),e=>e.code==='PDF_BUSY');
 const second=read(sample('delay'),{scope:scope('b','two')});
 await assert.rejects(read(sample('delay'),{scope:scope('c','three')}),e=>e.code==='PDF_BUSY');
 await Promise.all([first,second]);assert.equal((await read(sample('ok'),{scope:scope()})).pages.length,1);
});
test('PDF isolation: blocked parser times out while HTTP health stays responsive, then releases capacity',async()=>{
 const read=createPdfReader({workerUrl:fixture,maxConcurrent:1,timeoutMs:1200});
 const server=createServer((req,res)=>res.end('healthy')).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const pending=assert.rejects(read(sample('busy'),{scope:scope()}),e=>e.code==='PDF_TIMEOUT');
  await new Promise(r=>setTimeout(r,200));const start=Date.now();
  const health=await fetch(`http://127.0.0.1:${server.address().port}`);assert.equal(await health.text(),'healthy');assert.ok(Date.now()-start<2000);
  await pending;assert.equal((await read(sample('ok'))).pages.length,1);
 }finally{await new Promise(r=>server.close(r));}
});
test('PDF isolation: crash and client cancellation kill only the task and release their quota',async()=>{
 const read=createPdfReader({workerUrl:fixture,maxConcurrent:1,timeoutMs:10000});
 await assert.rejects(read(sample('crash')),e=>e.code==='PDF_RESOURCE_LIMIT');
 const controller=new AbortController(),stopped=assert.rejects(read(sample('hang'),{signal:controller.signal}),e=>e.code==='PDF_ABORTED');
 controller.abort();await stopped;
 const response=new EventEmitter();response.writableFinished=false;response.destroyed=false;
 const abandoned=assert.rejects(withPdfRequest({res:response,identity:scope()},options=>read(sample('hang'),options)),e=>e.code==='PDF_ABORTED');
 response.emit('close');await abandoned;assert.equal(response.listenerCount('close'),0);
 assert.equal((await read(sample('ok'))).pages.length,1);
});
test('PDF isolation: subprocess has a heap budget and does not inherit runtime secrets',async()=>{
 const names=['DATABASE_URL','AWS_SECRET_ACCESS_KEY','JWT_SECRET','NODE_OPTIONS'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{
  for(const name of names)process.env[name]=name==='NODE_OPTIONS'?'--trace-warnings':'synthetic-test-only';
  const read=createPdfReader({workerUrl:fixture,timeoutMs:10000}),result=await read(sample('env'));
  assert.equal(result.pages[0].lines[0].items[0].text,'clean --max-old-space-size=192');
 }finally{for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
});
