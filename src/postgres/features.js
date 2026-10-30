import {httpError} from './database.js';
export const tenantFeatures=async c=>(await c.query('SELECT bansir.tenant_features() AS features')).rows[0]?.features||{};
export async function requireFeature(c,key){
 if((await tenantFeatures(c))[key]!==true)throw httpError(403,'Esta função não está liberada no contrato da empresa.','FEATURE_DISABLED');
}
export function routeFeature(path){
 if(/^\/api\/v1\/deliveries(?:\/|$)/.test(path))return 'deliveries';
 if(/^\/api\/v1\/whatsapp(?:\/|$)/.test(path)||/\/whatsapp(?:\/|$)/.test(path))return 'whatsapp';
 if(/^\/api\/v1\/storefront(?:\/|$)/.test(path))return 'orderLink';
 if(/^\/api\/v1\/financial\/pricing-intelligence(?:\/|$)/.test(path))return 'financialIntelligence';
}
