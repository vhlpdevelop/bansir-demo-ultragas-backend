import {createHash} from 'node:crypto';
import {httpError} from './database.js';
export function createDeliveryGeocoder({key=process.env.DELIVERY_ORS_API_KEY||'',transport=fetch,clock=()=>Date.now()}={}){
 const cache=new Map(),pending=new Map();let minute=[],count=0,start=clock(),blocked=0;
 return {async search(address,origin,scope){
  if(!key)throw httpError(503,'Busca por endereço indisponível. Use sua localização ou ajuste o mapa.','GEOCODER_UNAVAILABLE');
  const hash=createHash('sha256').update(JSON.stringify([scope,address.toLowerCase(),origin])).digest('hex'),old=cache.get(hash);
  if(old&&clock()<old.expires)return old.value;if(pending.has(hash))return pending.get(hash);
  const now=clock();if(now-start>=86400000){count=0;start=now;}minute=minute.filter(t=>now-t<60000);
  if(now<blocked||minute.length>=10||count>=500)throw httpError(429,'Busca temporariamente limitada. Ajuste o ponto no mapa ou tente novamente mais tarde.','GEOCODER_LIMIT');
  minute.push(now);count++;
  const job=(async()=>{try{
   const url=new URL('https://api.heigit.org/pelias/v1/search');url.searchParams.set('text',address);url.searchParams.set('boundary.country','BRA');url.searchParams.set('size','3');
   if(origin){url.searchParams.set('focus.point.lat',String(origin.latitude));url.searchParams.set('focus.point.lon',String(origin.longitude));}
   const r=await transport(url,{headers:{Authorization:key,Accept:'application/geo+json, application/json'},signal:AbortSignal.timeout(8000),redirect:'error'});
   if(!r.ok){blocked=now+([403,429].includes(r.status)?900000:30000);await r.body?.cancel();throw Error('PROVIDER_UNAVAILABLE');}
   const reader=r.body.getReader(),chunks=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512000){await reader.cancel();throw Error('RESPONSE_TOO_LARGE');}chunks.push(value);}
   const data=JSON.parse(Buffer.concat(chunks).toString()),features=Array.isArray(data.features)?data.features:[];
   const value=features.slice(0,3).filter(f=>f.geometry?.type==='Point'&&f.geometry.coordinates?.length>=2&&f.geometry.coordinates.slice(0,2).every(Number.isFinite)&&Math.abs(f.geometry.coordinates[0])<=180&&Math.abs(f.geometry.coordinates[1])<=90).map(f=>({latitude:f.geometry.coordinates[1],longitude:f.geometry.coordinates[0],label:String(f.properties?.label||'Endereço encontrado').slice(0,300)}));
   if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(hash,{expires:clock()+300000,value});return value;
  }catch{throw httpError(503,'Não foi possível localizar esse endereço agora. Use sua localização ou ajuste o ponto no mapa.','GEOCODER_UNAVAILABLE');}})().finally(()=>pending.delete(hash));pending.set(hash,job);return job;
 }};
}
