import {z} from 'zod';
import {XMLParser} from 'fast-xml-parser';
import rateLimit from 'express-rate-limit';
import {httpError} from './database.js';
import {unseal,secretContext} from './secrets.js';
import {runWizard} from './fiscal.worker.js';
import {ufCodes} from './fiscal.js';
export function validCnpj(v){if(!/^\d{14}$/.test(v)||/^(\d)\1+$/.test(v))return false;for(let end=12;end<14;end++){let sum=0;for(let i=0;i<end;i++)sum+=Number(v[i])*((end-i-1)%8+2);const digit=sum%11<2?0:11-sum%11;if(Number(v[end])!==digit)return false;}return true;}
export function supplierFromCadastre(result,cnpj){
 const records=[],statuses=[];const parser=new XMLParser({removeNSPrefix:true,parseTagValue:false,ignoreAttributes:false});
 function walk(v,depth=0){if(depth>18)return;if(typeof v==='string'&&v.trim().startsWith('<')){if(v.length>2000000)return;walk(parser.parse(v),depth+1);}else if(v&&typeof v==='object'){if(v.cStat!=null)statuses.push(String(v.cStat));if(v.xNome&&String(v.CNPJ||v.CNPJCPF||'').replace(/\D/g,'')===cnpj)records.push(v);for(const x of Object.values(v))walk(x,depth+1);}}
 walk(result);
 if(statuses.some(status=>!['111','112','258'].includes(status)))throw httpError(503,'A SEFAZ não concluiu a consulta cadastral. Tente mais tarde ou preencha manualmente.','CNPJ_LOOKUP_UNAVAILABLE');
 if(!records.length)throw httpError(404,'CNPJ não localizado no cadastro da SEFAZ desta UF. Confira a UF ou preencha manualmente.','CNPJ_NOT_FOUND');
 const unique=[...new Map(records.map(r=>[String(r.IE||''),r])).values()];if(unique.length!==1)throw httpError(409,'A SEFAZ retornou mais de uma inscrição estadual. Confira o cadastro e informe a IE manualmente.','CNPJ_MULTIPLE_REGISTRATIONS');
 const r=unique[0],a=r.ender||r.enderEmit||{},clean=v=>String(v??'').slice(0,200);
 return {document:cnpj,name:clean(r.xNome),tradeName:clean(r.xFant),stateRegistration:clean(r.IE),phone:clean(a.fone),address:{street:clean(a.xLgr),number:clean(a.nro),complement:clean(a.xCpl),neighborhood:clean(a.xBairro),city:clean(a.xMun),state:clean(a.UF||r.UF),zipCode:clean(a.CEP)},registrationStatus:String(r.cSit||''),source:'SEFAZ'};
}
export function mountSupplierCnpj(app,{scoped,wizard=runWizard}){
 app.post('/api/v1/suppliers/cnpj/lookup',rateLimit({windowMs:60000,limit:6,standardHeaders:'draft-7',legacyHeaders:false,handler:(_q,res)=>res.status(429).json({success:false,code:'CNPJ_RATE_LIMITED',message:'Aguarde um minuto antes de consultar novamente.'})}),scoped('suppliers',false,async(c,r)=>{
 const input=z.object({cnpj:z.string().regex(/^\d{14}$/).refine(validCnpj,'CNPJ inválido.'),uf:z.enum(Object.keys(ufCodes))}).strict().parse(r.body);
 const cfg=(await c.query('SELECT data FROM bansir.fiscal_settings')).rows[0],cert=(await c.query('SELECT encrypted_bundle,cnpj,active,valid_until FROM bansir.fiscal_certificates')).rows[0];if(!cfg||!cert?.active||cert.cnpj!==cfg.data.cnpj||new Date(cert.valid_until)<=new Date())throw httpError(409,'Configure um certificado A1 válido da loja para consultar a SEFAZ. O cadastro manual continua disponível.','CERTIFICATE_REQUIRED');
 let response;try{response=await wizard({action:'cadastre',model:'55',payload:input,settings:{...cfg.data,environment:1},certificate:unseal(cert.encrypted_bundle,secretContext(r.identity,'certificate')),csc:''});}catch{throw httpError(503,'Não foi possível consultar o cadastro da SEFAZ. Confira a UF ou tente mais tarde. Você pode preencher manualmente.','CNPJ_LOOKUP_UNAVAILABLE');}
 const data=supplierFromCadastre(response.result,input.cnpj);if(!data.address.state)data.address.state=input.uf;return {data};
 }));
}
