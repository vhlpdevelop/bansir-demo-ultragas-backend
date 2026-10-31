import {z} from 'zod';
import {XMLParser} from 'fast-xml-parser';
import {httpError} from './database.js';
import {enqueue} from './queue.js';
import {unseal,secretContext} from './secrets.js';
export function cancellationEvidence(result,key,environment){
 const parser=new XMLParser({removeNSPrefix:true,parseTagValue:false});let accepted=null,rejection=null;
 function walk(v,depth=0){if(depth>25||v==null)return;if(typeof v==='string'&&v.trim().startsWith('<')){try{walk(parser.parse(v),depth+1);}catch{}return;}if(typeof v!=='object')return;
  if(String(v.chNFe)===key&&Number(v.tpAmb)===environment&&String(v.tpEvento)==='110111'&&Number(v.nSeqEvento)===1){if(['135','155'].includes(String(v.cStat))&&/^\d{10,20}$/.test(String(v.nProt)))accepted=String(v.nProt);else if(v.cStat)rejection=String(v.cStat);}
  for(const child of Object.values(v))walk(child,depth+1);
 }walk(result);return {accepted,rejection};
}
export function mountFiscalCancellation(app,{scoped}){
 app.get('/api/v1/fiscal/documents/:id/cancellation',scoped('fiscal',true,async(c,req)=>({data:(await c.query('SELECT status,protocol,return_code,reason,created_at FROM bansir.fiscal_cancellations WHERE document_id=$1',[z.uuid().parse(req.params.id)])).rows[0]||null})));
 app.post('/api/v1/fiscal/documents/:id/cancellation',scoped('fiscal',false,async(c,req)=>{
  const id=z.uuid().parse(req.params.id),input=z.object({requestKey:z.uuid(),reason:z.string().trim().min(15).max(255)}).strict().parse(req.body),i=req.identity;
  const doc=(await c.query('SELECT * FROM bansir.fiscal_documents WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!doc)throw httpError(404,'Documento não encontrado.','NOT_FOUND');
  const existing=(await c.query('SELECT status,protocol,request_key,reason FROM bansir.fiscal_cancellations WHERE document_id=$1',[id])).rows[0];
  if(existing){if(existing.request_key!==input.requestKey||existing.reason!==input.reason)throw httpError(409,'Já existe solicitação de cancelamento para esta nota. Consulte a situação.','CANCELLATION_EXISTS');return {data:existing};}
  if(doc.status!=='authorized'||!doc.protocol)throw httpError(409,'Somente documento autorizado pode ser cancelado.','FISCAL_NOT_AUTHORIZED');
  const ide=doc.payload.request.NFe.infNFe.ide,key=doc.access_key;
  const payload={idLote:1,evento:[{cOrgao:Number(key.slice(0,2)),tpAmb:doc.environment,CNPJ:key.slice(6,20),chNFe:key,dhEvento:new Date().toISOString(),tpEvento:'110111',nSeqEvento:1,verEvento:'1.00',detEvento:{descEvento:'Cancelamento',nProt:doc.protocol,xJust:input.reason}}]};
  if(![55,65].includes(Number(ide.mod)))throw httpError(409,'Modelo fiscal não suportado.','FISCAL_MODEL_INVALID');
  await c.query('INSERT INTO bansir.fiscal_cancellations(tenant_id,establishment_id,document_id,request_key,reason,event_payload,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[i.tenantId,i.establishmentId,id,input.requestKey,input.reason,payload,i.userId]);
  await enqueue(c,i,{kind:'fiscal',key:'cancel:'+id,payload:{documentId:id,userId:i.userId,action:'cancel'}});return {status:202,data:{status:'queued'}};
 }));
}
export async function processFiscalCancellation(queue,job,{wizard}){
 const snapshot=await queue.scope(job,async c=>{
  const doc=(await c.query('SELECT * FROM bansir.fiscal_documents WHERE id=$1 FOR UPDATE',[job.payload.documentId])).rows[0],cancel=(await c.query('SELECT * FROM bansir.fiscal_cancellations WHERE document_id=$1 FOR UPDATE',[job.payload.documentId])).rows[0];
  if(!doc||!cancel)throw Object.assign(new Error('CANCELLATION_NOT_FOUND'),{terminal:true});
  if(['accepted','rejected','manual_review'].includes(cancel.status))return {done:true};
  const action=cancel.status==='queued'?'cancel':'consult';
  const cert=(await c.query('SELECT * FROM bansir.fiscal_certificates')).rows[0],cfg=(await c.query('SELECT * FROM bansir.fiscal_settings')).rows[0];
  const allowed=(await c.query('SELECT bansir.fiscal_emitter_active($1,$2,$3) AS allowed',[job.tenant_id,job.establishment_id,cancel.requested_by])).rows[0]?.allowed;
  if(!allowed||!cert?.active||!cfg||cert.cnpj!==doc.access_key.slice(6,20)||new Date(cert.valid_until)<=new Date()||(doc.environment===1&&process.env.FISCAL_PRODUCTION_ENABLED!=='true'))throw Object.assign(new Error('CANCELLATION_NOT_READY'),{terminal:true});
  await c.query("UPDATE bansir.fiscal_cancellations SET status='submitting',updated_at=now() WHERE document_id=$1",[doc.id]);
  const scope={tenantId:job.tenant_id,establishmentId:job.establishment_id};return {doc,cancel,action,certificate:unseal(cert.encrypted_bundle,secretContext(scope,'certificate')),settings:{...cfg.data,environment:doc.environment},csc:unseal(cfg.encrypted_csc,secretContext(scope,'csc'))};
 });
 if(snapshot.done)return;
 let data;
 try{data=await wizard({action:snapshot.action,model:snapshot.doc.access_key.slice(20,22),key:snapshot.doc.access_key,payload:snapshot.cancel.event_payload,settings:snapshot.settings,certificate:snapshot.certificate,csc:snapshot.csc});}
 catch{await queue.scope(job,c=>c.query("UPDATE bansir.fiscal_cancellations SET status='unknown',updated_at=now() WHERE document_id=$1",[snapshot.doc.id]));throw new Error('CANCELLATION_CONSULT_REQUIRED');}
 const evidence=cancellationEvidence(data.result,snapshot.doc.access_key,snapshot.doc.environment),status=evidence.accepted?'accepted':snapshot.action==='consult'?'manual_review':evidence.rejection&&evidence.rejection!=='573'?'rejected':'unknown';
 await queue.scope(job,async c=>{await c.query('UPDATE bansir.fiscal_cancellations SET status=$2,protocol=$3,return_code=$4,response_data=$5,updated_at=now() WHERE document_id=$1',[snapshot.doc.id,status,evidence.accepted,evidence.rejection,JSON.stringify({key:snapshot.doc.access_key,environment:snapshot.doc.environment,event:'110111',sequence:1,protocol:evidence.accepted,returnCode:evidence.rejection,xml:data.xml||null})]);if(status==='accepted')await c.query("UPDATE bansir.fiscal_documents SET status='cancelled',updated_at=now() WHERE id=$1",[snapshot.doc.id]);await c.query('SELECT bansir.notify_fiscal($1,$2,$3)',['cancel:'+snapshot.doc.id+':'+status,status==='accepted'?'Nota fiscal cancelada':'Cancelamento fiscal precisa de atenção','Consulte o cancelamento em Minha Empresa → Fiscal. O estoque e os pagamentos não são estornados por este evento.']);});
 if(status==='unknown')throw new Error('CANCELLATION_CONSULT_REQUIRED');
}
