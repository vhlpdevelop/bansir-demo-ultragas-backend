import {createHash,createPrivateKey,createSign,X509Certificate} from 'node:crypto';
import {z} from 'zod';
import {httpError} from './database.js';
const grants=new Map(),scope=i=>[i.tenantId,i.establishmentId,i.userId].join('/'),hash=v=>createHash('sha256').update(v).digest('hex');
export function grantPrint(i,pdf){for(const [k,expiry] of grants)if(expiry<Date.now())grants.delete(k);if(grants.size>2000)grants.delete(grants.keys().next().value);grants.set(scope(i)+':'+hash(pdf.toString('base64')),Date.now()+300000);}
export function signingConfig(env=process.env){
 if(!env.QZ_SIGNING_CERTIFICATE_BASE64||!env.QZ_SIGNING_PRIVATE_KEY_BASE64)return null;
 const certificate=Buffer.from(env.QZ_SIGNING_CERTIFICATE_BASE64,'base64').toString(),cert=new X509Certificate(certificate),key=createPrivateKey(Buffer.from(env.QZ_SIGNING_PRIVATE_KEY_BASE64,'base64'));
 if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails?.modulusLength<2048||!cert.checkPrivateKey(key)||Date.parse(cert.validTo)<=Date.now()||Date.parse(cert.validFrom)>Date.now())return null;
 return {certificate,key};
}
export function signQz(identity,body,config){
 if(!config)throw httpError(503,'Assinatura QZ ainda não configurada no servidor.','QZ_NOT_READY');
 const {message,digest}=z.object({message:z.string().max(450000),digest:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(body);
 if(hash(message)!==digest)throw httpError(400,'Resumo de impressão inválido.','INVALID_PRINT');
 let command;try{command=JSON.parse(message);}catch{throw httpError(400,'Comando inválido.','INVALID_PRINT');}
 if(!Number.isFinite(command.timestamp)||Math.abs(Date.now()-command.timestamp)>60000)throw httpError(400,'Solicitação expirada. Confira o relógio do caixa.','PRINT_EXPIRED');
 if(command.call==='print'){
  const p=command.params,d=p?.data;
  if(!p?.printer?.name||Object.keys(p.printer).some(k=>k!=='name')||typeof p.printer.name!=='string'||p.printer.name.length>200||p.options?.copies!==1||!Array.isArray(d)||d.length!==1||d[0].type!=='pixel'||d[0].format!=='pdf'||d[0].flavor!=='base64'||typeof d[0].data!=='string'||(grants.get(scope(identity)+':'+hash(d[0].data))||0)<Date.now())throw httpError(403,'Documento não liberado para impressão nesta sessão. Abra o recibo novamente.','PRINT_DENIED');
 }else if(!['printers.find','printers.getStatus','printers.startListening','printers.stopListening'].includes(command.call)||JSON.stringify(command.params||{}).length>5000)throw httpError(403,'Comando de impressão não permitido.','PRINT_DENIED');
 const signer=createSign('RSA-SHA512');signer.update(digest);return signer.sign(config.key,'base64');
}
export function mountQzSigning(app,{scoped}){
 app.get('/api/v1/printing/qz',scoped('sales',true,async()=>{let config;try{config=signingConfig();}catch{}return {data:{configured:!!config,certificate:config?.certificate||null}};}));
 app.post('/api/v1/printing/qz/sign',scoped('sales',true,async(c,req)=>{let config;try{config=signingConfig();}catch{}return {data:{signature:signQz(req.identity,req.body,config)}};}));
}
