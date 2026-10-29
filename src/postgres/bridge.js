import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {z} from 'zod';
import {httpError} from './database.js';
const hash=s=>createHash('sha256').update(s).digest('hex');
const same=(c,i)=>c.tenant_id===i.tenantId&&c.establishment_id===i.establishmentId;
const denied=()=>{throw httpError(403,'Somente administrador pode gerenciar equipamentos.','FORBIDDEN');};
const terminal=z.object({name:z.string().trim().min(1).max(80),provider:z.enum(['cielo','pagbank','caixa','itau_rede','sicredi','mercado_pago','other']),model:z.string().trim().min(1).max(100),connectionType:z.enum(['usb','network','bluetooth','tef','cloud']),deviceIdentifier:z.string().max(160).default(''),serialNumber:z.string().max(100).default(''),partNumber:z.string().max(100).default(''),enabled:z.boolean().default(true)}).strict();
export function createBridge(database){
 const sockets=new Map(),pending=new Map(),wss=new WebSocketServer({noServer:true,maxPayload:16384});let attached=false,upgrades=0;
 const send=(socket,data)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data));};
 const auth=async(h,installation=null,machine='')=>(await database.pool.query('SELECT * FROM bansir.bridge_auth($1,$2,$3)',[h,installation,machine])).rows[0];
 const terminals=ctx=>database.transaction({userId:ctx.user_id,tenantId:ctx.tenant_id,establishmentId:ctx.establishment_id},async c=>(await c.query('SELECT id,data FROM bansir.bridge_terminals ORDER BY id')).rows);
 const configure=async connection=>send(connection.socket,{type:'configuration.terminals',terminals:(await terminals(connection)).filter(r=>r.data.enabled).map(r=>({terminalId:r.id,...r.data}))});
 function cleanup(connection){sockets.delete(connection.id);for(const [key,p] of pending)if(p.connectionId===connection.id){clearTimeout(p.timer);p.reject(httpError(409,'Conector desconectado.','BRIDGE_OFFLINE'));pending.delete(key);}}
 wss.on('connection',(socket,request)=>{
  const connection={...request.bridge,id:randomUUID(),credentialId:request.bridge.id,socket,hash:request.bridgeHash,installationId:'',machine:'',version:'',paired:false,connectedAt:new Date(),lastSeenAt:new Date(),statuses:new Map(),alive:true,busy:false};sockets.set(connection.id,connection);
  const helloTimer=setTimeout(()=>socket.terminate(),10000);
  send(socket,{type:'server.hello',connectionId:connection.id,protocolVersion:1,heartbeatSeconds:20,capabilities:['diagnostics']});
  socket.on('error',()=>{});socket.on('pong',()=>{connection.alive=true;connection.lastSeenAt=new Date();});
  socket.on('message',async(raw,binary)=>{
   if(connection.busy)return socket.close(1008,'Message rate exceeded');connection.busy=true;
   try{
    if(binary)throw Error('Invalid message');const m=JSON.parse(raw.toString());
    if(m.type==='bridge.hello'&&!connection.paired){
     const hello=z.object({type:z.literal('bridge.hello'),protocolVersion:z.literal(1),installationId:z.string().min(1).max(100),machine:z.string().max(100),version:z.string().max(30)}).parse(m);
     if(!await auth(connection.hash,hello.installationId,hello.machine))return socket.close(1008,'Credential or installation denied');
     for(const c of sockets.values())if(c!==connection&&c.credentialId===connection.credentialId)c.socket.close(1008,'Reconnected');
     Object.assign(connection,{installationId:hello.installationId,machine:hello.machine,version:hello.version,paired:true});clearTimeout(helloTimer);
     send(socket,{type:'bridge.accepted',connectionId:connection.id,paired:true,capabilities:['diagnostics']});await configure(connection);
    }else if(!connection.paired)socket.close(1008,'Handshake required');
    else if(m.type==='diagnostics.pong'){
     const p=pending.get(m.correlationId);if(p?.connectionId===connection.id){clearTimeout(p.timer);pending.delete(m.correlationId);p.resolve({connectionId:connection.id,receivedAt:new Date()});}
    }else if(m.type==='terminal.status'&&Array.isArray(m.terminals)){
     const allowed=new Set((await terminals(connection)).map(t=>t.id));connection.statuses.clear();
     for(const t of m.terminals.slice(0,20))if(allowed.has(t.terminalId)&&['connected','ready','busy','disconnected','error','not_supported'].includes(t.status))connection.statuses.set(t.terminalId,t.status);
    }else send(socket,{type:'error',code:'UNSUPPORTED_MESSAGE'});
   }catch{send(socket,{type:'error',code:'INVALID_MESSAGE'});}finally{connection.busy=false;}
  });
  socket.on('close',()=>{clearTimeout(helloTimer);cleanup(connection);});
 });
 const heartbeat=setInterval(async()=>{for(const c of sockets.values()){try{if(!c.alive||!await auth(c.hash,c.installationId||null,c.machine)){c.socket.terminate();continue;}c.alive=false;c.socket.ping();}catch{c.socket.terminate();}}},20000);heartbeat.unref();
 return {
  attach(server){if(attached)return;attached=true;server.on('upgrade',async(req,socket,head)=>{socket.on('error',()=>{});if(upgrades>=20)return socket.destroy();upgrades++;socket.setTimeout(10000,()=>socket.destroy());try{if(new URL(req.url,'http://localhost').pathname!=='/api/v1/bridge/ws')return socket.destroy();
   if(req.headers.origin)return socket.destroy();const raw=String(req.headers.authorization||'').replace(/^Bearer /,'');
   if(!/^bpdv_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/.test(raw)||sockets.size>=100){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
   const credential=await auth(hash(raw));if(!credential){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}req.bridge=credential;req.bridgeHash=hash(raw);wss.handleUpgrade(req,socket,head,ws=>{socket.setTimeout(0);wss.emit('connection',ws,req);});
  }catch{socket.destroy();}finally{upgrades--;}});},
  list(i){return [...sockets.values()].filter(c=>same(c,i)).map(c=>({id:c.id,credentialId:c.credentialId,installationId:c.installationId,machine:c.machine,version:c.version,connectedAt:c.connectedAt,lastSeenAt:c.lastSeenAt,paired:c.paired,status:'online'}));},
  status(i,id){return [...sockets.values()].filter(c=>same(c,i)&&c.paired).map(c=>c.statuses.get(id)).find(s=>['ready','connected','busy'].includes(s))||[...sockets.values()].filter(c=>same(c,i)).map(c=>c.statuses.get(id)).find(Boolean)||'disconnected';},
  revoke(i,id){for(const c of sockets.values())if(same(c,i)&&c.credentialId===id)c.socket.close(1008,'Credential revoked');},
  async refresh(i){for(const c of sockets.values())if(same(c,i)&&c.paired)await configure(c);},
  ping(i,id){const c=sockets.get(id);if(!c||!same(c,i)||!c.paired)throw httpError(404,'Conector não encontrado.','NOT_FOUND');return new Promise((resolve,reject)=>{const key=randomUUID(),timer=setTimeout(()=>{pending.delete(key);reject(httpError(504,'Conector não respondeu.','BRIDGE_TIMEOUT'));},5000);pending.set(key,{resolve,reject,timer,connectionId:id});send(c.socket,{type:'diagnostics.ping',correlationId:key,timestamp:new Date().toISOString()});});},
  async close(){clearInterval(heartbeat);for(const c of sockets.values())c.socket.terminate();await new Promise(r=>wss.close(r));}
 };
}
export function mountBridge(app,{scoped,database,nodeEnv}){
 const bridge=createBridge(database);app.locals.bridge=bridge;
 const admin=fn=>scoped('settings',false,async(c,r,m)=>{if(!['admin','superadmin'].includes(m.role))denied();return fn(c,r);});
 app.get('/api/v1/bridge/tokens',admin(async c=>({data:(await c.query('SELECT id AS _id,label,created_at AS "createdAt",expires_at AS "expiresAt",revoked_at AS "revokedAt",last_used_at AS "lastUsedAt",last_machine AS "lastMachine" FROM bansir.bridge_credentials ORDER BY created_at DESC')).rows})));
 app.post('/api/v1/bridge/tokens',admin(async(c,r)=>{
  const {label}=z.object({label:z.string().trim().min(1).max(100)}).strict().parse(r.body),i=r.identity;
  const raw='bpdv_'+randomBytes(9).toString('base64url')+'.'+randomBytes(32).toString('base64url');
  const base=new URL(process.env.BRIDGE_PUBLIC_URL||(nodeEnv==='production'?'https://api-gas.bansir.com.br/api/v1':`http://127.0.0.1:${r.socket.localPort}/api/v1`));
  if(base.protocol!=='https:'&&!(nodeEnv!=='production'&&base.hostname==='127.0.0.1'))throw httpError(503,'Configure a URL segura do conector.','BRIDGE_URL_REQUIRED');
  const apiBaseUrl=base.origin+'/api/v1',webSocketUrl=apiBaseUrl.replace(/^http/,'ws')+'/bridge/ws';
  const {rows:[row]}=await c.query('INSERT INTO bansir.bridge_credentials(tenant_id,establishment_id,user_id,token_hash,label) VALUES($1,$2,$3,$4,$5) RETURNING id,expires_at',[i.tenantId,i.establishmentId,i.userId,hash(raw),label]);
  return {status:201,data:{id:row.id,label,token:'bpdv1_'+Buffer.from(JSON.stringify({version:1,apiBaseUrl,webSocketUrl,apiToken:raw})).toString('base64url'),expiresAt:row.expires_at}};
 }));
 app.delete('/api/v1/bridge/tokens/:id',admin(async(c,r)=>{const id=z.uuid().parse(r.params.id);await c.query('UPDATE bansir.bridge_credentials SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1',[id]);bridge.revoke(r.identity,id);return {data:true};}));
 app.get('/api/v1/bridge/connections',admin(async(c,r)=>({data:bridge.list(r.identity)})));
 app.post('/api/v1/bridge/connections/:id/ping',admin(async(c,r)=>({data:await bridge.ping(r.identity,r.params.id)})));
 app.get('/api/v1/settings/hardware',scoped('settings',true,async(c,r)=>({data:{capabilities:['diagnostics'],terminals:(await c.query('SELECT id,data FROM bansir.bridge_terminals ORDER BY id')).rows.map(t=>{const status=bridge.status(r.identity,t.id);return {_id:t.id,...t.data,status,connected:['connected','ready','busy'].includes(status)};})}})));
 for(const [method,path] of [['post','/api/v1/settings/hardware/terminals'],['put','/api/v1/settings/hardware/terminals/:id'],['delete','/api/v1/settings/hardware/terminals/:id']])app[method](path,admin(async(c,r)=>{
  const i=r.identity,id=method==='post'?randomUUID():z.uuid().parse(r.params.id);
  if(method==='delete')await c.query('DELETE FROM bansir.bridge_terminals WHERE id=$1',[id]);else {const data=terminal.parse(r.body);if(method==='post')await c.query('INSERT INTO bansir.bridge_terminals(tenant_id,establishment_id,id,data) VALUES($1,$2,$3,$4)',[i.tenantId,i.establishmentId,id,data]);else if(!(await c.query('UPDATE bansir.bridge_terminals SET data=$2 WHERE id=$1',[id,data])).rowCount)throw httpError(404,'Terminal não encontrado.','NOT_FOUND');}
  // Configuration is read after the HTTP transaction commits.
  r.res.once('finish',()=>bridge.refresh(i).catch(()=>{}));return {data:{_id:id}};
 }));
}
