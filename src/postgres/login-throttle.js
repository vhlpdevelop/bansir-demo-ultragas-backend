import {createHmac} from 'node:crypto';
import {ipKeyGenerator} from 'express-rate-limit';
import {httpError} from './database.js';
export function createLoginThrottle(database,secret){
 const digest=value=>createHmac('sha256',secret).update('login-limit:'+value).digest('hex');
 const account=req=>digest(String(req.body?.email||'').trim().toLowerCase().slice(0,254));
 const call=async(scope,key,clear=false)=>Number((await database.pool.query('SELECT bansir.auth_attempt($1,$2,$3) AS retry',[scope,key,clear])).rows[0].retry);
 return {
  async attempt(req,kind){
   const ip=digest(ipKeyGenerator(req.ip||req.socket.remoteAddress||'unknown'));
   for(const [scope,key] of [[kind+'-ip',ip],[kind+'-account',account(req)]]){
    const retry=await call(scope,key);if(retry){req.res.set('Retry-After',String(retry));throw httpError(429,'Muitas tentativas de acesso. Aguarde e tente novamente.','LOGIN_RATE_LIMITED');}
   }
  },
  success:(req,kind)=>call(kind+'-account',account(req),true)
 };
}
