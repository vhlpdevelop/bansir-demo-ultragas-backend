import { z } from 'zod';
import { httpError, validId } from './database.js';

const text = z.string().trim().max(200);
const amount = z.number().finite().min(0).max(10000000)
  .refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, 'Use no máximo duas casas decimais.');
export const productInput = z.object({
  name: text.min(1), barcode: text.min(1), price: amount.refine(n => n > 0),
  costPrice: amount.optional(), stock: z.number().int().min(0).max(100000000).optional(),
  fulfillmentPricing:z.object({promotionPickupPrice:amount.positive().optional(),promotionDeliveryPrice:amount.positive().optional(),deliveryPrice:amount.positive().optional(),saturdayPickupPrice:amount.positive().optional(),saturdayDeliveryPrice:amount.positive().optional()}).strict().optional(),
  gasDoPovo:z.boolean().optional(),gasDoPovoDelivery:z.boolean().optional(),
  category: text.optional(), sku: text.optional(), unit: text.optional(), brand: text.optional(),
  specs: z.string().max(5000).optional(), ncm: z.string().regex(/^(\d{8})?$/).optional(), active: z.boolean().optional()
}).strict();
export const categoryInput = z.object({ name: text.min(1), description: z.string().max(2000).optional(), color: text.optional() }).strict();
export const movementInput = z.object({ productId: z.string().uuid(), type: z.enum(['in', 'out']),
  quantity: z.number().int().positive().max(100000000), reason: z.string().trim().min(1).max(1000), notes: z.string().max(2000).optional() }).strict();
export const settingsInput = z.object({ storeName: text, pixKey: text, contact:text, documentId: text, address: z.string().max(1000), merchantCity: text }).partial().strict();

export const presentProduct = row => ({ _id: row.id, id: row.id, name: row.name, barcode: row.barcode,
  price: Number(row.price_cents) / 100, costPrice: Number(row.cost_cents) / 100, stock: row.stock,
  category: row.category, sku: row.sku, unit: row.unit, brand: row.brand, specs: row.specs, ncm: row.ncm,
  fulfillmentPricing:row.fulfillment_pricing||{},gasDoPovo:!!row.gas_do_povo,gasDoPovoDelivery:!!row.gas_do_povo_delivery,
  imageId:row.image_id||null, active: row.active, createdAt: row.created_at, updatedAt: row.updated_at });
