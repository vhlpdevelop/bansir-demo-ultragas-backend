// JSONB deliberately does not preserve key order; XML schema sequences do.
const order=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries([...keys.filter(k=>Object.hasOwn(value,k)),...Object.keys(value).filter(k=>!keys.includes(k))].map(k=>[k,value[k]])):value;
const address=['xLgr','nro','xCpl','xBairro','cMun','xMun','UF','CEP','cPais','xPais','fone'];
export function prepareWizardPayload(input,{action,key,technical}){
 const payload=structuredClone(input);
 if(action==='cancel'){
  payload.evento=payload.evento.map(e=>{if(e.dhEvento)e.dhEvento=new Date(e.dhEvento).toISOString().slice(0,19)+'+00:00';e.detEvento=order(e.detEvento,['descEvento','nProt','xJust']);return order(e,['cOrgao','tpAmb','CNPJ','CPF','chNFe','dhEvento','tpEvento','nSeqEvento','verEvento','detEvento']);});return payload;
 }
 if(action!=='emit')return payload;
 const n=payload.NFe.infNFe;delete n.Id;delete n.versao;
 n.ide=order(n.ide,['cUF','cNF','natOp','mod','serie','nNF','dhEmi','dhSaiEnt','dPrevEntrega','tpNF','idDest','cMunFG','cMunFGIBS','tpImp','tpEmis','cDV','tpAmb','finNFe','indFinal','indPres','indIntermed','procEmi','verProc','dhCont','xJust','NFref']);
 n.emit.enderEmit=order(n.emit.enderEmit,address);n.emit=order(n.emit,['CNPJCPF','xNome','xFant','enderEmit','IE','IEST','IM','CNAE','CRT']);
 if(n.dest){n.dest.enderDest=order(n.dest.enderDest,address);n.dest=order(n.dest,['CNPJCPF','idEstrangeiro','xNome','enderDest','indIEDest','IE','ISUF','IM','email']);}
 n.det=n.det.map(d=>{
  delete d.nItem;if(d.prod.comb)d.prod.comb=order(d.prod.comb,['cProdANP','descANP','pGLP','pGNn','pGNi','vPart','CODIF','qTemp','UFCons','CIDE','encerrante','pBio','origComb']);d.prod=order(d.prod,['cProd','cEAN','cBarra','xProd','NCM','NVE','CEST','indEscala','CNPJFab','cBenef','EXTIPI','CFOP','uCom','qCom','vUnCom','vProd','cEANTrib','cBarraTrib','uTrib','qTrib','vUnTrib','vFrete','vSeg','vDesc','vOutro','indTot','DI','detExport','xPed','nItemPed','nFCI','rastro','infProdNFF','infProdEmb','veicProd','med','arma','comb','nRECOPI']);
  d.imposto=order(d.imposto,['vTotTrib','ICMS','IPI','II','ISSQN','PIS','PISST','COFINS','COFINSST','ICMSUFDest','IS','IBSCBS']);
  for(const group of ['ICMS','PIS','COFINS'])for(const [kind,value] of Object.entries(d.imposto[group]||{}))d.imposto[group][kind]=order(value,['orig','CST','CSOSN','qBCMono','adRemICMS','vICMSMono','qBCMonoReten','adRemICMSReten','vICMSMonoReten','qBCMonoRet','adRemICMSRet','vICMSMonoRet','modBC','vBC','pRedBC','pICMS','vICMS','vBCFCP','pFCP','vFCP','modBCST','pMVAST','pRedBCST','vBCST','pICMSST','vICMSST','vBCFCPST','pFCPST','vFCPST','vICMSDeson','motDesICMS','indDeduzDeson','vICMSOp','pDif','vICMSDif','vBCSTRet','pST','vICMSSubstituto','vICMSSTRet','vBCFCPSTRet','pFCPSTRet','vFCPSTRet','pRedBCEfet','vBCEfet','pICMSEfet','vICMSEfet','pCredSN','vCredICMSSN','pPIS','vPIS','pCOFINS','vCOFINS','qBCProd','vAliqProd']);
  return order(d,['prod','imposto','impostoDevol','infAdProd','obsItem']);
 });
 n.total.ICMSTot=order(n.total.ICMSTot,['vBC','vICMS','vICMSDeson','vFCPUFDest','vICMSUFDest','vICMSUFRemet','vFCP','vBCST','vST','vFCPST','vFCPSTRet','qBCMono','vICMSMono','qBCMonoReten','vICMSMonoReten','qBCMonoRet','vICMSMonoRet','vProd','vFrete','vSeg','vDesc','vII','vIPI','vIPIDevol','vPIS','vCOFINS','vOutro','vNF','vTotTrib']);
 n.transp=order(n.transp,['modFrete','transporta','retTransp','veicTransp','reboque','vagao','balsa','vol']);
 n.pag=order(n.pag,['detPag','vTroco']);n.pag.detPag=n.pag.detPag.map(p=>{if(p.card)p.card=order(p.card,['tpIntegra','CNPJ','tBand','cAut','CNPJReceb','idTermPag']);return order(p,['indPag','tPag','xPag','vPag','dPag','CNPJPag','UFPag','card']);});
 if(technical)n.infRespTec=order(technical,['CNPJ','xContato','email','fone','idCSRT','hashCSRT']);
 payload.NFe.infNFe=order(n,['ide','emit','avulsa','dest','retirada','entrega','autXML','det','total','transp','cobr','pag','infIntermed','infAdic','exporta','compra','cana','infRespTec','infSolicNFF']);
 // SDK uses Id to choose the already allocated key, but accidentally serializes enumerable Id as an XML element.
 Object.defineProperty(payload.NFe.infNFe,'Id',{value:key,enumerable:false,configurable:true});return payload;
}
