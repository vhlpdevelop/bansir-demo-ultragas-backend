import {z} from 'zod';
const percent=z.number().finite().min(0).max(100).refine(v=>Math.abs(v*10000-Math.round(v*10000))<0.00001,'Use até quatro casas decimais.');
export const fuelInput=z.object({cProdANP:z.string().regex(/^\d{9}$/),descANP:z.string().trim().min(2).max(95),UFCons:z.enum('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')),pGLP:percent.optional(),pGNn:percent.optional(),pGNi:percent.optional(),vPart:z.number().finite().nonnegative().max(999999999999).refine(v=>Math.abs(v*100-Math.round(v*100))<0.00001,'Valor de partida: use até duas casas decimais.').optional()}).strict().superRefine((v,c)=>{
 if(v.cProdANP==='210203001'&&([v.pGLP,v.pGNn,v.pGNi,v.vPart].some(x=>x===undefined)||Math.abs((v.pGLP||0)+(v.pGNn||0)+(v.pGNi||0)-100)>0.00001))c.addIssue({code:'custom',message:'GLP exige composição pGLP/pGNn/pGNi somando 100% e valor de partida por kg informado pela contabilidade/fornecedor.'});
 if(v.cProdANP!=='210203001'&&[v.pGLP,v.pGNn,v.pGNi,v.vPart].some(x=>x!==undefined))c.addIssue({code:'custom',message:'Campos de composição GLP exigem código ANP 210203001.'});
});
const profile=z.object({cfop:z.string().regex(/^5\d{3}$/),ncm:z.string().regex(/^(\d{8})?$/).optional(),cest:z.string().regex(/^(\d{7})?$/).default(''),tributaryUnit:z.string().trim().min(1).max(6).optional(),tributaryQuantityPerUnit:z.number().positive().max(1000000).optional(),comb:fuelInput.optional(),taxes:z.object({ICMS:z.record(z.string(),z.unknown()),PIS:z.record(z.string(),z.unknown()),COFINS:z.record(z.string(),z.unknown())}).strict()}).strict().refine(p=>!p.taxes.ICMS.ICMS61||!p.comb||(p.tributaryUnit==='KG'&&p.tributaryQuantityPerUnit>0&&typeof p.taxes.ICMS.ICMS61.adRemICMSRet==='number'&&p.taxes.ICMS.ICMS61.adRemICMSRet>=0),'ICMS 61 de combustível exige unidade tributável KG, conversão por unidade e alíquota ad rem configuradas.').refine(p=>p.ncm!=='27111910'||!!p.comb,'Configure o grupo de combustível para o NCM de GLP.');
export const productFiscalInput=z.object({'55':profile.optional(),'65':profile.optional()}).strict().refine(d=>JSON.stringify(d).length<=12000,'Configuração fiscal muito grande.');

export function applyTributaryUnits(draft,sale,model){
 let mass=0,tax=0,hasMono=false;
 draft.det.forEach((d,index)=>{const p=sale.items[index].fiscal_profile?.[model];if(!p)return;
 if(p.tributaryUnit&&p.tributaryQuantityPerUnit){d.prod.uTrib=p.tributaryUnit;d.prod.qTrib=Number((d.prod.qCom*p.tributaryQuantityPerUnit).toFixed(6));d.prod.vUnTrib=Number((d.prod.vProd/d.prod.qTrib).toFixed(10));}
 const mono=d.imposto.ICMS?.ICMS61;
 if(mono&&p.tributaryUnit==='KG'&&p.tributaryQuantityPerUnit&&typeof mono.adRemICMSRet==='number'&&Number.isFinite(mono.adRemICMSRet)&&mono.adRemICMSRet>=0){mono.qBCMonoRet=d.prod.qTrib;mono.vICMSMonoRet=Number((d.prod.qTrib*Number(mono.adRemICMSRet)).toFixed(2));mass+=mono.qBCMonoRet;tax+=mono.vICMSMonoRet;hasMono=true;}
 });
 if(hasMono){draft.total.ICMSTot.qBCMonoRet=Number(mass.toFixed(6));draft.total.ICMSTot.vICMSMonoRet=Number(tax.toFixed(2));}
 return draft;
}
