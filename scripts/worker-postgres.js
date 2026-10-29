import 'dotenv/config';
import webpush from 'web-push';
import {configureVapid} from '../src/config/vapid.js';
import {createQueue} from '../src/postgres/queue.js';
import {deliverNotification} from '../src/postgres/notifications.js';
import {processInbound} from '../src/postgres/fiscal-monitor.js';
import {processFiscal,runWizard} from '../src/postgres/fiscal.worker.js';
import {seal} from '../src/postgres/secrets.js';

const kind=process.argv[2];
if(!['notification','fiscal'].includes(kind))throw new Error('Use notification ou fiscal.');
if(process.env.DATABASE_ADMIN_URL)throw new Error('Remova DATABASE_ADMIN_URL do worker.');
if(!process.env.WORKER_DATABASE_URL)throw new Error('WORKER_DATABASE_URL obrigatória (login separado com bansir_worker).');
if(kind==='notification' && !configureVapid(webpush,process.env).configured)throw new Error('Configure VAPID antes de iniciar o worker.');
if(kind==='fiscal'){
 seal('startup-validation','worker');
 if(!process.env.FISCAL_S3_BUCKET || !process.env.AWS_REGION)throw new Error('Configure bucket privado e região AWS para os documentos fiscais.');
}
const queue=createQueue(process.env.WORKER_DATABASE_URL);
let stopping=false,wake,lastFleetCheck=0;
const stop=()=>{stopping=true;wake?.();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
try{
 await queue.ready();console.log(`[worker:${kind}] Iniciado.`);
 while(!stopping){
  let job;
  try{
   if(kind==='notification'&&Date.now()-lastFleetCheck>=60000){await queue.pool.query('SELECT bansir.schedule_fleet_alerts()');lastFleetCheck=Date.now();}
   if(kind==='fiscal')await queue.pool.query('SELECT bansir.schedule_fiscal_monitors()');
   job=await queue.claim(kind);
   if(!job){await new Promise(resolve=>{const timer=setTimeout(resolve,2000);wake=()=>{clearTimeout(timer);resolve();};});continue;}
   const renewal=setInterval(()=>queue.renew(job).catch(()=>{}),30000);
   try{await (kind==='notification'?deliverNotification(queue,job):(['inbound','science'].includes(job.payload.action)?processInbound(queue,job,{wizard:runWizard}):processFiscal(queue,job)));await queue.finish(job,'done',null);}
   catch(error){const code=/^[A-Z_]{3,80}$/.test(error.message)?error.message:'WORKER_FAILED';await queue.finish(job,error.terminal?'dead':'retry',code);console.error(`[worker:${kind}] ${job.id}: ${code}`);}
   finally{clearInterval(renewal);}
  }catch{console.error(`[worker:${kind}] Falha de conexão; nova tentativa em 5s.`);await new Promise(resolve=>{const timer=setTimeout(resolve,5000);wake=()=>{clearTimeout(timer);resolve();};});}
 }
}finally{await queue.close();}
