import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {httpError} from './database.js';

// Coordinates retain empty columns; splitting plain text would shift dates into phone/address fields.
export async function parsePdfBytes(bytes,{maxPages=250}={}){
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');let task;
 try{
  task=getDocument({data:new Uint8Array(bytes),standardFontDataUrl:fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/',import.meta.url)).replaceAll('\\','/'),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,isOffscreenCanvasSupported:false,useWorkerFetch:false});
  const doc=await task.promise;if(doc.numPages>maxPages)throw httpError(400,`O PDF deve ter até ${maxPages} páginas.`,'PDF_TOO_LARGE');
  const pages=[];let count=0,itemsCount=0,textLength=0;
  for(let n=1;n<=doc.numPages;n++){
   const page=await doc.getPage(n),content=await page.getTextContent(),groups=[];
   for(const item of content.items){itemsCount++;textLength+=item.str?.length||0;if(itemsCount>200000||textLength>2000000)throw httpError(400,'PDF muito extenso. Divida em arquivos menores.','PDF_TOO_LARGE');if(!item.str?.trim())continue;const y=item.transform[5];let line=groups.find(g=>Math.abs(g.y-y)<2);if(!line){line={y,items:[]};groups.push(line);}line.items.push({x:item.transform[4],text:item.str});}
   const lines=groups.sort((a,b)=>b.y-a.y).map(g=>({...g,items:g.items.sort((a,b)=>a.x-b.x)}));count+=lines.length;
   if(count>25000)throw httpError(400,'PDF muito extenso. Divida em arquivos menores.','PDF_TOO_LARGE');
   pages.push({number:n,width:page.view[2]-page.view[0],lines});page.cleanup();
  }
  const result={fileHash:createHash('sha256').update(bytes).digest('hex'),pages};if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)throw httpError(400,'PDF muito extenso. Divida em arquivos menores.','PDF_TOO_LARGE');return result;
 }catch(e){if(e.status)throw e;throw httpError(400,'Não foi possível ler o PDF. Use texto selecionável, sem senha.','PDF_READ_FAILED');}
 finally{if(task)await task.destroy();}
}
