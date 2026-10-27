import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { httpError,validId } from './database.js';

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
    const { rows:[user] }=await client.query('SELECT id,name,email,phone FROM bansir.users WHERE id=$1 AND active',[userId]);
    if (!user) throw httpError(401,'Conta inativa.','USER_INACTIVE');
    const tenant={id:member.id,slug:member.slug,name:member.name};
    const establishment={id:member.establishment_id,name:member.establishment_name};
    return {user:{...user,_id:user.id,role:member.role,isEstablishmentOwner:member.owner_user_id===userId,allowedRoutes:member.allowed_routes,tenant,establishment,
      notificationPreferences:{},devices:[]},tenant,establishment};
  }
  async function issue(userId,tenantId,establishmentId,selectionId) {
    return database.transaction({userId,tenantId,establishmentId},async (client,member)=>{
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
  async function selection(userId,sessionId) {
    return database.transaction({userId},async client=>{
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
    session:context=>database.transaction(context,(client,member)=>profile(client,member,context.userId)),
    async login({email,password}) {
      if (typeof email!=='string' || typeof password!=='string' || email.length>254 || password.length>200) throw httpError(400,'Informe e-mail e senha válidos.','INVALID_INPUT');
      const { rows:[user] }=await database.pool.query('SELECT id,password_hash,active FROM bansir.users WHERE email=$1',[email.trim().toLowerCase()]);
      const hash=user?.password_hash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
      const matches=await bcrypt.compare(password,hash);
      if (!user?.active || !matches) throw httpError(401,'E-mail ou senha incorretos.','INVALID_CREDENTIALS');
      const choices=await establishments(user.id);
      if (!choices.length) throw httpError(403,'Sua conta não possui estabelecimento ativo.','NO_ESTABLISHMENTS');
      if (choices.length===1) return issue(user.id,choices[0].tenant.id,choices[0].id);
      return selection(user.id);
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
