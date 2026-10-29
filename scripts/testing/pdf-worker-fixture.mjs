// Synthetic subprocess for security regression tests; never used by the API.
import {createHash} from 'node:crypto';
process.once('message',({bytes})=>{
 const input=Buffer.from(bytes),mode=input.toString().split('\n')[1];
 if(mode==='crash'){process.exit(3);return;}
 if(mode==='hang'){setInterval(()=>{},1000);return;}
 if(mode==='busy'){const until=Date.now()+5000;while(Date.now()<until){};}
 const text=mode==='env'?(process.env.DATABASE_URL||process.env.AWS_SECRET_ACCESS_KEY||process.env.JWT_SECRET||process.env.NODE_OPTIONS?'leaked':'clean')+' '+process.execArgv.join(' '):'synthetic';
 const send=()=>process.send({ok:true,result:{fileHash:createHash('sha256').update(input).digest('hex'),pages:[{number:1,width:100,lines:[{y:1,items:[{x:1,text}]}]}]}},()=>process.exit(0));
 if(mode==='delay')setTimeout(send,300);else send();
});
