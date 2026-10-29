// Read-only public validation; never sends an operator session or changes AWS.
const origin='https://gas.bansir.com.br';
let failed=false;
for(const path of ['/','/bansir-admin']){
 const response=await fetch(origin+path,{signal:AbortSignal.timeout(15000),redirect:'error'});
 const html=await response.text(),headers=response.headers;
 const checks={http200:response.status===200,nosniff:headers.get('x-content-type-options')==='nosniff',frameDenied:headers.get('x-frame-options')==='DENY',referrer:headers.get('referrer-policy')==='strict-origin-when-cross-origin',frameAncestors:/frame-ancestors\s+'none'/.test(headers.get('content-security-policy')||''),cspReportOnly:!!headers.get('content-security-policy-report-only')};
 console.log(path,checks);if(Object.values(checks).some(v=>!v))failed=true;
 const assets=[...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"\s]+)"/g)].map(m=>m[1]))];
 if(assets.length<2){failed=true;console.error(path,'HTML sem referências completas de assets.');}
 for(const asset of assets){const r=await fetch(origin+asset,{signal:AbortSignal.timeout(15000),redirect:'error'}),mime=r.headers.get('content-type')||'',ok=r.status===200&&(asset.endsWith('.css')?mime.includes('text/css'):/javascript/.test(mime));await r.body?.cancel();console.log(asset,ok?'OK':`FALHA HTTP ${r.status} (${mime})`);if(!ok)failed=true;}
}
if(failed){console.error('Verificação incompleta: conferir policy/behaviors e publicação do app.');process.exitCode=1;}
