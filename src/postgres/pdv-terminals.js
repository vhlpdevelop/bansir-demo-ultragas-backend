import {delegatedSetting} from './settings-permissions.js';
import {createHash,createHmac,randomInt,randomBytes} from 'node:crypto';
import {z} from 'zod';
import rateLimit from 'express-rate-limit';
import {httpError} from './database.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,code='TERMINAL_REQUIRED',status=409)=>{throw httpError(status,message,code);};
const admin=member=>{if(!delegatedSetting(member,'settings-terminals'))fail('Somente administradores podem gerenciar terminais.','FORBIDDEN',403);};
const unitLock=(c,i)=>c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`pdv-terminals:${i.tenantId}:${i.establishmentId}`]);
const providers=['pagbank','mercadopago','caixa'];
const audit=(c,i,id,event,reason='',provider=null,clientType=null)=>c.query('INSERT INTO bansir.pdv_terminal_events(tenant_id,establishment_id,terminal_id,user_id,event,reason,provider,client_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[i.tenantId,i.establishmentId,id,i.userId,event,reason,provider,clientType]);
export async function terminalRequired(c){return (await c.query('SELECT EXISTS(SELECT 1 FROM bansir.pdv_terminals WHERE paired_at IS NOT NULL) AS required')).rows[0].required;}
export async function currentTerminal(c,i){
 const token=i.pdvTerminalToken;
 if(!token)return null;
 await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[`pdv-terminals:${i.tenantId}:${i.establishmentId}`]);
 if(!/^pdvt_[A-Za-z0-9_-]{43}$/.test(token))fail('Vínculo do terminal inválido. Ative este navegador novamente.','TERMINAL_REVOKED');
 // A posted terminal UUID is not proof of enrollment. Validate the separate,
 // revocable browser credential, within the authenticated establishment's RLS.
 const row=(await c.query(`SELECT t.id,t.name,CASE WHEN t.device_hash=$1 THEN 'browser' ELSE 'smartpos:'||s.provider END AS client_type,s.provider FROM bansir.pdv_terminals t LEFT JOIN bansir.pdv_terminal_smartpos s ON s.terminal_id=t.id AND s.tenant_id=t.tenant_id AND s.establishment_id=t.establishment_id AND s.token_hash=$1 WHERE (t.device_hash=$1 OR s.token_hash=$1) AND t.active FOR SHARE OF t`,[hash(token)])).rows[0];
 if(!row)fail('Terminal desativado ou vínculo revogado. Peça uma nova ativação ao administrador.','TERMINAL_REVOKED');
 if(row.provider)await c.query('UPDATE bansir.pdv_terminal_smartpos SET last_seen_at=now() WHERE terminal_id=$1 AND provider=$2 AND token_hash=$3',[row.id,row.provider,hash(token)]);
 i.pdvTerminalClientType=row.client_type;return row;
}
export async function requireTerminal(c,i){
 // Enrollment transitions cannot race an unbound opening. Shared locks let
 // different terminals keep selling concurrently; management takes this exclusively.
 await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[`pdv-terminals:${i.tenantId}:${i.establishmentId}`]);
 const row=await currentTerminal(c,i);if(!row&&await terminalRequired(c))fail('Vincule este navegador a um terminal antes de operar o caixa.');return row;
}
export function assertCashTerminal(cash,terminal){
 if(cash.terminal_id&&cash.terminal_id!==terminal?.id)fail(`Este caixa pertence a ${cash.terminal_name}. Use o navegador vinculado a esse terminal.`,'CASH_TERMINAL_MISMATCH');
 if(!cash.terminal_id&&terminal)fail('Feche o caixa anterior, sem terminal identificado, e abra um novo caixa neste terminal.','LEGACY_CASH_CLOSE_REQUIRED');
}
export function mountPdvTerminals(app,{scoped,secret}){
 const activationHash=(code,i)=>createHmac('sha256',secret).update(JSON.stringify(['pdv-activation',i.tenantId,i.establishmentId,code])).digest('hex');
 app.get('/api/v1/pdv/terminals',scoped('settings-terminals',true,async(c,r)=>{
  let current=null,bindingError='';try{current=await currentTerminal(c,r.identity);}catch(e){if(e.code!=='TERMINAL_REVOKED')throw e;bindingError=e.message;}
  const terminals=(await c.query(`SELECT t.id,t.name,t.active,t.paired_at,t.created_at,c.id AS cash_session_id,c.id AS open_cash_id,c.user_id AS open_cash_user_id,c.opened_at,u.name AS operator_name,u.name AS open_cash_operator_name,CASE WHEN t.active THEN 'active' ELSE 'inactive' END AS status,(SELECT max(s.last_seen_at) FROM bansir.pdv_terminal_smartpos s WHERE s.terminal_id=t.id) AS last_seen_at,EXISTS(SELECT 1 FROM bansir.pdv_terminal_smartpos s WHERE s.terminal_id=t.id) AS smartpos_paired,coalesce((SELECT jsonb_agg(jsonb_build_object('provider',s.provider,'paired_at',s.paired_at,'last_seen_at',s.last_seen_at) ORDER BY s.provider) FROM bansir.pdv_terminal_smartpos s WHERE s.terminal_id=t.id),'[]') AS smartpos
   FROM bansir.pdv_terminals t LEFT JOIN bansir.cash_sessions c ON (c.tenant_id,c.establishment_id,c.terminal_id)=(t.tenant_id,t.establishment_id,t.id) AND c.closed_at IS NULL
   LEFT JOIN bansir.users u ON u.id=c.user_id ORDER BY t.created_at,t.id`)).rows;
  return {data:{terminals,current,required:await terminalRequired(c),bindingError,bindingErrorDetail:bindingError?{code:'TERMINAL_REVOKED',message:bindingError}:null}};
 }));
 app.post('/api/v1/pdv/terminals',scoped('settings-terminals',false,async(c,r,m)=>{
  admin(m);const {name}=z.object({name:z.string().trim().min(1).max(80)}).strict().parse(r.body),i=r.identity;await unitLock(c,i);
  if(Number((await c.query('SELECT count(*) FROM bansir.pdv_terminals')).rows[0].count)>=100)fail('Limite de 100 terminais por estabelecimento.','TERMINAL_LIMIT');
  if((await c.query('SELECT 1 FROM bansir.pdv_terminals WHERE lower(name)=lower($1)',[name])).rowCount)fail('Já existe um terminal com este nome.','TERMINAL_NAME_EXISTS');
  const row=(await c.query('INSERT INTO bansir.pdv_terminals(tenant_id,establishment_id,name,created_by) VALUES($1,$2,$3,$4) RETURNING id,name,active',[i.tenantId,i.establishmentId,name,i.userId])).rows[0];
  await audit(c,i,row.id,'created');return {status:201,data:row};
 }));
 app.post('/api/v1/pdv/terminals/:id/activation',scoped('settings-terminals',false,async(c,r,m)=>{
  admin(m);const {recoveryReason}=z.object({recoveryReason:z.string().trim().min(10).max(500).optional()}).strict().parse(r.body),id=z.uuid().parse(r.params.id),i=r.identity;await unitLock(c,i);
  const row=(await c.query('SELECT id FROM bansir.pdv_terminals WHERE id=$1 AND active FOR UPDATE',[id])).rows[0];if(!row)fail('Terminal não encontrado ou desativado.','NOT_FOUND',404);
  if(!recoveryReason&&(await c.query('SELECT 1 FROM bansir.cash_sessions WHERE terminal_id=$1 AND closed_at IS NULL',[id])).rowCount)fail('Feche o caixa deste terminal antes de alterar seu vínculo. Se perdeu o navegador, use a recuperação administrativa.','TERMINAL_BUSY');
  let code;for(let n=0;n<32;n++){code=String(randomInt(0,1_000_000)).padStart(6,'0');if(!(await c.query('SELECT 1 FROM bansir.pdv_terminals WHERE tenant_id=$1 AND establishment_id=$2 AND activation_hash=$3',[i.tenantId,i.establishmentId,activationHash(code,i)])).rowCount)break;code=null;}if(!code)fail('Tente gerar o código novamente.','ACTIVATION_BUSY',503);
  const expiry=(await c.query("UPDATE bansir.pdv_terminals SET activation_hash=$2,activation_expires_at=now()+interval '10 minutes',activation_recovery=$3,updated_at=now() WHERE id=$1 RETURNING activation_expires_at",[id,activationHash(code,i),!!recoveryReason])).rows[0].activation_expires_at;
  await audit(c,i,id,recoveryReason?'recovery_issued':'activation_issued',recoveryReason||'');return {data:{id,code,expiresAt:expiry}};
 }));
 app.post('/api/v1/pdv/terminals/pair',rateLimit({windowMs:900000,limit:120,standardHeaders:'draft-7',legacyHeaders:false,handler:(_req,res)=>res.status(429).json({success:false,code:'RATE_LIMITED',message:'Muitas tentativas. Aguarde e tente novamente.'})}),scoped('sales',false,async(c,r)=>{
  const input=z.object({clientType:z.enum(['browser','smartpos']).default('browser'),provider:z.enum(providers).optional(),code:z.string().trim().max(100).transform(v=>v.toUpperCase())}).strict().parse(r.body),{code,clientType}=input,provider=clientType==='smartpos'?(input.provider||'pagbank'):null,i=r.identity;await unitLock(c,i);
  const retry=async()=>Number((await c.query("SELECT coalesce(max(ceil(extract(epoch FROM blocked_until-now()))),0)::int AS retry FROM bansir.pdv_pair_attempts WHERE tenant_id=$1 AND establishment_id=$2 AND blocked_until>now() AND ((scope='user' AND subject=$3) OR scope='unit')",[i.tenantId,i.establishmentId,i.userId])).rows[0].retry);
  const denied=async(blocked=false)=>{if(!blocked)for(const [scope,subject] of [['user',i.userId],['unit',i.establishmentId]])await c.query("INSERT INTO bansir.pdv_pair_attempts(tenant_id,establishment_id,scope,subject,failures) VALUES($1,$2,$3,$4,1) ON CONFLICT(tenant_id,establishment_id,scope,subject) DO UPDATE SET blocked_until=CASE WHEN bansir.pdv_pair_attempts.window_start<now()-interval '15 minutes' THEN NULL WHEN bansir.pdv_pair_attempts.failures+1>=5 THEN now()+interval '15 minutes' ELSE NULL END,failures=CASE WHEN bansir.pdv_pair_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE bansir.pdv_pair_attempts.failures+1 END,window_start=CASE WHEN bansir.pdv_pair_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE bansir.pdv_pair_attempts.window_start END",[i.tenantId,i.establishmentId,scope,subject]);const seconds=await retry();await audit(c,i,null,'pair_failed',seconds?'RATE_LIMITED':'ACTIVATION_INVALID',provider,clientType);if(seconds)r.res.set('Retry-After',String(seconds));return {error:httpError(seconds?429:400,seconds?'Muitas tentativas. Aguarde 15 minutos.':'Código inválido, vencido ou já utilizado.',seconds?'RATE_LIMITED':'ACTIVATION_INVALID')};};
  if(await retry())return denied(true);
  if(!/^(?:\d{6}|[A-F0-9]{24})$/.test(code))return denied();
  const row=(await c.query('SELECT id,name,activation_recovery FROM bansir.pdv_terminals WHERE tenant_id=$1 AND establishment_id=$2 AND activation_hash=$3 AND activation_expires_at>now() AND active FOR UPDATE',[i.tenantId,i.establishmentId,activationHash(code,i)])).rows[0];
  if(!row)return denied();
  if(!row.activation_recovery&&(await c.query('SELECT 1 FROM bansir.cash_sessions WHERE terminal_id=$1 AND closed_at IS NULL',[row.id])).rowCount)fail('Feche o caixa antes de vincular outro navegador a este terminal.','TERMINAL_BUSY');
  const token='pdvt_'+randomBytes(32).toString('base64url');
  if(clientType==='smartpos')await c.query("INSERT INTO bansir.pdv_terminal_smartpos(terminal_id,tenant_id,establishment_id,provider,token_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(terminal_id,provider) DO UPDATE SET token_hash=EXCLUDED.token_hash,paired_at=now(),last_seen_at=NULL,diagnostics='{}'",[row.id,i.tenantId,i.establishmentId,provider,hash(token)]);
  await c.query(`UPDATE bansir.pdv_terminals SET ${clientType==='browser'?'device_hash=$2,':''}activation_hash=NULL,activation_expires_at=NULL,activation_recovery=false,paired_at=coalesce(paired_at,now()),updated_at=now() WHERE id=$1`,clientType==='browser'?[row.id,hash(token)]:[row.id]);
  await audit(c,i,row.id,'paired',clientType,provider,clientType);return {data:{id:row.id,name:row.name,token}};
 }));
 app.get('/api/v1/pdv/terminals/capabilities',scoped('sales',true,async()=>({data:{version:1,providers,activationCodeLength:6,clientTypes:['browser','smartpos'],pairingClientTypeDefault:'browser',operatorAuthentication:'bearer',independentBindings:true,remoteChargeCommands:false,structuredAcquirerEvidence:false}})));
 app.post('/api/v1/pdv/terminals/heartbeat',scoped('sales',true,async(c,r)=>{
  await unitLock(c,r.identity);
  const metadata=z.object({acquirerProvider:z.enum(['PAGBANK','MERCADOPAGO','CAIXA','CIELO','REDE']).optional(),appVersion:z.string().max(80).optional(),sdkVersion:z.string().max(80).optional(),plugPagAvailable:z.boolean().optional()}).strict().parse(r.body);
  const terminal=await currentTerminal(c,r.identity);if(!terminal)fail('Vincule o terminal antes de enviar diagnóstico.');
  const updated=(await c.query('UPDATE bansir.pdv_terminal_smartpos SET diagnostics=$2,last_seen_at=now() WHERE terminal_id=$1 AND token_hash=$3 RETURNING last_seen_at',[terminal.id,metadata,hash(r.identity.pdvTerminalToken)])).rows[0];
  if(!updated)fail('Diagnóstico exige vínculo SmartPOS.','SMARTPOS_REQUIRED',403);
  return {data:{id:terminal.id,lastSeenAt:updated.last_seen_at}};
 }));
 app.patch('/api/v1/pdv/terminals/:id',scoped('settings-terminals',false,async(c,r,m)=>{
  admin(m);const {active}=z.object({active:z.boolean()}).strict().parse(r.body),id=z.uuid().parse(r.params.id),i=r.identity;await unitLock(c,i);
  if(!(await c.query('SELECT 1 FROM bansir.pdv_terminals WHERE id=$1 FOR UPDATE',[id])).rowCount)fail('Terminal não encontrado.','NOT_FOUND',404);
  if((await c.query('SELECT 1 FROM bansir.cash_sessions WHERE terminal_id=$1 AND closed_at IS NULL',[id])).rowCount)fail('Feche o caixa antes de desativar o terminal.','TERMINAL_BUSY');
  await c.query('UPDATE bansir.pdv_terminals SET active=$2,device_hash=NULL,smartpos_hash=NULL,activation_hash=NULL,activation_expires_at=NULL,updated_at=now() WHERE id=$1',[id,active]);
  const revoked=(await c.query('DELETE FROM bansir.pdv_terminal_smartpos WHERE terminal_id=$1 RETURNING provider',[id])).rows;for(const item of revoked)await audit(c,i,id,'provider_revoked',active?'Reativação do terminal':'Terminal desativado',item.provider,'smartpos');
  await audit(c,i,id,active?'enabled':'disabled');return {data:{id,active}};
 }));
 app.delete('/api/v1/pdv/terminals/:id/smartpos/:provider',scoped('settings-terminals',false,async(c,r,m)=>{
  if(!['admin','superadmin'].includes(m.role))fail('Somente administradores podem revogar maquininhas.','FORBIDDEN',403);
  const id=z.uuid().parse(r.params.id),provider=z.enum(providers).parse(r.params.provider),i=r.identity;await unitLock(c,i);
  if(!(await c.query('SELECT 1 FROM bansir.pdv_terminals WHERE id=$1',[id])).rowCount)fail('Terminal não encontrado.','NOT_FOUND',404);
  await c.query('DELETE FROM bansir.pdv_terminal_smartpos WHERE terminal_id=$1 AND provider=$2',[id,provider]);await audit(c,i,id,'provider_revoked','',provider,'smartpos');return {data:{id,provider,revoked:true}};
 }));
 app.get('/api/v1/pdv/terminals/events',scoped('settings-terminals',true,async(c,r,m)=>{admin(m);return {data:(await c.query('SELECT e.id,e.terminal_id,t.name AS terminal_name,e.event,e.reason,e.provider,e.client_type,e.created_at,u.name AS user_name FROM bansir.pdv_terminal_events e LEFT JOIN bansir.pdv_terminals t ON (t.tenant_id,t.establishment_id,t.id)=(e.tenant_id,e.establishment_id,e.terminal_id) JOIN bansir.users u ON u.id=e.user_id ORDER BY e.created_at DESC LIMIT 100')).rows};}));
 app.get('/api/v1/pdv/terminals/:id/cash-history',scoped('sales',true,async(c,r,m)=>{
  admin(m);const id=z.uuid().parse(r.params.id);
  if(!(await c.query('SELECT 1 FROM bansir.pdv_terminals WHERE id=$1',[id])).rowCount)fail('Terminal não encontrado.','NOT_FOUND',404);
  return {data:(await c.query('SELECT c.id,c.user_id,u.name AS operator_name,c.terminal_name,c.opened_at,c.closed_at,c.opening_cents,c.counted_cents,c.difference_cents FROM bansir.cash_sessions c JOIN bansir.users u ON u.id=c.user_id WHERE c.terminal_id=$1 ORDER BY c.opened_at DESC LIMIT 50',[id])).rows};
 }));
}
