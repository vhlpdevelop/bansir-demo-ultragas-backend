import {z} from 'zod';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {httpError} from './database.js';
import {currentTerminal,assertCashTerminal} from './pdv-terminals.js';
import {expireSmartpos,assertNoSmartpos} from './smartpos-state.js';
import {ownedSale,saleView,lockSmartposSale,settleSmartpos} from './sales.js';
import {fiscalDraftHash} from './fiscal.js';
import {enqueueNotification} from './notifications.js';

const sha=v=>createHash('sha256').update(v).digest('hex');
export const smartposProviders=z.enum(['pagbank','mercadopago','caixa']);
const chargeInput=z.object({requestKey:z.uuid(),provider:smartposProviders,method:z.enum(['credit_card','debit_card','pix']),amountCents:z.number().int().min(1).max(1000000000),installments:z.number().int().min(1).max(24).default(1)}).strict();
const fail=(message,code='SMARTPOS_INVALID',status=409)=>{throw httpError(status,message,code);};
const view=r=>({id:r.id,saleId:r.sale_id,terminalId:r.terminal_id,provider:r.provider,method:r.method,amountCents:Number(r.amount_cents),installments:r.installments,status:r.status,createdAt:r.created_at,expiresAt:r.expires_at,result:r.result||null});

async function device(c,i){
 await c.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[`pdv-terminals:${i.tenantId}:${i.establishmentId}`]);
 if(!/^pdvt_[A-Za-z0-9_-]{43}$/.test(i.pdvTerminalToken||''))fail('Vincule esta maquininha ao caixa.','SMARTPOS_REQUIRED',403);
 const r=(await c.query('SELECT s.*,t.name FROM bansir.pdv_terminal_smartpos s JOIN bansir.pdv_terminals t ON(t.tenant_id,t.establishment_id,t.id)=(s.tenant_id,s.establishment_id,s.terminal_id) WHERE s.token_hash=$1 AND t.active FOR SHARE OF t',[sha(i.pdvTerminalToken)])).rows[0];
 if(!r)fail('Vínculo SmartPOS revogado ou indisponível.','SMARTPOS_REQUIRED',403);return r;
}
export async function createSmartposCharge(c,i,member,saleId,body){
 const input=chargeInput.parse(body),fingerprint=fiscalDraftHash({...input,userId:i.userId});
 if(input.method!=='credit_card'&&input.installments!==1)fail('Parcelas são permitidas somente no crédito.');
 const terminal=await currentTerminal(c,i);if(!terminal||terminal.client_type!=='browser')fail('Envie a cobrança pelo navegador vinculado ao caixa.','BROWSER_TERMINAL_REQUIRED',403);
 await lockSmartposSale(c,i,saleId);
 const sale=await ownedSale(c,i,member,saleId),previous=(await c.query('SELECT * FROM bansir.smartpos_charges WHERE request_key=$1',[input.requestKey])).rows[0];
 if(previous){if(previous.sale_id!==sale.id||previous.request_hash!==fingerprint)fail('Solicitação já utilizada com outros dados.','IDEMPOTENCY_CONFLICT');return view(previous);}
 const state=await saleView(c,saleId),cash=(await c.query('SELECT * FROM bansir.cash_sessions WHERE user_id=$1 AND closed_at IS NULL',[i.userId])).rows[0];
 if(!cash)fail('Abra seu caixa neste navegador para receber a venda.','CASH_CLOSED');assertCashTerminal(cash,terminal);
 if(state.status==='cancelled'||input.amountCents>state.outstanding_cents)fail('Valor supera o saldo disponível da venda.','PAYMENT_EXCEEDS_BALANCE');
 await expireSmartpos(c);await assertNoSmartpos(c,{saleId});
 const pos=(await c.query('SELECT * FROM bansir.pdv_terminal_smartpos WHERE terminal_id=$1 AND provider=$2 FOR UPDATE',[terminal.id,input.provider])).rows[0];
 if(!pos||pos.diagnostics?.remoteChargeVersion!==1||pos.diagnostics?.paymentSdkAvailable!==true||pos.diagnostics?.acquirerProvider!==input.provider.toUpperCase()||!pos.last_seen_at||Date.now()-new Date(pos.last_seen_at).getTime()>45000)fail('Maquininha desconectada ou APK sem suporte à cobrança remota.','SMARTPOS_NOT_READY');
 if(input.method==='pix'&&(!pos.pix_enabled||pos.diagnostics?.pixSdkAvailable!==true))fail('PIX na maquininha não está habilitado ou disponível no SDK.','SMARTPOS_PIX_DISABLED');
 await assertNoSmartpos(c,{terminalId:terminal.id,provider:input.provider});
 const r=(await c.query(`INSERT INTO bansir.smartpos_charges(tenant_id,establishment_id,request_key,request_hash,sale_id,cash_session_id,terminal_id,provider,device_hash,requested_by,amount_cents,method,installments)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[i.tenantId,i.establishmentId,input.requestKey,fingerprint,saleId,cash.id,terminal.id,input.provider,pos.token_hash,i.userId,input.amountCents,input.method,input.installments])).rows[0];
 return view(r);
}
export function mountSmartpos(app,{scoped,secret}){
 const executionToken=r=>createHmac('sha256',secret).update(JSON.stringify(['smartpos-execution',r.id,r.device_hash,r.claim_request_key])).digest('hex');
 app.get('/api/v1/pdv/smartpos/devices',scoped('sales',true,async(c,r)=>{
  const t=await currentTerminal(c,r.identity);if(!t||t.client_type!=='browser')return {data:[]};
  return {data:(await c.query("SELECT provider,pix_enabled,last_seen_at,diagnostics,coalesce(diagnostics->>'remoteChargeVersion','0') AS version FROM bansir.pdv_terminal_smartpos WHERE terminal_id=$1 ORDER BY provider",[t.id])).rows.map(d=>({provider:d.provider,pixEnabled:d.pix_enabled,pixReady:d.pix_enabled&&d.diagnostics?.pixSdkAvailable===true,lastSeenAt:d.last_seen_at,ready:d.version==='1'&&d.diagnostics?.paymentSdkAvailable===true&&d.diagnostics?.acquirerProvider===d.provider.toUpperCase()&&d.last_seen_at&&Date.now()-new Date(d.last_seen_at).getTime()<45000}))};
 }));
 app.post('/api/v1/sales/:id/smartpos',scoped('sales',false,async(c,r,m)=>({status:202,data:await createSmartposCharge(c,r.identity,m,z.uuid().parse(r.params.id),r.body)})));
 app.get('/api/v1/sales/:id/smartpos',scoped('sales',true,async(c,r,m)=>{const id=z.uuid().parse(r.params.id);await ownedSale(c,r.identity,m,id);await expireSmartpos(c);return {data:(await c.query('SELECT * FROM bansir.smartpos_charges WHERE sale_id=$1 ORDER BY created_at DESC LIMIT 20',[id])).rows.map(view)};}));
 app.post('/api/v1/smartpos/commands/next',scoped('sales',false,async(c,r)=>{
  const {requestKey}=z.object({requestKey:z.uuid()}).strict().parse(r.body),d=await device(c,r.identity);await expireSmartpos(c);
  let command=(await c.query('SELECT * FROM bansir.smartpos_charges WHERE device_hash=$1 AND claim_request_key=$2 FOR UPDATE',[d.token_hash,requestKey])).rows[0];
  if(!command){command=(await c.query("SELECT * FROM bansir.smartpos_charges WHERE device_hash=$1 AND status='queued' AND expires_at>now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",[d.token_hash])).rows[0];
   if(command)command=(await c.query("UPDATE bansir.smartpos_charges SET status='executing',claim_request_key=$2,claimed_by=$3,claimed_at=now(),expires_at=now()+interval '3 minutes',updated_at=now() WHERE id=$1 RETURNING *",[command.id,requestKey,r.identity.userId])).rows[0];}
  await c.query('UPDATE bansir.pdv_terminal_smartpos SET last_seen_at=now() WHERE token_hash=$1',[d.token_hash]);
  if(!command)return {data:null};
  return {data:{...view(command),merchantReference:command.id,executionToken:executionToken(command),saleNumber:(await saleView(c,command.sale_id)).saleNumber}};
 }));
 app.post('/api/v1/smartpos/commands/:id/result',scoped('sales',false,async(c,r)=>{
  const input=z.object({executionToken:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(['approved','declined','cancelled','unknown']),provider:smartposProviders,method:z.enum(['credit_card','debit_card','pix']),amountCents:z.number().int().positive(),installments:z.number().int().min(1).max(24),transactionId:z.string().trim().min(1).max(120).optional(),nsu:z.string().trim().min(1).max(100).optional(),authorizationCode:z.string().trim().min(1).max(100).optional(),acquirerCnpj:z.string().regex(/^\d{14}$/).optional(),brandCode:z.string().regex(/^\d{2}$/).optional(),responseCode:z.string().trim().max(40).optional(),message:z.string().trim().max(240).optional()}).strict().parse(r.body);
  const id=z.uuid().parse(r.params.id),d=await device(c,r.identity),first=(await c.query('SELECT * FROM bansir.smartpos_charges WHERE id=$1 AND device_hash=$2',[id,d.token_hash])).rows[0];if(!first)fail('Cobrança não encontrada.','NOT_FOUND',404);
  await lockSmartposSale(c,{...r.identity,userId:first.requested_by},first.sale_id);
  const command=(await c.query('SELECT * FROM bansir.smartpos_charges WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!command.claim_request_key||!timingSafeEqual(Buffer.from(executionToken(command),'hex'),Buffer.from(input.executionToken,'hex')))fail('Comprovante de execução inválido.','INVALID_EXECUTION',403);
  if(input.provider!==command.provider||input.method!==command.method||input.amountCents!==Number(command.amount_cents)||input.installments!==command.installments)fail('O resultado não corresponde à cobrança.','SMARTPOS_RESULT_MISMATCH');
  const {executionToken:ignored,...evidence}=input,fingerprint=fiscalDraftHash(evidence);
  if(['approved','approved_review','declined','cancelled','expired'].includes(command.status)){if(command.result_hash!==fingerprint)fail('A cobrança já tem outro resultado definitivo.','IDEMPOTENCY_CONFLICT');return {data:view(command)};}
  if(!['executing','unknown'].includes(command.status))fail('Cobrança não está em execução.');
  if(input.status==='approved'&&(!input.transactionId||(input.method!=='pix'&&(!input.nsu||!input.authorizationCode||!input.acquirerCnpj||!input.brandCode))))fail('Aprovação exige transação, NSU, autorização, CNPJ da adquirente e bandeira fiscal.','ACQUIRER_EVIDENCE_REQUIRED',400);
  if(input.transactionId&&(await c.query('SELECT 1 FROM bansir.smartpos_charges WHERE provider=$1 AND provider_transaction_id=$2 AND id<>$3',[d.provider,input.transactionId,id])).rowCount)fail('Transação da adquirente já utilizada.','ACQUIRER_TRANSACTION_REUSED');
  let status=input.status;
  if(status==='approved'){
   const cash=(await c.query('SELECT * FROM bansir.cash_sessions WHERE id=$1 AND closed_at IS NULL',[command.cash_session_id])).rows[0],sale=await saleView(c,command.sale_id);
   if(!cash||sale.status==='cancelled'||sale.outstanding_cents<Number(command.amount_cents))status='approved_review';
   else await settleSmartpos(c,{...r.identity,userId:command.requested_by},command,cash,evidence);
  }
  let updated;try{updated=(await c.query('UPDATE bansir.smartpos_charges SET status=$2,result_hash=$3,result=$4,provider_transaction_id=$5,result_by=$6,updated_at=now() WHERE id=$1 RETURNING *',[id,status,fingerprint,evidence,input.transactionId||null,r.identity.userId])).rows[0];}catch(e){if(e.code==='23505'&&e.constraint==='smartpos_provider_transaction')fail('Transação da adquirente já utilizada.','ACQUIRER_TRANSACTION_REUSED');throw e;}
  await enqueueNotification(c,{...r.identity,userId:command.requested_by},{key:`smartpos:${id}:${status}`,title:status==='approved'?'Pagamento SmartPOS aprovado':'Cobrança SmartPOS atualizada',body:`Cupom ${(await saleView(c,command.sale_id)).saleNumber}: ${status}.`,userId:command.requested_by});return {data:view(updated)};
 }));
 app.post('/api/v1/sales/:saleId/smartpos/:id/cancel',scoped('sales',false,async(c,r,m)=>{
  const saleId=z.uuid().parse(r.params.saleId);await lockSmartposSale(c,r.identity,saleId);await ownedSale(c,r.identity,m,saleId);
  const row=(await c.query('SELECT * FROM bansir.smartpos_charges WHERE id=$1 AND sale_id=$2 FOR UPDATE',[z.uuid().parse(r.params.id),saleId])).rows[0];if(!row)fail('Cobrança não encontrada.','NOT_FOUND',404);
  if(row.status==='cancelled')return {data:view(row)};if(row.status!=='queued')fail('A cobrança já pode ter chegado à adquirente. Confira na SmartPOS; não envie outra cobrança.','SMARTPOS_RESULT_REQUIRED');
  return {data:view((await c.query("UPDATE bansir.smartpos_charges SET status='cancelled',updated_at=now() WHERE id=$1 RETURNING *",[row.id])).rows[0])};
 }));
}
