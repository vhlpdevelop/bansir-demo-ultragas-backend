import {createHmac,timingSafeEqual} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {httpError,validId} from './database.js';

export function createBrowserSessions({secret,nodeEnv,allowedOrigins}){
 const production=nodeEnv==='production',prefix=production?'__Host-bansir-':'bansir-dev-';
 const options={httpOnly:true,secure:production,sameSite:'strict',path:'/'};
 const fail=(message='Origem ou proteção da sessão inválida.')=>{throw httpError(403,message,'BROWSER_SESSION_FORBIDDEN');};
 const isBrowser=req=>req.get('X-Bansir-Client')==='browser';
 const originAllowed=origin=>allowedOrigins.includes(origin)||(!production&&/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin||''));
 const origin=req=>{if(!originAllowed(req.get('origin'))||(production&&!req.secure))fail();};
 const loginOrigin=req=>{if(req.get('origin')&&!originAllowed(req.get('origin')))fail();if(isBrowser(req))origin(req);};
 const cookie=(req,name)=>{const matches=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));if(matches.length!==1)return '';try{return decodeURIComponent(matches[0].slice(name.length+1));}catch{return '';}};
 const proof=(kind,id)=>createHmac('sha256',secret).update('browser-csrf:'+kind+':'+id).digest('hex');
 const csrf=(req,kind,id)=>{const value=req.get('X-CSRF-Token')||'',expected=proof(kind,id);if(!/^[a-f0-9]{64}$/.test(value)||!timingSafeEqual(Buffer.from(value),Buffer.from(expected)))fail();};
 const platformName=prefix+'platform';
 const platformToken=req=>{origin(req);const value=cookie(req,platformName);if(!/^[a-f0-9]{64}$/.test(value))throw httpError(401,'Entre no painel Bansir.','PLATFORM_SESSION_REQUIRED');return value;};
 const refreshName=id=>prefix+'refresh-'+id;
 return {
  isBrowser,origin,loginOrigin,
  platformToken,
  platformProof:token=>proof('platform',token),
  checkPlatform(req,token){origin(req);csrf(req,'platform',token);},
  openPlatform(req,token){origin(req);req.res.cookie(platformName,token,{...options,maxAge:2*60*60*1000});return {csrfToken:proof('platform',token)};},
  clearPlatform:req=>req.res.clearCookie(platformName,options),
  issue(req,data){
   if(!isBrowser(req)||!data.refreshToken)return data;
   origin(req);const payload=jwt.decode(data.refreshToken),id=payload?.jti;
   if(!validId(id)||!Number.isInteger(payload.exp))throw new Error('Invalid issued browser session');
   req.res.cookie(refreshName(id),data.refreshToken,{...options,maxAge:Math.max(0,payload.exp*1000-Date.now())});
   const {refreshToken,...rest}=data;
   return {...rest,cookieSession:{id,csrfToken:proof('refresh',id),expiresAt:new Date(payload.exp*1000).toISOString()}};
  },
  refresh(req){
   origin(req);const id=req.get('X-Bansir-Session');if(!validId(id))fail();csrf(req,'refresh',id);
   const refreshToken=cookie(req,refreshName(id));if(!refreshToken)throw httpError(401,'Sessão encerrada. Entre novamente.','SESSION_REVOKED');
   // The cookie selector cannot choose another session's JWT or establishment.
   if(jwt.decode(refreshToken)?.jti!==id)fail();return {refreshToken};
  },
  clearRefresh(req,id){if(validId(id))req.res.clearCookie(refreshName(id),options);},
  checkRefreshMutation(req){if(isBrowser(req)&&req.get('X-Bansir-Session')){origin(req);const id=req.get('X-Bansir-Session');if(id!==req.identity?.sessionId)fail();csrf(req,'refresh',id);}}
 };
}
