import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {httpError} from './database.js';

const maxBytes=5*1024*1024;
const error=(status,message,code)=>httpError(status,message,code);
function inputBytes(base64){
 if(typeof base64!=='string'||base64.length>4*Math.ceil(maxBytes/3)||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw error(400,'Envie um PDF de até 5 MB.','INVALID_PDF');
 const bytes=Buffer.from(base64,'base64');
 if(bytes.length>maxBytes||bytes.subarray(0,5).toString()!=='%PDF-')throw error(400,'Envie um PDF de até 5 MB.','INVALID_PDF');
 return bytes;
}
export function createPdfReader({workerUrl=new URL('./pdf-parser-process.js',import.meta.url),timeoutMs=25000,maxConcurrent=2}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>4)throw new Error('Invalid PDF processing limits');
 const active=new Set();
 return async function read(base64,{maxPages=250,scope={},signal}={}){
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>250)throw error(400,'Limite de páginas inválido.','INVALID_PDF');
  if(signal?.aborted)throw error(408,'Leitura do PDF interrompida.','PDF_ABORTED');
  const tenant=scope.tenantId||'internal',user=scope.userId||'internal';
  if(active.size>=maxConcurrent||[...active].some(job=>job.tenant===tenant||job.user===user))throw error(429,'Já há uma leitura de PDF em andamento. Aguarde e tente novamente.','PDF_BUSY');
  const bytes=inputBytes(base64),job={tenant,user};active.add(job);
  return new Promise((resolve,reject)=>{
   let child,timer,outcome,forced,finished=false;
   const finish=(err,result)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);active.delete(job);if(err)reject(err);else resolve(result);};
   const stop=err=>{forced ||= err;if(child?.pid)child.kill('SIGKILL');else finish(forced);};
   const abort=()=>stop(error(408,'Leitura do PDF interrompida.','PDF_ABORTED'));
   // Separate process: a blocked parser can be killed without blocking Express.
   // Do not inherit DB/AWS/JWT credentials, NODE_OPTIONS or runtime debug flags.
   const env={NODE_ENV:'production'};
   for(const key of ['SystemRoot','WINDIR','TEMP','TMP','LANG','TZ'])if(process.env[key])env[key]=process.env[key];
   try{
    child=fork(workerUrl,[],{cwd:fileURLToPath(new URL('../../',import.meta.url)),execArgv:['--max-old-space-size=192'],env,serialization:'advanced',stdio:['ignore','ignore','ignore','ipc']});
    child.on('message',message=>{if(!outcome)outcome=message;});
    child.once('error',()=>stop(error(503,'Leitura de PDF temporariamente indisponível.','PDF_WORKER_UNAVAILABLE')));
    child.once('close',code=>{
     if(forced)return finish(forced);
     if(code!==0||!outcome)return finish(error(422,'Não foi possível processar o PDF dentro dos limites. Divida o arquivo.','PDF_RESOURCE_LIMIT'));
     if(!outcome.ok)return finish(error(400,outcome.code==='PDF_TOO_LARGE'?'PDF muito extenso. Divida em arquivos menores.':'Não foi possível ler o PDF. Use texto selecionável, sem senha.',outcome.code==='PDF_TOO_LARGE'?'PDF_TOO_LARGE':'PDF_READ_FAILED'));
     const result=outcome.result;
     if(!/^[a-f0-9]{64}$/.test(result?.fileHash||'')||!Array.isArray(result.pages)||result.pages.length>maxPages)return finish(error(503,'Resposta inválida do leitor de PDF.','PDF_WORKER_UNAVAILABLE'));
     finish(null,{fileHash:result.fileHash,pages:result.pages});
    });
    timer=setTimeout(()=>stop(error(422,'A leitura do PDF excedeu o tempo permitido. Divida o arquivo.','PDF_TIMEOUT')),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    child.send({bytes,maxPages},err=>{if(err)stop(error(503,'Leitura de PDF temporariamente indisponível.','PDF_WORKER_UNAVAILABLE'));});
   }catch{stop(error(503,'Leitura de PDF temporariamente indisponível.','PDF_WORKER_UNAVAILABLE'));}
  });
 };
}
const configured=Number(process.env.PDF_MAX_CONCURRENT||2);
export const readPdfTable=createPdfReader({maxConcurrent:configured});
export async function withPdfRequest(req,fn){
 const controller=new AbortController(),closed=()=>{if(!req.res.writableFinished)controller.abort();};
 req.res.once('close',closed);
 try{if(req.res.destroyed)controller.abort();return await fn({scope:req.identity,signal:controller.signal});}
 finally{req.res.off('close',closed);}
}
