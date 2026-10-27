import {httpError} from './database.js';
const ddds=new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
export function normalizePhone(value,{optional=false}={}){
 let digits=String(value||'').replace(/\D/g,'');if(!digits&&optional)return '';
 if([12,13].includes(digits.length)&&digits.startsWith('55'))digits=digits.slice(2);
 if(digits.length===10&&/[6-9]/.test(digits[2]))digits=digits.slice(0,2)+'9'+digits.slice(2);
 if(!ddds.has(digits.slice(0,2))||!((digits.length===11&&digits[2]==='9')||(digits.length===10&&/[2-5]/.test(digits[2]))))throw httpError(400,'Informe um telefone brasileiro válido com DDD.','INVALID_PHONE');
 return '55'+digits;
}
export async function customersForPhone(c,phone){return (await c.query(`SELECT id,name,phone,document,address FROM bansir.customers WHERE active AND
 bansir.customer_lookup_phone(phone,import_metadata)=$1 ORDER BY created_at LIMIT 2`,[normalizePhone(phone)])).rows;}
