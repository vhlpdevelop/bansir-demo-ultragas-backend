import {z} from 'zod';

const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
const appearance=z.object({
 mode:z.enum(['light','dark','mixed','custom']),
 custom:z.object({base:z.enum(['light','dark','mixed']),accent:color,sidebar:color}).strict()
}).strict();

export function mountAppearance(app,{route,database}){
 const own=handler=>route(async req=>database.transaction(req.identity,c=>handler(c,req)));
 app.get('/api/v1/account/appearance',own(async(c,req)=>{
  const {rows}=await c.query('SELECT preference FROM bansir.user_appearance WHERE user_id=$1',[req.identity.userId]);
  return {data:rows[0]?.preference||null};
 }));
 app.put('/api/v1/account/appearance',own(async(c,req)=>{
  const preference=appearance.parse(req.body);
  await c.query(`INSERT INTO bansir.user_appearance(user_id,preference) VALUES($1,$2)
   ON CONFLICT(user_id) DO UPDATE SET preference=excluded.preference`,[req.identity.userId,preference]);
  return {data:preference};
 }));
}
