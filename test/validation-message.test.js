import test from 'node:test';import assert from 'node:assert/strict';import {validationMessage} from '../src/postgres/validation-message.js';
test('validation identifies the fiscal item and field without echoing personal data',()=>{
 assert.equal(validationMessage({code:'invalid_format',path:['draft','det',0,'prod','NCM'],message:'Invalid string'}),'Item 1 — NCM inválido ou ausente: informe 8 dígitos.');
 assert.match(validationMessage({code:'invalid_format',path:['dest','enderDest','CEP']}),/^CEP inválido/);
 assert.equal(validationMessage({code:'custom',path:[],message:'Código IBGE incompatível com a UF.'}),'Código IBGE incompatível com a UF.');
});
