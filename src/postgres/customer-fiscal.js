import {z} from 'zod';
const text=max=>z.string().trim().max(max).optional();
const digits=n=>z.string().regex(new RegExp(`^(?:[0-9]{${n}})?$`)).optional();
export const customerFiscalInput=z.object({
 indIEDest:z.union([z.literal(1),z.literal(2),z.literal(9)]).optional(),IE:digits('2,14'),
 enderDest:z.object({xLgr:text(60),nro:text(20),xBairro:text(60),cMun:digits(7),xMun:text(60),
 UF:z.enum('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')).optional(),CEP:digits(8)}).strict().optional()
}).strict();
export function customerSnapshot(customer){
 return {name:customer.name||'',document:customer.document||'',phone:customer.phone||'',address:customer.address||'',email:customer.email||'',notes:customer.notes||'',fiscal:customer.fiscal_data||{}};
}
export function receiptCustomerAddress(sale){
 const c=sale.customer_details||sale.customer_snapshot||{},a=c.fiscal?.enderDest;
 return sale.delivery_address?.trim()||c.address?.trim()||sale.receipt_customer_address?.trim()||
  (a?[a.xLgr,a.nro,a.xBairro,[a.xMun,a.UF].filter(Boolean).join('/'),a.CEP].filter(Boolean).join(', '):'');
}
export function saleCustomerRecipient(sale){
 const c=sale.customer_details||sale.customer_snapshot||{},f=c.fiscal||{},document=sale.customer_document||c.document||'',phone=String(c.phone||sale.customer_phone||'').replace(/\D/g,'');
 return {CNPJCPF:document,xNome:sale.customer_name||c.name||'',indIEDest:f.indIEDest??9,
  ...(f.indIEDest===1&&f.IE?{IE:f.IE}:{}),...(f.enderDest||phone?{enderDest:{...structuredClone(f.enderDest||{}),...(phone.length>=6&&phone.length<=14?{fone:phone}:{})}}:{}),
  ...(c.email?{email:c.email}:{})};
}
