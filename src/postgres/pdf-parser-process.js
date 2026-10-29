import {parsePdfBytes} from './pdf-parser.js';
process.once('message',async({bytes,maxPages})=>{
 let message;
 try{message={ok:true,result:await parsePdfBytes(Buffer.from(bytes),{maxPages})};}
 catch(error){message={ok:false,code:['PDF_TOO_LARGE','PDF_READ_FAILED'].includes(error.code)?error.code:'PDF_READ_FAILED'};}
 // No PDF content, customer data or parser diagnostics on stdout/stderr.
 process.send(message,()=>process.exit(0));
});
process.once('disconnect',()=>process.exit(0));
