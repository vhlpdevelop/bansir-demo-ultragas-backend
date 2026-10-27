import {fork} from 'node:child_process';
import {XMLParser} from 'fast-xml-parser';
import {S3Client,PutObjectCommand} from '@aws-sdk/client-s3';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {unseal,secretContext} from './secrets.js';
import {configurationVersion} from './fiscal.js';

export async function runWizard(message) {
 const workDirectory=await mkdtemp(join(tmpdir(),'bansir-fiscal-'));
 try{return await new Promise((resolve,reject)=>{
  // Secrets travel through IPC, never argv/env/logs. Library globals are isolated per job.
  const child=fork(new URL('./wizard.runner.js',import.meta.url),[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV,TMPDIR:process.env.TMPDIR}});
  let settled=false,response,failure;
  const finish=()=>{
   if(settled)return;settled=true;clearTimeout(timer);
   if(failure || !response)reject(new Error(failure||'WIZARD_UNCERTAIN'));
   else if(response.ok)resolve(response.data);
   else reject(new Error(response.stage==='setup'?'WIZARD_SETUP_FAILED':'WIZARD_UNCERTAIN'));
  };
  const timer=setTimeout(()=>{failure='WIZARD_TIMEOUT';child.kill('SIGKILL');},90000);
  child.once('message',msg=>{response=msg;});
  // Wait for exit before touching certificate files (Windows also locks open files).
  child.once('error',()=>{failure='WIZARD_START_FAILED';finish();});child.once('exit',finish);
  child.send({...message,workDirectory},err=>{if(err){failure='WIZARD_IPC_FAILED';child.kill('SIGKILL');}});
 });}finally{await rm(workDirectory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
const parser=new XMLParser({removeNSPrefix:true,parseTagValue:false,ignoreAttributes:false});
export function fiscalEvidence(data,key,environment) {
 let protocol,rejection;
 function walk(value,depth=0){
  if(depth>30 || value==null)return;
  if(typeof value==='string' && value.trim().startsWith('<')){try{walk(parser.parse(value),depth+1);}catch{}return;}
  if(typeof value!=='object')return;
  if(String(value.chNFe)===key && Number(value.tpAmb)===environment && ['100','150'].includes(String(value.cStat)) && /^\d{10,20}$/.test(String(value.nProt)))protocol=String(value.nProt);
  if(String(value.chNFe)===key && Number(value.tpAmb)===environment && !['100','150'].includes(String(value.cStat)) && /^\d{3,4}$/.test(String(value.cStat)))rejection=String(value.cStat);
  for(const child of Object.values(value))walk(child,depth+1);
 }
 walk(data.result);
 let xml=null;
 if(data.xml){try{const parsed=parser.parse(data.xml);const proc=parsed.nfeProc;const p=proc?.protNFe?.infProt;const n=proc?.NFe?.infNFe;
  if(n?.['@_Id']===`NFe${key}` && String(p?.chNFe)===key && Number(p?.tpAmb)===environment && ['100','150'].includes(String(p?.cStat)) && p?.nProt){protocol=String(p.nProt);xml=data.xml;}
 }catch{}}
 return {protocol,xml,rejection};
}
export async function storeXml(job,doc,send) {
 const s3=new S3Client({region:process.env.AWS_REGION || 'sa-east-1',requestHandler:{requestTimeout:20000,connectionTimeout:5000}});
 const key=`tenants/${job.tenant_id}/establishments/${job.establishment_id}/fiscal/${doc.environment}/${doc.access_key}.xml`;
 const command=new PutObjectCommand({Bucket:process.env.FISCAL_S3_BUCKET,Key:key,Body:doc.xml,ContentType:'application/xml',ServerSideEncryption:process.env.FISCAL_S3_KMS_KEY_ID?'aws:kms':'AES256',...(process.env.FISCAL_S3_KMS_KEY_ID?{SSEKMSKeyId:process.env.FISCAL_S3_KMS_KEY_ID}:{})});
 try{await (send?send(command):s3.send(command));}finally{s3.destroy();}return key;
}
export async function processFiscal(queue,job,{wizard=runWizard,upload=storeXml}={}) {
 const scope={tenantId:job.tenant_id,establishmentId:job.establishment_id};
 let snapshot=await queue.scope(job,async c=>{
  const doc=(await c.query('SELECT * FROM bansir.fiscal_documents WHERE id=$1 FOR UPDATE',[job.payload.documentId])).rows[0];
  if(!doc)throw Object.assign(new Error('DOCUMENT_NOT_FOUND'),{terminal:true});
  if(['rejected','manual_review'].includes(doc.status))return {doc};
  if(doc.status==='authorized')return {doc};
  const cfg=(await c.query('SELECT * FROM bansir.fiscal_settings')).rows[0];
  const cert=(await c.query('SELECT * FROM bansir.fiscal_certificates')).rows[0];
  if(!cfg || !cert || new Date(cert.valid_until)<=new Date())throw Object.assign(new Error('CERTIFICATE_UNAVAILABLE'),{terminal:true});
  if(doc.environment===1 && process.env.FISCAL_PRODUCTION_ENABLED!=='true')throw Object.assign(new Error('PRODUCTION_DISABLED'),{terminal:true});
  const action=doc.status==='queued'?'emit':'consult';
  if(action==='emit'){
   const allowed=(await c.query('SELECT bansir.fiscal_emitter_active($1,$2,$3) AS allowed',[job.tenant_id,job.establishment_id,job.payload.userId])).rows[0].allowed;
   if(!allowed){await c.query("UPDATE bansir.fiscal_documents SET status='manual_review',rejection_code='EMITTER_ACCESS_REVOKED',updated_at=now() WHERE id=$1",[doc.id]);return {doc:{...doc,status:'manual_review'}};}
  }
  if(action==='emit' && (doc.configuration_version!==configurationVersion(cfg) || doc.certificate_fingerprint!==cert.fingerprint)){
   await c.query("UPDATE bansir.fiscal_documents SET status='manual_review',rejection_code='CONFIGURATION_CHANGED',updated_at=now() WHERE id=$1",[doc.id]);return {doc:{...doc,status:'manual_review'}};
  }
  if(action==='emit')await c.query("UPDATE bansir.fiscal_documents SET status='submitting',updated_at=now() WHERE id=$1",[doc.id]);
  return {doc,action,settings:{...cfg.data,environment:doc.environment},certificate:unseal(cert.encrypted_bundle,secretContext(scope,'certificate')),csc:unseal(cfg.encrypted_csc,secretContext(scope,'csc'))};
 });
 let {doc}=snapshot;
 if(['rejected','manual_review'].includes(doc.status))return;
 if(doc.status!=='authorized'){
  let data;
  try{data=await wizard({action:snapshot.action,model:'65',key:doc.access_key,payload:doc.payload.request,settings:snapshot.settings,certificate:snapshot.certificate,csc:snapshot.csc});}
  catch{
   await queue.scope(job,c=>c.query("UPDATE bansir.fiscal_documents SET status='unknown',updated_at=now() WHERE id=$1",[doc.id]));throw new Error('FISCAL_CONSULT_REQUIRED');
  }
  const evidence=fiscalEvidence(data,doc.access_key,doc.environment);
  const status=evidence.protocol?'authorized':evidence.rejection?(snapshot.action==='consult'?'manual_review':'rejected'):'unknown';
  doc=await queue.scope(job,async c=>(await c.query(`UPDATE bansir.fiscal_documents SET status=$2,protocol=$3,xml=$4,rejection_code=$5,updated_at=now() WHERE id=$1 RETURNING *`,[doc.id,status,evidence.protocol||null,evidence.xml,evidence.rejection||null])).rows[0]);
  if(status==='unknown')throw new Error('FISCAL_CONSULT_REQUIRED');
  if(status!=='authorized')return;
 }
 if(!doc.xml)throw Object.assign(new Error('XML_RECOVERY_REQUIRED'),{terminal:true});
 // Save authorized XML in PostgreSQL before uploading. A failed S3 upload retries only storage.
 if(!doc.s3_key){const key=await upload(job,doc);await queue.scope(job,c=>c.query('UPDATE bansir.fiscal_documents SET s3_key=$2,updated_at=now() WHERE id=$1',[doc.id,key]));}
}
