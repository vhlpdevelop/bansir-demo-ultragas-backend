import {createHash} from 'node:crypto';
export const point=p=>p&&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))&&p.latitude!=null&&p.longitude!=null&&Math.abs(Number(p.latitude))<=90&&Math.abs(Number(p.longitude))<=180?{latitude:Number(p.latitude),longitude:Number(p.longitude)}:null;
export function km(a,b){const r=x=>x*Math.PI/180,h=Math.sin(r(b.latitude-a.latitude)/2)**2+Math.cos(r(a.latitude))*Math.cos(r(b.latitude))*Math.sin(r(b.longitude-a.longitude)/2)**2;return 6371*2*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));}
export const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const color=index=>`hsl(${((Number(index)||1)*137.507764%360).toFixed(2)},68%,40%)`;
export function orderedStops(tasks,driverId){return tasks.filter(t=>t.driver_id===driverId&&['assigned','en_route'].includes(t.status)).sort((a,b)=>Number(b.status==='en_route')-Number(a.status==='en_route')||(a.route_order??2147483647)-(b.route_order??2147483647)||new Date(a.created_at)-new Date(b.created_at)||a.sale_id.localeCompare(b.sale_id));}
export const destinationRevision=t=>digest([point(t)?.latitude??null,point(t)?.longitude??null,Number(t.accuracy??0)]);
export const routeRevision=stops=>digest(stops.map(t=>[t.sale_id,t.version,t.route_order,t.status,t.latitude,t.longitude]));
export function driverPlan(d,tasks,store,{allowPosition=true}={}){
 const stops=orderedStops(tasks,d.id),fresh=d.active&&d.on_duty&&d.gps_state==='ok'&&d.position&&Math.max(Date.now()-new Date(d.position.capturedAt),Date.now()-new Date(d.position.receivedAt))<=90000&&d.position.accuracy<=100;
 const origin=allowPosition&&fresh?point(d.position):point(store),originSource=allowPosition&&fresh?'position':'store';
 return {driverId:d.id,name:d.name,color:d.map_color||color(d.map_color_index),origin,originSource,position:allowPosition?d.position:null,positionState:d.locationState,onDuty:!!d.on_duty,sharing:!!d.active,driverActive:!!d.driver_active,accountActive:!!d.account_active,stops,revision:routeRevision(stops),incompleteStops:stops.filter(t=>!point(t)).length,pinned:stops.filter(t=>t.status==='en_route').length};
}
function insertion(plan,target,distance,duration){
 const base=[plan.origin,...plan.stops.map(point)],cost=(path,fn)=>path.slice(1).reduce((n,p,i)=>n+fn(path[i],p),0),baseline=cost(base,distance);let best;
 if(!Number.isFinite(baseline))return null;
 for(let at=plan.pinned;at<=plan.stops.length;at++){
  const path=[...base.slice(0,at+1),target,...base.slice(at+1)],total=cost(path,distance),added=Math.max(0,total-baseline),arrival=cost(path.slice(0,at+2),duration||distance);
  if(!Number.isFinite(total)||!Number.isFinite(arrival))continue;
  if(!best||added<best.addedKm-0.001||Math.abs(added-best.addedKm)<0.001&&arrival<best.arrival)best={insertionIndex:at,addedKm:added,totalKm:total,baselineKm:baseline,arrival,minutes:duration?arrival/60:null};
 }
 return best;
}
export async function recommend(plans,target,router,scope){
 const destination=point(target),targetUsable=!!destination&&(target.accuracy==null||Number(target.accuracy)<=200);
 const candidates=plans.map(plan=>({driverId:plan.driverId,name:plan.name,color:plan.color,load:plan.stops.length,originSource:plan.originSource,routeRevision:plan.revision,eligible:targetUsable&&plan.onDuty&&plan.driverActive&&plan.accountActive&&!!plan.origin&&plan.stops.length<20&&!plan.incompleteStops,reason:!targetUsable?'Confirme um ponto preciso para o destino.':!plan.driverActive||!plan.accountActive?'Entregador ou acesso inativo.':!plan.onDuty?'Fora do expediente.':!plan.origin?'Informe o ponto da loja ou ative a localização.':plan.incompleteStops?'Há paradas sem ponto confirmado.':plan.stops.length>=20?'Limite de 20 paradas ativas.':''}));
 const eligible=plans.filter((p,i)=>candidates[i].eligible),points=[];const add=p=>{if(!points.some(x=>km(x,p)<0.00001))points.push(p);};if(destination)add(destination);for(const p of eligible){add(p.origin);p.stops.forEach(s=>add(point(s)));}
 const matrix=points.length<=50&&eligible.length?await router.matrix(points,scope):null;
 const index=p=>points.findIndex(x=>km(x,p)<0.00001),distance=matrix?(a,b)=>matrix.distances[index(a)][index(b)]/1000:km,duration=matrix?(a,b)=>matrix.durations[index(a)][index(b)]:null;
 for(let i=0;i<plans.length;i++){
  const candidate=candidates[i],plan=plans[i];if(!candidate.eligible)continue;
  const best=insertion(plan,destination,distance,duration);if(!best){candidate.eligible=false;candidate.reason='Não foi possível encontrar uma ligação pelas vias.';continue;}
  Object.assign(candidate,{...best,model:matrix?'road':'approximate',distanceToTargetKm:distance(plan.origin,destination),insertAfter:best.insertionIndex,reason:plan.stops.length?'Menor acréscimo na rota, preservando paradas em andamento.':'Deslocamento direto até o novo destino.'});
 }
 candidates.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(a.eligible&&b.eligible?(Math.abs(a.addedKm-b.addedKm)>.1?a.addedKm-b.addedKm:(a.minutes??a.distanceToTargetKm)-(b.minutes??b.distanceToTargetKm)||a.load-b.load):0)||a.name.localeCompare(b.name));
 return {destinationRevision:destinationRevision(target),targetLocated:targetUsable,model:matrix?'road':'approximate',recommendedDriverId:candidates.find(c=>c.eligible)?.driverId||null,candidates,calculatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),provider:router.info(),warning:!targetUsable?'O endereço continua válido, mas falta confirmar o ponto para comparar trajetos.':!matrix?'Comparação aproximada em linha reta; não representa distância pelas ruas.':null};
}
