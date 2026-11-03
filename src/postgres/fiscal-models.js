import {z} from 'zod';
import {httpError} from './database.js';

export const fiscalModel=z.enum(['55','65']).default('65');
const ufs={RO:11,AC:12,AM:13,RR:14,PA:15,AP:16,TO:17,MA:21,PI:22,CE:23,RN:24,PB:25,PE:26,AL:27,SE:28,BA:29,MG:31,ES:32,RJ:33,SP:35,PR:41,SC:42,RS:43,MS:50,MT:51,GO:52,DF:53};
function validDocument(value){
 if(/^(\d)\1+$/.test(value))return false;
 const digits=[...value].map(Number),length=value.length===11?9:12;
 for(let end=length;end<length+2;end++){
  let sum=0;for(let i=0;i<end;i++)sum+=digits[i]*(length===9?end+1-i:((end-i-1)%8)+2);
  const remainder=sum%11,expected=remainder<2?0:11-remainder;if(digits[end]!==expected)return false;
 }return true;
}
const text=z.string().trim().min(1).max(60);
export const nfeRecipient=z.object({
 CNPJCPF:z.string().regex(/^(\d{11}|\d{14})$/).refine(validDocument,'CPF/CNPJ do destinatário inválido.'),xNome:text,
 email:z.email().max(254).optional(),indIEDest:z.number().int().refine(v=>[1,2,9].includes(v)),IE:z.string().regex(/^\d{2,14}$/).optional(),
 enderDest:z.object({xLgr:text,nro:z.string().trim().min(1).max(20),xBairro:text,cMun:z.string().regex(/^\d{7}$/),xMun:text,UF:z.enum(Object.keys(ufs)),CEP:z.string().regex(/^\d{8}$/),fone:z.string().regex(/^\d{6,14}$/).optional(),cPais:z.literal(1058).default(1058),xPais:z.literal('BRASIL').default('BRASIL')}).strict()
}).strict().superRefine((d,c)=>{
 if(d.indIEDest===1&&!d.IE)c.addIssue({code:'custom',message:'Informe a inscrição estadual do destinatário contribuinte.'});
 if(d.indIEDest!==1&&d.IE)c.addIssue({code:'custom',message:'Inscrição estadual incompatível com a indicação de contribuinte.'});
 if(!d.enderDest.cMun.startsWith(String(ufs[d.enderDest.UF])))c.addIssue({code:'custom',message:'Código IBGE do destinatário incompatível com a UF.'});
});
export const fiscalOperation=z.object({finalConsumer:z.boolean().default(true),presence:z.number().int().refine(v=>[0,1,2,3,5,9].includes(v)).default(1)}).strict().default({finalConsumer:true,presence:1});
export function validateNfeDraft(draft,issuer){
 const recipient=nfeRecipient.parse(draft.dest);
 const interstate=recipient.enderDest.UF!==issuer.address.uf;
 if(draft.det.some(d=>!d.prod.CFOP.startsWith(interstate?'6':'5')))throw httpError(400,'CFOP deve corresponder à operação interna ou interestadual e ser conferido pela contabilidade.','FISCAL_CFOP_DESTINATION');
 return {recipient,idDest:interstate?2:1};
}
