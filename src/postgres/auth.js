import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { httpError,validId } from './database.js';
import {z} from 'zod';

const audience='bansir-ultragas-postgres';
export function createAuth(database,{ jwtSecret,expiresIn='1h' }) {
  if (!jwtSecret || jwtSecret.length<32) throw new Error('PostgreSQL exige JWT_SECRET com pelo menos 32 caracteres.');
  const sign=(payload,lifetime) => jwt.sign(payload,jwtSecret,{algorithm:'HS256',issuer:'bansir',audience,expiresIn:lifetime});
  function verify(token,purpose) {
    try {
      const payload=jwt.verify(token,jwtSecret,{algorithms:['HS256'],issuer:'bansir',audience});
      if (payload.purpose!==purpose || !validId(payload.id) || !validId(payload.jti) ||
          (purpose==='access' && (!validId(payload.tenantId) || !validId(payload.establishmentId)))) throw new Error();
      return payload;
    } catch { throw httpError(401,'Sessão inválida ou expirada. Faça login novamente.','INVALID_SESSION'); }
  }
  const available=async (client,userId) => {
    const { rows }=await client.query(`SELECT e.id,e.name,t.id AS tenant_id,t.name AS tenant_name,t.slug
      FROM bansir.establishment_memberships em
      JOIN bansir.establishments e ON e.tenant_id=em.tenant_id AND e.id=em.establishment_id
      JOIN bansir.tenants t ON t.id=em.tenant_id
      JOIN bansir.tenant_memberships m ON m.tenant_id=em.tenant_id AND m.user_id=em.user_id
      JOIN bansir.users u ON u.id=em.user_id
      WHERE em.user_id=$1 AND em.active AND e.active AND m.active AND t.active AND u.active
      ORDER BY t.name,e.name,e.id`,[userId]);
    return rows.map(e=>({id:e.id,name:e.name,tenant:{id:e.tenant_id,name:e.tenant_name,slug:e.slug}}));
  };
  const establishments=userId=>database.transaction({userId},client=>available(client,userId));
  async function profile(client,member,userId) {
    const { rows:[user] }=await client.query('SELECT id,name,email,phone,must_change_password AS "mustChangePassword" FROM bansir.users WHERE id=$1 AND active',[userId]);
    if (!user) throw httpError(401,'Conta inativa.','USER_INACTIVE');
    const tenant={id:member.id,slug:member.slug,name:member.name};
    const establishment={id:member.establishment_id,name:member.establishment_name};
    return {user:{...user,_id:user.id,role:member.role,isEstablishmentOwner:member.owner_user_id===userId,allowedRoutes:member.allowed_routes,tenant,establishment,
      notificationPreferences:{},devices:[]},tenant,establishment};
  }
  async function verifyLoginHash(client,userId,expectedHash){
    if(expectedHash){const row=(await client.query('SELECT bansir.lock_own_password() AS password_hash')).rows[0];if(row?.password_hash!==expectedHash)throw httpError(401,'Credenciais alteradas. Entre novamente.','INVALID_CREDENTIALS');}
  }
  async function issue(userId,tenantId,establishmentId,selectionId,expectedHash) {
    return database.transaction({userId,tenantId,establishmentId,allowPasswordChange:true},async (client,member)=>{
      await verifyLoginHash(client,userId,expectedHash);
      if (selectionId) {
        const { rowCount }=await client.query(`UPDATE bansir.selection_requests SET consumed_at=now()
          WHERE id=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING id`,[selectionId,userId]);
        if (!rowCount) throw httpError(401,'Seleção expirada ou já utilizada. Volte ao login.','SELECTION_EXPIRED');
      }
      const data=await profile(client,member,userId);
      const jti=randomUUID();
      const token=sign({id:userId,tenantId,establishmentId,jti,purpose:'access'},expiresIn);
      await client.query(`INSERT INTO bansir.access_sessions(id,user_id,tenant_id,establishment_id,expires_at)
        VALUES($1,$2,$3,$4,$5)`,[jti,userId,tenantId,establishmentId,new Date(jwt.decode(token).exp*1000)]);
      return {...data,token};
    });
  }
  async function selection(userId,sessionId,expectedHash) {
    return database.transaction({userId},async client=>{
      await verifyLoginHash(client,userId,expectedHash);
      const choices=await available(client,userId);
      if (!choices.length) throw httpError(403,'Sua conta não possui estabelecimento ativo.','NO_ESTABLISHMENTS');
      if (sessionId) {
        const { rowCount }=await client.query(`UPDATE bansir.access_sessions SET revoked_at=now()
          WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>now() RETURNING id`,[sessionId,userId]);
        if (!rowCount) throw httpError(401,'Sessão já encerrada. Volte ao login.','SESSION_REVOKED');
      }
      const jti=randomUUID();
      const selectionToken=sign({id:userId,jti,purpose:'establishment_selection'},'5m');
      await client.query('INSERT INTO bansir.selection_requests(id,user_id,expires_at) VALUES($1,$2,$3)',
        [jti,userId,new Date(jwt.decode(selectionToken).exp*1000)]);
      return {requiresEstablishmentSelection:true,establishments:choices,selectionToken};
    });
  }
  return {
    establishments,
    session:context=>database.transaction({...context,allowPasswordChange:true},(client,member)=>profile(client,member,context.userId)),
    async changePassword(context,body){
      const data=z.object({currentPassword:z.string().min(1).max(200),newPassword:z.string().min(8).max(72).refine(v=>Buffer.byteLength(v,'utf8')<=72,'Use no máximo 72 bytes na senha.')}).strict().parse(body);
      if(data.currentPassword===data.newPassword)throw httpError(400,'Escolha uma senha diferente da atual.','PASSWORD_UNCHANGED');
      return database.transaction({...context,allowPasswordChange:true},async client=>{
        const row=(await client.query('SELECT bansir.lock_own_password() AS password_hash')).rows[0];
        if(!row||!await bcrypt.compare(data.currentPassword,row.password_hash))throw httpError(400,'Senha atual incorreta.','INVALID_CURRENT_PASSWORD');
        const hash=await bcrypt.hash(data.newPassword,12);
        const result=(await client.query('SELECT bansir.change_own_password($1,$2) AS changed',[row.password_hash,hash])).rows[0];
        if(!result.changed)throw httpError(409,'Credenciais alteradas. Entre novamente.','PASSWORD_CHANGED');
        return {changed:true,requiresLogin:true};
      });
    },
    async login({email,password}) {
      if (typeof email!=='string' || typeof password!=='string' || email.length>254 || password.length>200) throw httpError(400,'Informe e-mail e senha válidos.','INVALID_INPUT');
      const { rows:[user] }=await database.pool.query('SELECT id,password_hash,active FROM bansir.users WHERE email=$1',[email.trim().toLowerCase()]);
      const hash=user?.password_hash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
      const matches=await bcrypt.compare(password,hash);
      if (!user?.active || !matches) throw httpError(401,'E-mail ou senha incorretos.','INVALID_CREDENTIALS');
      const choices=await establishments(user.id);
      if (!choices.length) throw httpError(403,'Sua conta não possui estabelecimento ativo.','NO_ESTABLISHMENTS');
      if (choices.length===1) return issue(user.id,choices[0].tenant.id,choices[0].id,undefined,hash);
      return selection(user.id,undefined,hash);
    },
    async select({selectionToken,tenantId,establishmentId}) {
      const payload=verify(selectionToken,'establishment_selection');
      if (!validId(tenantId) || !validId(establishmentId)) throw httpError(400,'Estabelecimento inválido.','INVALID_ESTABLISHMENT');
      return issue(payload.id,tenantId,establishmentId,payload.jti);
    },
    returnToSelection:identity=>selection(identity.userId,identity.sessionId),
    protect(req,res,next) {
      try {
        const token=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7).trim():'';
        const payload=verify(token,'access');
        req.identity={userId:payload.id,tenantId:payload.tenantId,establishmentId:payload.establishmentId,sessionId:payload.jti};
        next();
      } catch (error) {next(error);}
    }
  };
}
