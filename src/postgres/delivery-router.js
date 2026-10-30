import {digest,point} from './delivery-planner.js';
const endpoint='https://api.heigit.org/openrouteservice/v2';
export function createDeliveryRouter({apiKey=process.env.DELIVERY_ORS_API_KEY||'',transport=fetch,clock=()=>Date.now(),directionsLimit=Number(process.env.DELIVERY_ORS_DIRECTIONS_DAILY_LIMIT||1500),matrixLimit=Number(process.env.DELIVERY_ORS_MATRIX_DAILY_LIMIT||350),minuteLimit=Number(process.env.DELIVERY_ORS_REQUESTS_PER_MINUTE||20)}={}){
 const budget=(n,fallback,max)=>Number.isFinite(n)&&n>0?Math.min(Math.floor(n),max):fallback;directionsLimit=budget(directionsLimit,1500,1800);matrixLimit=budget(matrixLimit,350,400);minuteLimit=budget(minuteLimit,20,30);
 const matrices=new Map(),routes=new Map(),pending=new Map();let dayStart=clock(),minute=[],counts={matrix:0,directions:0},blockedUntil=0,status=apiKey?'ready':'not_configured',closed=false;
 const info=()=>({provider:'openrouteservice',configured:!!apiKey,status,attribution:'© openrouteservice by HeiGIT | © OpenStreetMap contributors'});
 const call=async(kind,path,body)=>{
  const now=clock();if(now-dayStart>=86400000){counts={matrix:0,directions:0};dayStart=now;}minute=minute.filter(t=>now-t<60000);
  if(closed||!apiKey||now<blockedUntil)return null;
  if(minute.length>=minuteLimit||counts[kind]>=(kind==='matrix'?matrixLimit:directionsLimit)){status='local_quota';return null;}
  minute.push(now);counts[kind]++;
  try{
   const r=await transport(endpoint+path,{method:'POST',headers:{Authorization:apiKey,'Content-Type':'application/json',Accept:'application/geo+json, application/json','User-Agent':'Bansir-Gas-Routing/1.0 (+https://bansir.com.br)'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:'error'});
   if(!r.ok){blockedUntil=now+([403,429].includes(r.status)?900000:30000);status=[403,429].includes(r.status)?'provider_quota_or_key':'unavailable';await r.body?.cancel();return null;}
   const reader=r.body.getReader();let size=0,chunks=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('ROUTE_TOO_LARGE');}chunks.push(value);}const data=JSON.parse(Buffer.concat(chunks).toString());status='ready';return data;
  }catch{status='unavailable';blockedUntil=now+30000;return null;}
 };
 const cached=async(map,key,signature,ttl,work)=>{const old=map.get(key);if(old&&old.signature===signature&&clock()<old.expires)return old.value;const jobKey=key+signature;if(pending.has(jobKey))return pending.get(jobKey);const job=(async()=>{const value=await work();if(map.size>=256&&!map.has(key))map.delete(map.keys().next().value);map.set(key,{signature,value,expires:clock()+(value?ttl:30000)});return value;})().finally(()=>pending.delete(jobKey));pending.set(jobKey,job);return job;};
 return {info,close(){closed=true;matrices.clear();routes.clear();},async matrix(points,scope){
  if(!apiKey||points.length>50||points.length<2)return null;
  const signature=digest(points.map(p=>[+p.longitude.toFixed(3),+p.latitude.toFixed(3)]));
  return cached(matrices,scope+':matrix',signature,60000,async()=>{const data=await call('matrix','/matrix/driving-car',{locations:points.map(p=>[p.longitude,p.latitude]),metrics:['distance','duration']});const valid=a=>Array.isArray(a)&&a.length===points.length&&a.every(row=>Array.isArray(row)&&row.length===points.length&&row.every(v=>v===null||Number.isFinite(v)&&v>=0));if(!data||!valid(data.distances)||!valid(data.durations))return null;return {distances:data.distances.map(row=>row.map(v=>v===null?Infinity:v)),durations:data.durations.map(row=>row.map(v=>v===null?Infinity:v))};});
 },async geometry(plan,scope){
  if(!apiKey||!plan.origin||plan.incompleteStops||!plan.stops.length||plan.stops.length>20)return null;
  const key=scope+':route:'+plan.driverId,signature=digest([plan.revision,plan.originSource]),old=routes.get(key);
  if(old?.signature===signature&&clock()<old.expires)return old.value;
  return cached(routes,key,signature,300000,async()=>{const data=await call('directions','/directions/driving-car/geojson',{coordinates:[plan.origin,...plan.stops.map(point)].map(p=>[p.longitude,p.latitude]),instructions:false,geometry_simplify:true});const feature=data?.features?.[0],coords=feature?.geometry?.coordinates,summary=feature?.properties?.summary;if(feature?.geometry?.type!=='LineString'||!Array.isArray(coords)||coords.length>20000||coords.length<2||!coords.every(p=>Array.isArray(p)&&p.length>=2&&point({longitude:p[0],latitude:p[1]}))||!Number.isFinite(summary?.distance)||!Number.isFinite(summary?.duration))return null;return {coordinates:coords.map(p=>[p[0],p[1]]),distanceKm:summary.distance/1000,durationMinutes:summary.duration/60,calculatedAt:new Date(clock()).toISOString(),model:'road'};});
 }};
}
