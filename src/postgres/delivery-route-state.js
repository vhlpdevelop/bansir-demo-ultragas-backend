import {z} from 'zod';
import {httpError} from './database.js';
import {orderedStops,routeRevision,destinationRevision,point} from './delivery-planner.js';
export const routePlanInput=z.object({destinationRevision:z.string().regex(/^[a-f0-9]{64}$/),routeRevision:z.string().regex(/^[a-f0-9]{64}$/),insertionIndex:z.number().int().min(0).max(20),expiresAt:z.iso.datetime({offset:true})}).strict();
export const routeUnitLock=(c,i)=>c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`delivery-routes:${i.tenantId}:${i.establishmentId}`]);
export async function activeTasks(c,driverId=null){const rows=(await c.query("SELECT t.sale_id,t.driver_id,t.status,t.address,t.latitude,t.longitude,t.accuracy,t.version,t.route_order,t.created_at FROM bansir.delivery_tasks t WHERE status IN('assigned','en_route') AND($1::uuid IS NULL OR driver_id=$1) ORDER BY route_order,created_at LIMIT 2001",[driverId])).rows;if(rows.length>2000)throw httpError(409,'A operação supera 2.000 paradas ativas. Conclua ou revise as entregas pendentes.','ROUTE_LIMIT');return rows;}
export async function storePoint(c){const cfg=(await c.query('SELECT config FROM bansir.storefronts LIMIT 1')).rows[0]?.config;return point(cfg?.location);}
export async function applySuggestedInsertion(c,i,saleId,driverId,proposal){
 if(!proposal)return;const p=routePlanInput.parse(proposal),remaining=orderedStops((await c.query("SELECT * FROM bansir.delivery_tasks WHERE driver_id=$1 AND sale_id<>$2 AND status IN('assigned','en_route') FOR UPDATE",[driverId,saleId])).rows,driverId);
 const target=(await c.query('SELECT latitude,longitude,accuracy FROM bansir.delivery_tasks WHERE sale_id=$1',[saleId])).rows[0];
 if(!target||destinationRevision(target)!==p.destinationRevision||new Date(p.expiresAt)<=new Date()||new Date(p.expiresAt)-Date.now()>90000||routeRevision(remaining)!==p.routeRevision||p.insertionIndex<remaining.filter(t=>t.status==='en_route').length||p.insertionIndex>remaining.length)throw httpError(409,'As paradas ou a sugestão mudaram. Calcule novamente antes de confirmar.','STALE_ROUTE');
 const ids=remaining.map(t=>t.sale_id);ids.splice(p.insertionIndex,0,saleId);
 await c.query('UPDATE bansir.delivery_tasks t SET route_order=x.n::int,version=version+CASE WHEN t.sale_id=$2 THEN 0 ELSE 1 END,updated_at=now() FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id,n) WHERE t.sale_id=x.id',[ids,saleId]);
}
