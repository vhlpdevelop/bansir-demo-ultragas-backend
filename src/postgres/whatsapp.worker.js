import 'dotenv/config';
import {createQueue} from './queue.js';
import {processMetaJob} from './meta-delivery.js';
if(process.env.DATABASE_ADMIN_URL)throw new Error('Remova DATABASE_ADMIN_URL do worker.');
if(!process.env.WORKER_DATABASE_URL||!/^v\d{1,3}\.\d+$/.test(process.env.META_GRAPH_VERSION||'')||!process.env.FISCAL_ENCRYPTION_KEY)throw new Error('Configure WORKER_DATABASE_URL, META_GRAPH_VERSION e criptografia antes de iniciar o worker Meta.');
const queue=createQueue(process.env.WORKER_DATABASE_URL);let stopping=false;
process.once('SIGTERM',()=>{stopping=true;});process.once('SIGINT',()=>{stopping=true;});
try{await queue.ready();while(!stopping){let job;try{job=await queue.claim('whatsapp');if(!job){await new Promise(r=>setTimeout(r,2000));continue;}const renewal=setInterval(()=>queue.renew(job).catch(()=>{}),30000);try{const result=await processMetaJob(queue,job);await queue.finish(job,'done',result?.skipped?'META_OUTSIDE_BUSINESS_HOURS':null);}catch(e){const code=/^[A-Z_]{3,80}$/.test(e.message)?e.message:'META_WORKER_FAILED';await queue.finish(job,e.terminal?'dead':'retry',code);console.error('[worker:meta]',job.id,code);}finally{clearInterval(renewal);}}catch{console.error('[worker:meta] Falha de banco; aguardando.');await new Promise(r=>setTimeout(r,5000));}}}finally{await queue.close();}
