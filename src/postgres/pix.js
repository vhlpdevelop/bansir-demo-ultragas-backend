import {httpError} from './database.js';
// Static BR Code: source https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf
export function crc16(text){let crc=0xffff;for(const byte of Buffer.from(text)){crc^=byte<<8;for(let i=0;i<8;i++)crc=((crc&0x8000)?(crc<<1)^0x1021:crc<<1)&0xffff;}return crc.toString(16).toUpperCase().padStart(4,'0');}
function tlv(id,value){const size=Buffer.byteLength(value);if(size>99)throw httpError(400,'Campo PIX muito longo.','INVALID_PIX_CONFIG');return id+String(size).padStart(2,'0')+value;}
const ascii=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9 .-]/g,'').toUpperCase();
export function pixCode({key,name,city,amountCents,txid}){
 if(!key || key.length>77 || /[^\x21-\x7e]/.test(key)||!ascii(name)||!ascii(city))throw httpError(409,'Configure chave PIX, nome e cidade da loja.','PIX_NOT_READY');
 const account=tlv('00','br.gov.bcb.pix')+tlv('01',key);
 const base=tlv('00','01')+tlv('26',account)+tlv('52','0000')+tlv('53','986')+tlv('54',(amountCents/100).toFixed(2))+tlv('58','BR')+tlv('59',ascii(name).slice(0,25))+tlv('60',ascii(city).slice(0,15))+tlv('62',tlv('05',txid.replace(/[^a-zA-Z0-9]/g,'').slice(0,25)))+'6304';
 return base+crc16(base);
}