export function catalogView(row,member) {
  const result=presentProduct(row);
  const manages=['admin','superadmin'].includes(member.role) || member.allowed_routes?.some(r=>r==='products' || r.startsWith('products-'));
  if (!manages) delete result.costPrice;
  return result;
}
export function requirePermission(member, module, read = false) {
  const routes = member.allowed_routes || [];
  if (['admin', 'superadmin'].includes(member.role) || routes.some(r => r === module || (!module.startsWith('settings')&&module!=='fiscal'&&r.startsWith(`${module}-`))) || (module.startsWith('settings-')&&routes.includes('settings')) || (read&&['settings-store','settings-terminals'].includes(module)&&routes.includes('sales')) ||
      (read && module === 'products' && routes.includes('sales'))) return;
  throw httpError(403, 'Você não tem permissão para esta ação nesta empresa.', 'FORBIDDEN');
}
export function resourceId(id) {
  if (!validId(id)) throw httpError(400, 'Identificador inválido.', 'INVALID_ID');
  return id;
}
export async function stockMovement(client, { tenantId, userId, establishmentId }, product, quantity, type, reason) {
  if (!quantity) return;
  await client.query(`INSERT INTO bansir.stock_movements(tenant_id,product_id,quantity,type,unit_price_cents,reason,user_id,establishment_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [tenantId, product.id, quantity, type, product.price_cents, reason, userId,establishmentId]);
}
export async function createProduct(client, context, input) {
  const data = productInput.parse(input);
  await deliveryOwner(client,context,{},data);
  const { rows: [product] } = await client.query(`INSERT INTO bansir.products
    (tenant_id,name,barcode,price_cents,cost_cents,stock,category,sku,unit,brand,specs,ncm,active,establishment_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
  [context.tenantId, data.name, data.barcode, Math.round(data.price * 100), Math.round((data.costPrice || 0) * 100),
    data.stock || 0, data.category || 'Gás de Cozinha', data.sku || '', data.unit || 'UN', data.brand || '', data.specs || '', data.ncm || '', data.active ?? true,context.establishmentId]);
  await stockMovement(client, context, product, product.stock, 'in', 'Estoque inicial');
  if(data.fulfillmentPricing||data.gasDoPovo!==undefined||data.gasDoPovoDelivery!==undefined){const updated=(await client.query('UPDATE bansir.products SET fulfillment_pricing=$2,gas_do_povo=$3,gas_do_povo_delivery=$4 WHERE id=$1 RETURNING *',[product.id,data.fulfillmentPricing||{},data.gasDoPovo||false,data.gasDoPovoDelivery||false])).rows[0];return presentProduct(updated);}
  return presentProduct(product);
}
export async function updateProduct(client, context, id, input) {
  const data = productInput.partial().parse(input);
  const { rows: [before] } = await client.query('SELECT * FROM bansir.products WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [context.tenantId, resourceId(id)]);
  if (!before) throw httpError(404, 'Produto não encontrado.', 'NOT_FOUND');
  await deliveryOwner(client,context,before,data);
  const fields = { name: 'name', barcode: 'barcode', category: 'category', sku: 'sku', unit: 'unit', brand: 'brand', specs: 'specs', ncm: 'ncm', stock: 'stock', active: 'active', price: 'price_cents', costPrice: 'cost_cents' };
  Object.assign(fields,{fulfillmentPricing:'fulfillment_pricing',gasDoPovo:'gas_do_povo',gasDoPovoDelivery:'gas_do_povo_delivery'});
  const entries = Object.entries(data);
  if (!entries.length) return presentProduct(before);
  const values = entries.map(([key, value]) => ['price', 'costPrice'].includes(key) ? Math.round(value * 100) : value);
  const setters = entries.map(([key], i) => `${fields[key]}=$${i + 3}`);
  const { rows: [product] } = await client.query(`UPDATE bansir.products SET ${setters.join(',')},updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [context.tenantId, id, ...values]);
  const delta = product.stock - before.stock;
  await stockMovement(client, context, product, Math.abs(delta), delta > 0 ? 'in' : 'out', 'Ajuste de cadastro');
  return presentProduct(product);
}
async function deliveryOwner(client,context,before,data){
 const pricing=p=>JSON.stringify(p||{},['deliveryPrice','saturdayPickupPrice','saturdayDeliveryPrice','promotionPickupPrice','promotionDeliveryPrice']);
 const changed=(data.fulfillmentPricing!==undefined&&pricing(data.fulfillmentPricing)!==pricing(before.fulfillment_pricing))||(data.gasDoPovo!==undefined&&data.gasDoPovo!==!!before.gas_do_povo)||(data.gasDoPovoDelivery!==undefined&&data.gasDoPovoDelivery!==!!before.gas_do_povo_delivery);
 if(changed&&!(await client.query('SELECT 1 FROM bansir.establishments WHERE tenant_id=$1 AND id=$2 AND owner_user_id=$3',[context.tenantId,context.establishmentId,context.userId])).rowCount)throw httpError(403,'Somente o dono pode configurar preços por modalidade e Gás do Povo.','OWNER_REQUIRED');
}
export async function moveStock(client, context, input) {
  const data = movementInput.parse(input);
  const delta = data.type === 'in' ? data.quantity : -data.quantity;
  const { rows: [product] } = await client.query(`UPDATE bansir.products SET stock=stock+$3,updated_at=now()
    WHERE tenant_id=$1 AND id=$2 AND active AND stock+$3 >= 0 RETURNING *`, [context.tenantId, data.productId, delta]);
  if (!product) throw httpError(409, 'Produto indisponível ou estoque insuficiente.', 'STOCK_UNAVAILABLE');
  await stockMovement(client, context, product, data.quantity, data.type, data.reason);
  if(data.type==='out' && product.stock<=5){
    const {enqueueNotification}=await import('./notifications.js');
    const {randomUUID}=await import('node:crypto');
    await enqueueNotification(client,context,{key:`stock:${randomUUID()}`,title:'Estoque baixo',body:`${product.name}: ${product.stock} unidades disponíveis.`});
  }
  return { product: presentProduct(product) };
}
