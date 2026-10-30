import {createDeliveryGeocoder} from './delivery-geocoder.js';
import {point} from './delivery-planner.js';
import {verifyDeliveryArea} from './delivery-area.js';
import {routePlanInput,applySuggestedInsertion} from './delivery-route-state.js';
import {deliveryLocation} from './deliveries.js';
import {readProductImage} from './product-images.js';
import {businessStatus} from './business-hours.js';
import {requireFeature} from './features.js';
import {z} from 'zod';
import rateLimit from 'express-rate-limit';
import {randomBytes,createHash} from 'node:crypto';
import {httpError} from './database.js';
import {fiscalDraftHash} from './fiscal.js';
import {normalizePhone} from './phone.js';
import {createCustomer} from './customers.js';
import {registerSale,saleView} from './sales.js';
import {pricingDay,productQuote,basketShipping,storeTimeZones} from './product-pricing.js';

const money=z.number().int().min(0).max(1000000000),slugInput=z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/),text=z.string().trim();
const image=z.string().url().max(2048).refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'Use uma URL HTTPS de imagem.');
export const businessHoursInput=z.object({enabled:z.boolean().default(false),ignoreWhatsappOutsideHours:z.boolean().default(true),closingSoonMinutes:z.number().int().min(5).max(120).default(30),days:z.array(z.object({day:z.number().int().min(0).max(6),enabled:z.boolean(),open:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),close:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).strict().refine(d=>!d.enabled||d.open!==d.close,'Abertura e fechamento devem ser diferentes.')).length(7).refine(rows=>new Set(rows.map(r=>r.day)).size===7,'Informe cada dia uma vez.')}).strict();
export const storefrontConfig=z.object({deliveryRadiusKm:z.number().finite().min(0.1).max(1000).nullable().default(null),businessHours:businessHoursInput.optional(),location:z.object({address:z.string().trim().max(300).default(''),latitude:z.number().min(-90).max(90).nullable().default(null),longitude:z.number().min(-180).max(180).nullable().default(null),showMap:z.boolean().default(false)}).strict().refine(v=>(v.latitude===null)===(v.longitude===null),'Informe latitude e longitude juntas.').refine(v=>!v.showMap||v.latitude!==null,'Informe as coordenadas para exibir o mapa.').default({address:'',latitude:null,longitude:null,showMap:false}),timeZone:z.enum(storeTimeZones).default('America/Cuiaba'),name:text.min(2).max(100),headline:text.min(2).max(120),description:text.max(500).default(''),contactPhone:text.max(40).default('').transform(v=>normalizePhone(v,{optional:true})),primaryColor:z.string().regex(/^#[0-9a-fA-F]{6}$/),backgroundColor:z.string().regex(/^#[0-9a-fA-F]{6}$/),style:z.enum(['modern','classic','bold']).default('modern'),logoUrl:z.union([image,z.literal('')]).default(''),productIds:z.array(z.uuid()).max(200),productImages:z.record(z.uuid(),image).default({}),shippingMode:z.enum(['fixed','regions']).default('regions'),fixedShippingCents:money.default(0),allowPickup:z.boolean().default(true),acceptingOrders:z.boolean().default(true),zones:z.array(z.object({id:text.regex(/^[a-z0-9-]{1,60}$/),name:text.min(1).max(100),feeCents:money}).strict()).max(30),notices:z.array(z.object({title:text.min(1).max(80),body:text.max(400),tone:z.enum(['info','warning','success'])}).strict()).max(6)}).strict()
 .refine(d=>new Set(d.productIds).size===d.productIds.length,'Selecione cada produto uma única vez.')
 .refine(d=>new Set(d.zones.map(z=>z.id)).size===d.zones.length,'Cada região deve ter um identificador único.')
 .refine(d=>d.allowPickup||d.shippingMode==='fixed'||d.zones.length>0,'Habilite retirada ou cadastre uma região de entrega.');
export const defaultStorefront={name:'Ultragas',headline:'Seu gás e sua água, sem complicação.',description:'Escolha seus produtos e envie seu pedido para a loja.',contactPhone:'',primaryColor:'#125bea',backgroundColor:'#f5f8ff',style:'modern',logoUrl:'',productIds:[],productImages:{},shippingMode:'regions',fixedShippingCents:0,allowPickup:true,acceptingOrders:true,zones:[],notices:[{title:'Entrega combinada com você',body:'A loja confirma disponibilidade e entrega após receber o pedido.',tone:'info'}]};
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export async function publicStorefront(database,slug,checkoutHash,fn){
 const c=await database.pool.connect();let discard;
 try{
  await c.query('BEGIN');await c.query('SET LOCAL ROLE bansir_storefront');
  const store=(await c.query('SELECT tenant_id,establishment_id,slug,config FROM bansir.storefronts WHERE slug=$1',[slugInput.parse(slug)])).rows[0];
  if(!store)throw httpError(404,'Este link de pedidos não está disponível.','STOREFRONT_NOT_FOUND');
  await c.query("SELECT set_config('app.public_checkout','true',true),set_config('app.tenant_id',$1,true),set_config('app.establishment_id',$2,true),set_config('app.checkout_hash',$3,true)",[store.tenant_id,store.establishment_id,checkoutHash||'']);
  await requireFeature(c,'orderLink');
  const result=await fn(c,store);await c.query('COMMIT');return result;
 }catch(e){try{await c.query('ROLLBACK');}catch(rollback){discard=rollback;}throw e;}finally{c.release(discard);}
}
async function checkout(c){const row=(await c.query('SELECT id,phone FROM bansir.checkout_sessions WHERE expires_at>now()')).rows[0];if(!row)throw httpError(401,'Seu atendimento expirou. Informe o celular novamente.','CHECKOUT_EXPIRED');return row;}
const checkoutToken=req=>{const value=req.get('X-Checkout-Token')||'';if(!/^[a-f0-9]{64}$/.test(value))throw httpError(401,'Informe seu celular para iniciar o pedido.','CHECKOUT_REQUIRED');return tokenHash(value);};
const publicOrderInput=z.object({requestKey:z.uuid(),customerName:text.min(2).max(200),deliveryLocation:deliveryLocation.optional(),deliveryAddress:text.max(1000).default(''),fulfillment:z.enum(['pickup','delivery']),zoneId:text.max(60).default(''),expectedShippingCents:money,items:z.array(z.object({productId:z.uuid(),quantity:z.number().int().min(1).max(100),expectedUnitPriceCents:money.refine(n=>n>0)}).strict()).min(1).max(50)}).strict();

export function mountPublicStorefront(app,{database,route,clock=()=>new Date(),imageStorage,geocoder=createDeliveryGeocoder()}){
 const reads=rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-7',legacyHeaders:false});
 const starts=rateLimit({windowMs:3600000,limit:20,standardHeaders:'draft-7',legacyHeaders:false});
 const writes=rateLimit({windowMs:900000,limit:30,standardHeaders:'draft-7',legacyHeaders:false});
 app.get('/api/v1/public/stores/:slug/products/:id/image',reads,async(req,res,next)=>{
  try{const result=await publicStorefront(database,req.params.slug,null,async(c,store)=>{
   const id=z.uuid().parse(req.params.id);
   if(!store.config.productIds?.includes(id))throw httpError(404,'Imagem não encontrada.','NOT_FOUND');
   const p=(await c.query('SELECT image_id,image_key,image_mime FROM bansir.products WHERE id=$1 AND active',[id])).rows[0];
   if(!p?.image_key)throw httpError(404,'Imagem não encontrada.','NOT_FOUND');
   return readProductImage(p,imageStorage);
  });res.set({'Content-Type':result.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).send(result.body);}catch(e){next(e);}
 });
 app.get('/api/v1/public/stores/:slug',reads,route(async req=>({data:await publicStorefront(database,req.params.slug,null,async(c,store)=>{
  const products=(await c.query('SELECT id,name,price_cents,fulfillment_pricing,gas_do_povo,gas_do_povo_delivery,stock,unit,brand,category,image_id FROM bansir.products WHERE id=ANY($1::uuid[]) ORDER BY name',[store.config.productIds])).rows;
  const day=pricingDay(store.config.timeZone,clock());
  return {slug:store.slug,config:store.config,pricingDay:day,businessStatus:businessStatus(store.config,clock()),products:products.map(p=>({id:p.id,name:p.name,priceCents:Number(p.price_cents),...productQuote(p,day),available:p.stock>0,unit:p.unit,brand:p.brand,category:p.category,imageId:p.image_id||null,imageUrl:p.image_id?`/api/v1/public/stores/${encodeURIComponent(store.slug)}/products/${p.id}/image`:''}))};
 })})));
 app.post('/api/v1/public/stores/:slug/start',starts,route(async req=>{
  const {phone}=z.object({phone:z.string().min(8).max(40)}).strict().parse(req.body),normalized=normalizePhone(phone),token=randomBytes(32).toString('hex');
  return {status:201,data:await publicStorefront(database,req.params.slug,tokenHash(token),async(c,store)=>{
   if(!businessStatus(store.config,clock()).open)throw httpError(409,'A loja não está recebendo pedidos neste momento.','STORE_CLOSED');
   await c.query('INSERT INTO bansir.checkout_sessions(tenant_id,establishment_id,token_hash,phone) VALUES($1,$2,$3,$4)',[store.tenant_id,store.establishment_id,tokenHash(token),normalized]);
   // Never return customer ID, name, document, address or even whether this phone is registered.
   return {token,phone:normalized};
  })};
 }));
 app.post('/api/v1/public/stores/:slug/geocode',rateLimit({windowMs:3600000,limit:20,standardHeaders:'draft-7',legacyHeaders:false}),route(async req=>{
  const {address}=z.object({address:z.string().trim().min(8).max(300)}).strict().parse(req.body);
  const origin=await publicStorefront(database,req.params.slug,checkoutToken(req),async(c,store)=>{await checkout(c);return point(store.config.location);});
  const results=await geocoder.search(address,origin,req.params.slug);
  await publicStorefront(database,req.params.slug,checkoutToken(req),async c=>{await checkout(c);});return {data:results};
 }));
 app.post('/api/v1/public/stores/:slug/orders',writes,route(async req=>{
  const data=publicOrderInput.parse(req.body),fingerprint=fiscalDraftHash(data);
  return {status:201,data:await publicStorefront(database,req.params.slug,checkoutToken(req),async(c,store)=>{
   const session=await checkout(c);
   if(data.deliveryLocation&&data.fulfillment!=='delivery')throw httpError(400,'Localização só se aplica a entrega.','INVALID_LOCATION');
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`order:${session.id}:${data.requestKey}`]);
   const previous=(await c.query('SELECT id,status,total_cents,request_hash FROM bansir.storefront_orders WHERE checkout_session_id=$1 AND request_key=$2',[session.id,data.requestKey])).rows[0];
   if(previous){if(previous.request_hash!==fingerprint)throw httpError(409,'Esta tentativa já foi usada com outros produtos.','IDEMPOTENCY_CONFLICT');return {id:previous.id,status:previous.status,totalCents:Number(previous.total_cents)};}
   if(!businessStatus(store.config,clock()).open)throw httpError(409,'A loja não está recebendo pedidos.','STORE_CLOSED');
   if(data.fulfillment==='pickup'&&!store.config.allowPickup)throw httpError(400,'Esta loja trabalha apenas com entrega.','PICKUP_UNAVAILABLE');
   const fixed=store.config.shippingMode==='fixed',zone=data.fulfillment==='delivery'&&!fixed?store.config.zones.find(z=>z.id===data.zoneId):null;
   if(data.fulfillment==='delivery'&&((!fixed&&!zone)||data.deliveryAddress.length<5))throw httpError(400,'Selecione sua região e informe o endereço completo.','DELIVERY_REQUIRED');
   if(data.fulfillment==='delivery'&&fixed&&data.zoneId)throw httpError(400,'Frete fixo não utiliza região.','INVALID_ZONE');
   if(data.fulfillment==='delivery')verifyDeliveryArea(store.config,data.deliveryLocation);
   const normalShipping=data.fulfillment==='delivery'?(fixed?(store.config.fixedShippingCents||0):(zone?.feeCents||0)):0,day=pricingDay(store.config.timeZone,clock());
   if(new Set(data.items.map(i=>i.productId)).size!==data.items.length)throw httpError(400,'Agrupe os itens repetidos.','DUPLICATE_PRODUCT');
   if(data.items.some(i=>!store.config.productIds.includes(i.productId)))throw httpError(400,'Um produto não está mais disponível neste link.','PRODUCT_UNAVAILABLE');
   const products=(await c.query('SELECT id,name,price_cents,fulfillment_pricing,gas_do_povo,gas_do_povo_delivery,stock FROM bansir.products WHERE id=ANY($1::uuid[])',[data.items.map(i=>i.productId)])).rows;
   const items=data.items.map(i=>{const p=products.find(p=>p.id===i.productId);if(!p||p.stock<i.quantity)throw httpError(409,'Um produto não possui a quantidade disponível.','STOCK_UNAVAILABLE');const quote=productQuote(p,day);if(data.fulfillment==='delivery'&&!quote.allowDelivery)throw httpError(409,'Gás do Povo disponível somente para retirada na loja. Remova o produto ou escolha retirada.','PROGRAM_PICKUP_ONLY');const price=data.fulfillment==='delivery'?quote.deliveryCents:quote.pickupCents;if(price!==i.expectedUnitPriceCents)throw httpError(409,'O preço foi atualizado. Recarregue os produtos antes de confirmar.','PRICE_CHANGED');return {productId:p.id,name:p.name,quantity:i.quantity,priceCents:price,deliveryIncluded:data.fulfillment==='delivery'&&quote.deliveryIncluded,gasDoPovo:quote.gasDoPovo};});
   const shipping=basketShipping(items,data.fulfillment,normalShipping);if(shipping!==data.expectedShippingCents)throw httpError(409,'O frete foi atualizado. Confira o pedido novamente.','SHIPPING_CHANGED');
   const subtotal=items.reduce((n,i)=>n+i.quantity*i.priceCents,0),total=subtotal+shipping;if(total>1000000000)throw httpError(400,'Valor do pedido acima do limite.','INVALID_TOTAL');
   const row=(await c.query(`INSERT INTO bansir.storefront_orders(tenant_id,establishment_id,checkout_session_id,request_key,request_hash,customer_name,delivery_address,fulfillment,zone_id,items,subtotal_cents,shipping_cents,total_cents,pricing_context,delivery_location)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id,status,total_cents`,[store.tenant_id,store.establishment_id,session.id,data.requestKey,fingerprint,data.customerName,data.deliveryAddress,data.fulfillment,data.zoneId,JSON.stringify(items),subtotal,shipping,total,day,data.deliveryLocation||null])).rows[0];
   return {id:row.id,status:row.status,totalCents:Number(row.total_cents)};
  })};
 }));
 app.get('/api/v1/public/stores/:slug/orders/:id',reads,route(async req=>({data:await publicStorefront(database,req.params.slug,checkoutToken(req),async c=>{
  await checkout(c);const row=(await c.query('SELECT id,status,total_cents FROM bansir.storefront_orders WHERE id=$1',[z.uuid().parse(req.params.id)])).rows[0];if(!row)throw httpError(404,'Pedido não encontrado.','NOT_FOUND');return {id:row.id,status:row.status,totalCents:Number(row.total_cents)};
 })})));
}

export function mountStorefrontAdmin(app,{scoped}){
 app.get('/api/v1/storefront/settings',scoped('settings',true,async c=>({data:(await c.query('SELECT slug,enabled,config FROM bansir.storefronts')).rows[0]||{slug:'',enabled:false,config:defaultStorefront}})));
 app.put('/api/v1/storefront/settings',scoped('settings',false,async(c,req,member)=>{
  const data=z.object({slug:slugInput,enabled:z.boolean(),config:storefrontConfig}).strict().parse(req.body),i=req.identity;
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`storefront-settings:${i.tenantId}:${i.establishmentId}`]);
  const previous=(await c.query('SELECT config FROM bansir.storefronts')).rows[0]?.config;
  const shipping=c=>({timeZone:c?.timeZone||'America/Cuiaba',shippingMode:c?.shippingMode||'regions',fixedShippingCents:c?.fixedShippingCents||0,zones:c?.zones||[],location:{latitude:c?.location?.latitude??null,longitude:c?.location?.longitude??null},deliveryRadiusKm:c?.deliveryRadiusKm??null,allowPickup:c?.allowPickup??true});
  if(member.owner_user_id!==i.userId&&(!previous||fiscalDraftHash(shipping(previous))!==fiscalDraftHash(shipping(data.config))))throw httpError(403,'Somente o dono do estabelecimento pode alterar o frete e a retirada.','OWNER_REQUIRED');
  const count=(await c.query('SELECT id FROM bansir.products WHERE active AND id=ANY($1::uuid[])',[data.config.productIds])).rowCount;if(count!==data.config.productIds.length)throw httpError(400,'Selecione apenas produtos ativos deste estabelecimento.','INVALID_PRODUCTS');
  if(data.enabled&&!data.config.productIds.length)throw httpError(400,'Escolha os produtos antes de ativar o link.','EMPTY_CATALOG');
  if(previous)await c.query('UPDATE bansir.storefronts SET slug=$3,enabled=$4,config=$5,updated_at=now() WHERE tenant_id=$1 AND establishment_id=$2',[i.tenantId,i.establishmentId,data.slug,data.enabled,data.config]);
  else await c.query('INSERT INTO bansir.storefronts(tenant_id,establishment_id,slug,enabled,config) VALUES($1,$2,$3,$4,$5)',[i.tenantId,i.establishmentId,data.slug,data.enabled,data.config]);return {data};
 }));
 app.get('/api/v1/storefront/conversations',scoped('sales',true,async(c,req)=>{
  const page=z.coerce.number().int().min(0).max(10000).default(0).parse(req.query.page),search=z.string().max(200).default('').parse(req.query.search);
  const result=await c.query(`WITH contacts AS (SELECT phone FROM bansir.meta_messages WHERE message_id NOT LIKE 'attempt:%' UNION SELECT phone FROM bansir.storefront_orders)
   SELECT p.phone,coalesce(nullif(CASE WHEN customer.name ~ '[[:alpha:]]' THEN customer.name END,''),nullif(CASE WHEN ord.customer_name ~ '[[:alpha:]]' THEN ord.customer_name END,''),p.phone) AS name,
   last_msg.body AS last_message,last_msg.direction,last_msg.received_at AS last_message_at,inbound.last_inbound,
   inbound.last_inbound+interval '24 hours' AS window_expires_at,ord.created_at AS last_order_at,
   (SELECT count(*) FROM bansir.storefront_orders o WHERE o.phone=p.phone) AS order_count,
   coalesce((SELECT jsonb_agg(x ORDER BY x.received_at) FROM (SELECT direction,body,status,received_at FROM bansir.meta_messages WHERE phone=p.phone AND message_id NOT LIKE 'attempt:%' ORDER BY received_at DESC LIMIT 20)x),'[]') AS messages,
   count(*) OVER() AS total
   FROM contacts p
   LEFT JOIN LATERAL(SELECT name FROM bansir.customers WHERE active AND bansir.customer_lookup_phone(phone,import_metadata)=p.phone ORDER BY created_at LIMIT 1) customer ON true
   LEFT JOIN LATERAL(SELECT customer_name,created_at FROM bansir.storefront_orders WHERE phone=p.phone ORDER BY created_at DESC LIMIT 1) ord ON true
   LEFT JOIN LATERAL(SELECT body,direction,received_at FROM bansir.meta_messages WHERE phone=p.phone AND message_id NOT LIKE 'attempt:%' ORDER BY received_at DESC LIMIT 1) last_msg ON true
   LEFT JOIN LATERAL(SELECT max(received_at) AS last_inbound FROM bansir.meta_messages WHERE phone=p.phone AND direction='in') inbound ON true
   WHERE ($1='' OR p.phone ILIKE '%'||$1||'%' OR customer.name ILIKE '%'||$1||'%' OR ord.customer_name ILIKE '%'||$1||'%')
   ORDER BY greatest(last_msg.received_at,ord.created_at) DESC LIMIT 30 OFFSET $2`,[search,page*30]);
  return {data:result.rows.map(({total,...r})=>r),meta:{total:Number(result.rows[0]?.total||0),serverNow:new Date().toISOString()}};
 }));
 app.get('/api/v1/storefront/orders/map',scoped('sales',true,async c=>{
  const store=point((await c.query('SELECT config FROM bansir.storefronts')).rows[0]?.config?.location);
  const rows=(await c.query(`SELECT o.id,o.customer_name,o.delivery_address,o.delivery_location,d.latitude,d.longitude,d.status AS delivery_status,d.delivered_at,
   o.status AS order_status,count(*) OVER()::int AS total
   FROM bansir.storefront_orders o LEFT JOIN bansir.delivery_tasks d ON (d.tenant_id,d.establishment_id,d.sale_id)=(o.tenant_id,o.establishment_id,o.sale_id)
   WHERE o.fulfillment='delivery' AND o.status IN('new','accepted')
   AND NOT EXISTS(SELECT 1 FROM bansir.sale_cancellations x WHERE(x.tenant_id,x.establishment_id,x.sale_id)=(o.tenant_id,o.establishment_id,o.sale_id))
   AND (d.status IS NULL OR d.status<>'cancelled')
   AND (d.status IS DISTINCT FROM 'delivered' OR d.delivered_at>now()-interval '5 minutes')
   ORDER BY (o.status='new') DESC,o.created_at,id LIMIT 1000`)).rows;
  const data=rows.map(o=>({id:o.id,name:o.customer_name,address:o.delivery_address,point:point(o)||point(o.delivery_location),status:o.delivery_status==='delivered'?'delivered':o.delivery_status==='en_route'?'en_route':o.delivery_status==='failed'?'failed':o.order_status==='accepted'?'accepted':'new',deliveredAt:o.delivered_at}));
  return {data:{store,orders:data,total:rows[0]?.total||0,limited:(rows[0]?.total||0)>1000,updatedAt:new Date().toISOString()}};
 }));
 app.get('/api/v1/storefront/orders',scoped('sales',true,async(c,req)=>{
  const q=z.object({page:z.coerce.number().int().min(0).max(100000).default(0),pageSize:z.coerce.number().int().min(1).max(100).default(30),status:z.enum(['all','new','accepted','rejected','cancelled']).default('all'),search:z.string().trim().max(200).default('')}).parse(req.query);
  const where="($1='all' OR status=$1) AND($2='' OR strpos(lower(customer_name||' '||phone||' '||delivery_address||' '||id::text),lower($2))>0)";
  const total=(await c.query(`SELECT count(*)::int AS total FROM bansir.storefront_orders WHERE ${where}`,[q.status,q.search])).rows[0].total;
  const stats=(await c.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE status='new')::int AS pending,count(*) FILTER(WHERE status='accepted')::int AS accepted,count(*) FILTER(WHERE status IN('rejected','cancelled'))::int AS closed FROM bansir.storefront_orders")).rows[0];
  const rows=(await c.query(`SELECT * FROM bansir.storefront_orders WHERE ${where} ORDER BY (status='new') DESC,CASE WHEN status='new' THEN created_at END ASC,created_at DESC,id LIMIT $3 OFFSET $4`,[q.status,q.search,q.pageSize,q.page*q.pageSize])).rows;
  return {data:rows.map(o=>({...o,subtotal_cents:Number(o.subtotal_cents),shipping_cents:Number(o.shipping_cents),total_cents:Number(o.total_cents)})),meta:{total,stats,page:q.page,pageSize:q.pageSize}};
 }));
 app.post('/api/v1/storefront/orders/:id/accept',scoped('sales',false,async(c,req,member)=>{
  const input=z.object({customerConfirmed:z.literal(true),deliveryEmployeeId:z.uuid().optional(),routePlan:routePlanInput.optional()}).strict().parse(req.body),id=z.uuid().parse(req.params.id),i=req.identity;
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`accept:${i.tenantId}:${i.establishmentId}:${id}`]);
  const order=(await c.query('SELECT * FROM bansir.storefront_orders WHERE id=$1',[id])).rows[0];if(!order)throw httpError(404,'Pedido não encontrado.','NOT_FOUND');
  if(order.sale_id)return {data:await saleView(c,order.sale_id)};if(order.status!=='new')throw httpError(409,'Pedido já encerrado.','ORDER_CLOSED');
  if(input.routePlan){await requireFeature(c,'deliveries');if(!input.deliveryEmployeeId||order.fulfillment!=='delivery')throw httpError(400,'Escolha um entregador para aplicar a rota sugerida.','INVALID_ROUTE_PLAN');}
  const customer=await createCustomer(c,i,{name:order.customer_name,phone:order.phone,document:'',address:order.delivery_address},{useExisting:true});
  const sale=await registerSale(c,i,member,{requestKey:order.id,items:order.items.map(item=>({productId:item.productId,quantity:item.quantity,expectedUnitPriceCents:item.priceCents})),customerId:customer.id,deliveryMode:order.fulfillment,deliveryAddress:order.delivery_address,deliveryFeeCents:Number(order.shipping_cents),payment:{method:'pending',term:order.fulfillment==='delivery'?'delivery':'pickup'},...(input.deliveryEmployeeId?{deliveryEmployeeId:input.deliveryEmployeeId}:{})},{quotedItems:order.items});
  if(order.delivery_location)await c.query("UPDATE bansir.delivery_tasks SET latitude=$2,longitude=$3,accuracy=$4,destination_source='customer-confirmed' WHERE sale_id=$1",[sale.id,order.delivery_location.latitude,order.delivery_location.longitude,order.delivery_location.accuracy]);
  if(input.routePlan)await applySuggestedInsertion(c,i,sale.id,input.deliveryEmployeeId,input.routePlan);
  await c.query("UPDATE bansir.storefront_orders SET status='accepted',sale_id=$2,accepted_by=$3,customer_id=$4,updated_at=now() WHERE id=$1",[id,sale.id,i.userId,customer.id]);return {status:201,data:sale};
 }));
 app.post('/api/v1/storefront/orders/:id/reject',scoped('sales',false,async(c,req)=>{
  const {reason}=z.object({reason:text.min(3).max(500)}).strict().parse(req.body),id=z.uuid().parse(req.params.id),i=req.identity;
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`accept:${i.tenantId}:${i.establishmentId}:${id}`]);
  const previous=(await c.query('SELECT status,rejection_reason FROM bansir.storefront_orders WHERE id=$1',[id])).rows[0];
  if(previous?.status==='rejected'&&previous.rejection_reason===reason)return {data:{id,status:'rejected'}};
  const result=await c.query("UPDATE bansir.storefront_orders SET status='rejected',rejection_reason=$2,updated_at=now() WHERE id=$1 AND status='new' RETURNING id",[id,reason]);if(!result.rowCount)throw httpError(409,'Pedido já foi encerrado ou não está disponível.','ORDER_CLOSED');return {data:{id,status:'rejected'}};
 }));
}

