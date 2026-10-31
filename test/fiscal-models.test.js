import test from 'node:test';
import assert from 'node:assert/strict';
import {nfeRecipient,validateNfeDraft,fiscalOperation} from '../src/postgres/fiscal-models.js';
import {accessKey} from '../src/postgres/fiscal.js';

test('NF-e recipient requires fiscal address, consistent IBGE/UF and contributor IE',()=>{
 const dest={CNPJCPF:'12345678909',xNome:'Cliente teste',indIEDest:9,enderDest:{xLgr:'Rua',nro:'1',xBairro:'Centro',cMun:'5103403',xMun:'Cuiaba',UF:'MT',CEP:'78000000'}};
 assert.equal(nfeRecipient.parse(dest).enderDest.cPais,1058);
 assert.throws(()=>nfeRecipient.parse({...dest,indIEDest:1}));
 assert.throws(()=>nfeRecipient.parse({...dest,enderDest:{...dest.enderDest,UF:'MS'}}));
 assert.throws(()=>nfeRecipient.parse({...dest,enderDest:undefined}));
 const draft={dest,det:[{prod:{CFOP:'5102'}}]};assert.equal(validateNfeDraft(draft,{address:{uf:'MT'}}).idDest,1);
 assert.throws(()=>validateNfeDraft(draft,{address:{uf:'MS'}}),e=>e.code==='FISCAL_CFOP_DESTINATION');
 assert.equal(validateNfeDraft({...draft,det:[{prod:{CFOP:'6102'}}]},{address:{uf:'MS'}}).idDest,2);
 assert.throws(()=>fiscalOperation.parse({finalConsumer:true,presence:4}));
});
test('access keys identify model 55 or 65 and reject unsupported models',()=>{
 const input={uf:'MT',cnpj:'11222333000181',series:1,number:1,issuedAt:'2026-10-31T10:00:00-04:00',code:'00000001'};
 for(const model of ['55','65']){const key=accessKey({...input,model});assert.equal(key.length,44);assert.equal(key.slice(20,22),model);}
 assert.throws(()=>accessKey({...input,model:'57'}));
});
