import test from 'node:test';import assert from 'node:assert/strict';
import {prepareWizardPayload} from '../src/postgres/wizard-payload.js';import {accessKey} from '../src/postgres/fiscal.js';
// The deployed SDK includes native XML bindings. Run this test in the Linux image,
// with --network none: no certificate, signature, HTTP transport or SEFAZ request.
test('actual NF-e/NFC-e SDK preserves the allocated key and cNF during XML assembly',{skip:process.platform!=='linux'},async t=>{
 const sdk=await import('nfewizard-io'),nfce=await import('@nfewizard/nfce');sdk.logger.initialize({exibirLogNoConsole:false,armazenarLogs:false});sdk.logger.logger.silent=true;
 for(const model of ['55','65'])for(const code of ['31719162','00001234'])await t.test(`${model} / cNF ${code}`,async()=>{
  const key=accessKey({uf:'MS',cnpj:'11222333000181',series:1,number:1217,issuedAt:'2026-11-03T17:00:00-04:00',code,model});
  const source={idLote:1217,indSinc:1,NFe:{infNFe:{ide:{cUF:50,cNF:code,mod:Number(model),serie:1,nNF:1217,tpEmis:1,tpAmb:2,dhEmi:'2026-11-03T17:00:00-04:00'},emit:{CNPJCPF:'11222333000181',enderEmit:{}},det:[{prod:{cProd:'1'},imposto:{ICMS:{},PIS:{},COFINS:{}}}],total:{ICMSTot:{vNF:48}},pag:{detPag:[{tPag:'03',vPag:48}]},transp:{modFrete:9}}}};
  const wizard=model==='55'?new sdk.default():new nfce.NFCEWizard(),service=wizard.nfeWizardService||wizard.nfceWizardService||wizard;let captured;
  service.environment={isLoaded:true,getConfig:()=>({nfe:{idCSC:1,tokenCSC:'TEST-ONLY'},dfe:{}})};service.utility={getUrlNFCe:()=> 'https://example.invalid'};
  service.xmlBuilder={gerarXml:(data,root)=>{if(root==='NFe')captured=structuredClone(data);return `<${root}>[XML]</${root}>`;},assinarXML:xml=>xml};
  const Wrapper=model==='55'?sdk.NFEAutorizacao:nfce.NFCEAutorizacao,original=Wrapper.prototype.Exec;
  Wrapper.prototype.Exec=function(data){const impl=this.nfeAutorizacaoService||this.nfceAutorizacaoService;impl[model==='55'?'gerarXmlNFeAutorizacao':'gerarXmlNFCEAutorizacao'](data);return {xMotivo:[],xmls:[]};};
  try{await service[model==='55'?'NFE_Autorizacao':'NFCE_Autorizacao'](prepareWizardPayload(source,{action:'emit',key}));}finally{Wrapper.prototype.Exec=original;}
  assert.ok(captured);assert.equal(captured.infNFe.$.Id,'NFe'+key);assert.equal(captured.infNFe.ide.cNF,key.slice(35,43));assert.equal(captured.infNFe.ide.cDV,Number(key.at(-1)));assert.equal(Object.hasOwn(captured.infNFe,'Id'),false);assert.equal(source.NFe.infNFe.ide.cNF,code);
 });
});
