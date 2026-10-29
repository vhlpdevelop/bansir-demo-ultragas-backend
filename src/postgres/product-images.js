import {randomUUID} from 'node:crypto';
import {S3Client,PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {httpError} from './database.js';
import {requirePermission,resourceId} from './catalog.js';
export function imageType(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.length>2*1024*1024)throw httpError(400,'Envie uma imagem JPG, PNG ou WebP de até 2 MB.','INVALID_IMAGE');
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return ['image/png','png'];
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return ['image/jpeg','jpg'];
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return ['image/webp','webp'];
 throw httpError(400,'Formato inválido. Use JPG, PNG ou WebP.','INVALID_IMAGE');
}
export function mountProductImages(app,{scoped,database,imageStorage}){
 const s3=imageStorage||new S3Client({region:process.env.AWS_REGION||'sa-east-1',requestHandler:{requestTimeout:20000,connectionTimeout:5000}});
 const bucket=()=>{if(!process.env.PRODUCT_IMAGES_BUCKET)throw httpError(409,'O armazenamento de imagens ainda não foi configurado.','IMAGE_STORAGE_PENDING');return process.env.PRODUCT_IMAGES_BUCKET;};
 app.put('/api/v1/products/:id/image',scoped('products',false,async(c,req)=>{
  const [mime,extension]=imageType(req.body),id=resourceId(req.params.id);
  if(req.get('content-type')!==mime)throw httpError(400,'O conteúdo não corresponde ao formato informado.','INVALID_IMAGE');
  const product=(await c.query('SELECT id FROM bansir.products WHERE id=$1 AND active FOR UPDATE',[id])).rows[0];
  if(!product)throw httpError(404,'Produto não encontrado.','NOT_FOUND');
  const imageId=randomUUID(),key=`products/${req.identity.tenantId}/${req.identity.establishmentId}/${id}/${imageId}.${extension}`;
  await s3.send(new PutObjectCommand({Bucket:bucket(),Key:key,Body:req.body,ContentType:mime,ServerSideEncryption:'AES256',CacheControl:'private, no-store'}));
  await c.query('UPDATE bansir.products SET image_id=$2,image_key=$3,image_mime=$4,updated_at=now() WHERE id=$1',[id,imageId,key,mime]);
  return {data:{imageId}};
 }));
 app.get('/api/v1/products/:id/image',async(req,res,next)=>{
  try{
   const bytes=await database.transaction(req.identity,async(c,member)=>{
    requirePermission(member,'products',true);
    const p=(await c.query('SELECT image_key,image_mime FROM bansir.products WHERE id=$1 AND active',[resourceId(req.params.id)])).rows[0];
    if(!p?.image_key)throw httpError(404,'Imagem não encontrada.','NOT_FOUND');
    const object=await s3.send(new GetObjectCommand({Bucket:bucket(),Key:p.image_key}));
    return {mime:p.image_mime,body:Buffer.from(await object.Body.transformToByteArray())};
   });res.set({'Content-Type':bytes.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(bytes.body);
  }catch(e){next(e);}
 });
}
