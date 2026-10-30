import bcrypt from 'bcryptjs';
import {randomBytes,createHash} from 'node:crypto';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';
import {httpError} from './database.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const password=z.string().min(12,'Use pelo menos 12 caracteres.').max(72).refine(v=>Buffer.byteLength(v)<=72,'Senha muito longa.');
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Data inválida.');
const tenant=z.object({tenantId:z.uuid(),active:z.boolean(),planCode:z.string().min(1).max(100),monthlyCents:z.number().int().min(0).max(100000000),nextDue:date.nullable(),notes:z.string().max(4000),features:z.object({whatsapp:z.boolean(),orderLink:z.boolean(),financialIntelligence:z.boolean(),deliveries:z.boolean()}).strict()}).strict();
export function mountPlatformAdmin(app,{database,route,browserSessions,loginThrottle}){
 const base='/api/v1/platform';
 const command=async(req,operation,payload={})=>{
  const token=browserSessions.isBrowser(req)?browserSessions.platformToken(req):req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(browserSessions.isBrowser(req)&&!['GET','HEAD','OPTIONS'].includes(req.method))browserSessions.checkPlatform(req,token);
  if(!token)throw httpError(401,'Entre no painel Bansir.','PLATFORM_SESSION_REQUIRED');
  try{return (await database.pool.query('SELECT bansir.platform_command($1,$2,$3) AS data',[hash(token),operation,JSON.stringify(payload)])).rows[0].data;}
  catch(e){if(e.code==='28000')throw httpError(401,e.message,'PLATFORM_SESSION_EXPIRED');if(e.code==='42501')throw httpError(403,e.message,'PASSWORD_CHANGE_REQUIRED');if(e.code==='22023')throw httpError(409,e.message,'INVALID_OPERATION');if(e.code==='P0002')throw httpError(404,e.message,'NOT_FOUND');throw e;}
 };
 app.use(base,rateLimit({windowMs:900000,limit:600,standardHeaders:'draft-7',legacyHeaders:false}));
 app.post(`${base}/login`,rateLimit({windowMs:900000,limit:20,skipSuccessfulRequests:true,standardHeaders:'draft-7',legacyHeaders:false}),route(async req=>{
  browserSessions.loginOrigin(req);
  const d=z.object({email:z.email().max(254),password:z.string().min(1).max(200)}).strict().parse(req.body);
  await loginThrottle.attempt(req,'platform');
  const user=(await database.pool.query('SELECT * FROM bansir.platform_login($1)',[d.email.trim().toLowerCase()])).rows[0];
  // Equal-cost comparison for unknown identities.
  const valid=await bcrypt.compare(d.password,user?.password_hash||'$2b$12$abcdefghijklmnopqrstuuoD8SvbbDCsG65SoLGKFhZXOveS9L8cW');
  if(!user||!valid)throw httpError(401,'E-mail ou senha incorretos.','INVALID_CREDENTIALS');
  const token=randomBytes(32).toString('hex');
  const profile=(await database.pool.query('SELECT bansir.platform_open_session($1,$2,$3) AS data',[user.id,user.password_hash,hash(token)])).rows[0].data;
  if(!profile)throw httpError(401,'Entre novamente.','INVALID_CREDENTIALS');
  await loginThrottle.success(req,'platform');
  if(browserSessions.isBrowser(req))return {data:{user:profile,...browserSessions.openPlatform(req,token)}};
  return {data:{token,user:profile}};
 }));
 app.get(`${base}/csrf`,route(async req=>{if(!browserSessions.isBrowser(req))throw httpError(400,'Cliente de navegador obrigatório.','BROWSER_CLIENT_REQUIRED');const user=await command(req,'me');return {data:{user,csrfToken:browserSessions.platformProof(browserSessions.platformToken(req))}};}));
 app.get(`${base}/me`,route(async req=>({data:await command(req,'me')})));
 app.post(`${base}/logout`,route(async req=>{const data=await command(req,'logout');if(browserSessions.isBrowser(req))browserSessions.clearPlatform(req);return {data};}));
 app.post(`${base}/password`,rateLimit({windowMs:900000,limit:10,standardHeaders:'draft-7',legacyHeaders:false}),route(async req=>{
  const d=z.object({currentPassword:z.string().min(1).max(200),newPassword:password}).strict().parse(req.body);
  if(d.currentPassword===d.newPassword)throw httpError(400,'Escolha uma senha diferente.','PASSWORD_UNCHANGED');
  const old=await command(req,'password-hash');
  if(!await bcrypt.compare(d.currentPassword,old))throw httpError(400,'Senha atual incorreta.','INVALID_PASSWORD');
  const data=await command(req,'password',{expectedHash:old,newHash:await bcrypt.hash(d.newPassword,12)});if(browserSessions.isBrowser(req))browserSessions.clearPlatform(req);return {data};
 }));
 app.get(`${base}/overview`,route(async req=>({data:await command(req,'overview')})));
 app.put(`${base}/tenants/:id`,route(async req=>({data:await command(req,'tenant',tenant.parse({...req.body,tenantId:req.params.id}))})));
 app.post(`${base}/invoices`,route(async req=>({status:201,data:await command(req,'invoice',z.object({tenantId:z.uuid(),reference:z.string().trim().min(1).max(100),dueDate:date,amountCents:z.number().int().positive().max(100000000)}).strict().parse(req.body))})));
 app.post(`${base}/invoices/:id/paid`,route(async req=>({data:await command(req,'paid',z.object({tenantId:z.uuid(),invoiceId:z.uuid()}).strict().parse({...req.body,invoiceId:req.params.id}))})));
}
