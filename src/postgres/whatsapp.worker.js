import 'dotenv/config';
import makeWASocket,{DisconnectReason,useMultiFileAuthState} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import {mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createQueue} from './queue.js';

if(process.env.DATABASE_ADMIN_URL)throw new Error('Remova DATABASE_ADMIN_URL do worker.');
if(!process.env.WORKER_DATABASE_URL)throw new Error('WORKER_DATABASE_URL obrigatória (login separado com bansir_worker).');
const authRoot=process.env.WHATSAPP_AUTH_DIR||'/var/lib/bansir/whatsapp';
await mkdir(authRoot,{recursive:true});
const queue=createQueue(process.env.WORKER_DATABASE_URL),sockets=new Map();
let stopping=false,wake;const delay=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);timer.unref?.();wake=()=>{clearTimeout(timer);resolve();};});
const key=(t,e)=>`${t}/${e}`;
async function update(t,e,values){
 const client=await queue.pool.connect();
 try{await client.query('BEGIN');await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.establishment_id',$2,true)",[t,e]);
  await client.query(`UPDATE bansir.whatsapp_sessions SET status=$3,qr_code_url=$4,phone=$5,
   requested=CASE WHEN $3='DISCONNECTED' THEN false ELSE requested END,updated_at=now()
   WHERE tenant_id=$1 AND establishment_id=$2`,[t,e,values.status,values.qr||null,values.phone||'']);await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function connect(t,e){
 const id=key(t,e);if(sockets.has(id))return;
 const folder=join(authRoot,t,e),{state,saveCreds}=await useMultiFileAuthState(folder);
 const socket=makeWASocket({auth:state,printQRInTerminal:false,browser:['Bansir PDV','Chrome','1.0.0'],logger:pino({level:'silent'})});
 const record={socket,closing:false};sockets.set(id,record);
 socket.ev.on('creds.update',saveCreds);
 socket.ev.on('connection.update',async updateEvent=>{
  try{
   if(updateEvent.qr){const qr=await QRCode.toDataURL(updateEvent.qr);await update(t,e,{status:'WAITING_QR',qr});}
   if(updateEvent.connection==='open')await update(t,e,{status:'CONNECTED',phone:socket.user?.id?.split('@')[0]?.split(':')[0]||''});
   if(updateEvent.connection==='close'){
    sockets.delete(id);const statusCode=updateEvent.lastDisconnect?.error?.output?.statusCode;
    if(statusCode===DisconnectReason.loggedOut){await update(t,e,{status:'DISCONNECTED'});}
    else {await update(t,e,{status:'SYNCING'});if(!record.closing&&!stopping)setTimeout(()=>connect(t,e).catch(()=>update(t,e,{status:'ERROR'})),3000).unref?.();}
   }
  }catch(error){console.error(`[worker:whatsapp] status update failed: ${error.message}`);}
 });
}
async function sync(){
 const active=(await queue.pool.query('SELECT * FROM bansir.list_requested_whatsapp_sessions()')).rows,desired=new Set(active.map(row=>key(row.tenant_id,row.establishment_id)));
 for(const row of active)if(!sockets.has(key(row.tenant_id,row.establishment_id)))await connect(row.tenant_id,row.establishment_id).catch(async()=>update(row.tenant_id,row.establishment_id,{status:'ERROR'}));
 for(const [id,record] of sockets)if(!desired.has(id)){record.closing=true;try{await record.socket.logout();}catch{}try{record.socket.end(undefined);}catch{}sockets.delete(id);await rm(join(authRoot,...id.split('/')),{recursive:true,force:true});}
}
async function processJob(job){
 const payload=job.payload||{};
 if(payload.action==='logout'){await rm(join(authRoot,job.tenant_id,job.establishment_id),{recursive:true,force:true});return;}
 if(!['send-text','send-voucher'].includes(payload.action))return;
 const socket=sockets.get(key(job.tenant_id,job.establishment_id))?.socket;
 if(!socket?.user)throw new Error('WHATSAPP_NOT_CONNECTED');
 let digits=String(payload.phone).replace(/\D/g,'');if(digits.length===10||digits.length===11)digits=`55${digits}`;
 if(!/^\d{12,15}$/.test(digits))throw Object.assign(new Error('WHATSAPP_INVALID_PHONE'),{terminal:true});
 const [account]=await socket.onWhatsApp(`${digits}@s.whatsapp.net`);if(!account?.exists)throw Object.assign(new Error('WHATSAPP_NUMBER_NOT_FOUND'),{terminal:true});
 if(payload.action==='send-voucher')await socket.sendMessage(account.jid,{image:await QRCode.toBuffer(payload.code),caption:payload.message});
 else await socket.sendMessage(account.jid,{text:payload.message});
}
const stop=()=>{stopping=true;wake?.();};process.once('SIGTERM',stop);process.once('SIGINT',stop);
try{
 await queue.ready();console.log('[worker:whatsapp] Iniciado.');
 while(!stopping){
  try{await sync();const job=await queue.claim('whatsapp');if(!job){await delay(2000);continue;}
   const renewal=setInterval(()=>queue.renew(job).catch(()=>{}),30000);
   try{await processJob(job);await queue.finish(job,'done',null);}
   catch(error){const code=/^[A-Z_]{3,80}$/.test(error.message)?error.message:'WHATSAPP_SEND_FAILED';await queue.finish(job,error.terminal?'dead':'retry',code);console.error(`[worker:whatsapp] ${job.id}: ${code}`);}
   finally{clearInterval(renewal);}
  }catch(error){console.error(`[worker:whatsapp] retrying after database/session error: ${error.message}`);await delay(5000);}
 }
}finally{for(const {socket} of sockets.values())try{socket.end(undefined);}catch{}await queue.close();}
