import { randomBytes, createCipheriv, createDecipheriv, createHash, X509Certificate, createPrivateKey } from 'node:crypto';
import forge from 'node-forge';
import { httpError } from './database.js';

function key() {
 const value=process.env.FISCAL_ENCRYPTION_KEY || '';
 if(!/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value,'base64').length!==32) throw httpError(409,'Configure a chave de criptografia fiscal de 32 bytes.','FISCAL_KEY_REQUIRED');
 return Buffer.from(value,'base64');
}
export function seal(value, context) {
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
 cipher.setAAD(Buffer.from(context));
 const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
 return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');
}
export function unseal(value,context) {
 const [version,iv,tag,data]=value.split('.'); if(version!=='v1') throw new Error('Invalid encrypted version');
 const cipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64'));cipher.setAAD(Buffer.from(context));cipher.setAuthTag(Buffer.from(tag,'base64'));
 return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8'));
}
export const secretContext=(identity,kind)=>`${identity.tenantId}/${identity.establishmentId}/${kind}`;
export function inspectCertificate(base64,password) {
 try {
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error();
  const bytes=Buffer.from(base64,'base64');if(bytes.length>1024*1024 || bytes.length<100) throw new Error();
  const p12=forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bytes.toString('binary')),password);
  const certs=p12.getBags({bagType:forge.pki.oids.certBag})[forge.pki.oids.certBag] || [];
  const keys=[...(p12.getBags({bagType:forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag]||[]),...(p12.getBags({bagType:forge.pki.oids.keyBag})[forge.pki.oids.keyBag]||[])];
  for(const bag of certs) {
   const cert=new X509Certificate(forge.pki.certificateToPem(bag.cert));
   const privateBag=keys.find(k=>k.key && cert.checkPrivateKey(createPrivateKey(forge.pki.privateKeyToPem(k.key))));
   if(!privateBag) continue;
   const cn=bag.cert.subject.getField('CN')?.value || '';
   // ICP-Brasil e-CNPJ stores the holder document at the end of the subject CN.
   const cnpj=cn.match(/:(\d{14})$/)?.[1];
   if(!cnpj || new Date(cert.validFrom)>new Date() || new Date(cert.validTo)<=new Date()) throw new Error();
   return {subject:cn,cnpj,validFrom:cert.validFrom,validUntil:cert.validTo,fingerprint:createHash('sha256').update(cert.raw).digest('hex')};
  }
  throw new Error();
 } catch {throw httpError(400,'Certificado A1 e-CNPJ inválido, vencido ou senha incorreta.','INVALID_CERTIFICATE');}
}
