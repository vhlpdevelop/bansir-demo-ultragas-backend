// Run on one EC2 with an instance role restricted to its own queue.
import pg from 'pg';
import {SQSClient,ReceiveMessageCommand,DeleteMessageCommand,ChangeMessageVisibilityCommand} from '@aws-sdk/client-sqs';
const {WORKER_DATABASE_URL,META_CELL_QUEUE_URL,META_CELL_ID,META_APP_ID}=process.env;
if(!WORKER_DATABASE_URL||!META_CELL_QUEUE_URL||!META_CELL_ID||!META_APP_ID)throw new Error('Configure the cell worker environment');
const pool=new pg.Pool({connectionString:WORKER_DATABASE_URL,max:2,connectionTimeoutMillis:10000,statement_timeout:15000}),sqs=new SQSClient({});let stopping=false;
process.once('SIGTERM',()=>{stopping=true;});process.once('SIGINT',()=>{stopping=true;});
try{
 const role=(await pool.query("SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'bansir_worker','MEMBER') AS worker,EXISTS(SELECT 1 FROM pg_roles r WHERE (r.rolsuper OR r.rolbypassrls) AND pg_has_role(current_user,r.oid,'MEMBER')) AS elevated,EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='bansir' AND c.relkind='r' AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns FROM pg_roles WHERE rolname=current_user")).rows[0];
 if(role.rolsuper||role.rolbypassrls||role.elevated||role.owns||!role.worker)throw new Error('Restricted worker login required');
 while(!stopping){try{const {Messages=[]}=await sqs.send(new ReceiveMessageCommand({QueueUrl:META_CELL_QUEUE_URL,WaitTimeSeconds:20,MaxNumberOfMessages:1,VisibilityTimeout:120}));
  for(const msg of Messages){let c;const renewal=setInterval(()=>sqs.send(new ChangeMessageVisibilityCommand({QueueUrl:META_CELL_QUEUE_URL,ReceiptHandle:msg.ReceiptHandle,VisibilityTimeout:120})).catch(()=>{}),30000);try{const b=JSON.parse(msg.Body);if(b.version!==1||b.appId!==META_APP_ID||b.cellId!==META_CELL_ID||!Array.isArray(b.events)||b.events.length>1000)throw new Error('INVALID_ENVELOPE');
   c=await pool.connect();await c.query('BEGIN');const route=(await c.query('SELECT * FROM bansir.meta_cell_receiver($1,$2)',[b.phoneNumberId,b.wabaId])).rows[0];
   if(!route||route.tenant_id!==b.tenantId||route.establishment_id!==b.establishmentId)throw new Error('LOCAL_ROUTE_MISMATCH');
   for(const e of b.events)await c.query('SELECT bansir.meta_ingest($1,$2,$3,$4,$5,$6,$7,$8)',[b.phoneNumberId,b.wabaId,e.messageId,e.direction,e.phone,e.text,e.status,e.timestamp]);
   await c.query('COMMIT');await sqs.send(new DeleteMessageCommand({QueueUrl:META_CELL_QUEUE_URL,ReceiptHandle:msg.ReceiptHandle}));
  }catch{if(c)await c.query('ROLLBACK').catch(()=>{});console.error('META_CELL_MESSAGE_FAILED');}finally{clearInterval(renewal);c?.release();}}
 }catch{console.error('META_CELL_POLL_FAILED');await new Promise(r=>setTimeout(r,3000));}}
}finally{await pool.end();}
