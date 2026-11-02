import {httpError} from './database.js';
const fail=(message,code)=>{throw httpError(409,message,code);};
export const referenceDeadline='2026-12-14';
export function assertReferenceDate(now=new Date()){if(now.toISOString().slice(0,10)>=referenceDeadline)fail('Emissão de NF-e de saída referenciando NFC-e vedada a partir de 14/12/2026. Utilize o fluxo fiscal apropriado.','NFCE_REFERENCE_RESTRICTED');}
