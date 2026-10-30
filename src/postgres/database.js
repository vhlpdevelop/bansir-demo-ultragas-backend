import pg from 'pg';

export function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}
export function validId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function createDatabase({ connectionString, max = 10 }) {
  if (!connectionString) throw new Error('DATABASE_URL é obrigatória para PostgreSQL.');
  const pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    statement_timeout: 15000, application_name: 'bansir-ultragas' });
  // A network failure on an idle client must not terminate the process.
  pool.on('error', () => console.error('[postgres] Conexão ociosa interrompida.'));

  async function transaction({ userId, tenantId, establishmentId, sessionId, allowPasswordChange=false }, callback) {
    if (!validId(userId) || (tenantId !== undefined && !validId(tenantId)) ||
        (establishmentId !== undefined && (!tenantId || !validId(establishmentId))) ||
        (sessionId !== undefined && !validId(sessionId))) {
      throw httpError(401, 'Contexto de sessão inválido.', 'INVALID_SESSION');
    }
    const client = await pool.connect();
    let discard;
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)", [userId, tenantId || '']);
      await client.query("SELECT set_config('app.establishment_id', $1, true)", [establishmentId || '']);
      let membership;
      if (tenantId) {
        const result = establishmentId
          ? await client.query(`SELECT em.role,em.allowed_routes,t.id,t.slug,t.name,e.id AS establishment_id,e.name AS establishment_name,e.owner_user_id
            FROM bansir.establishment_memberships em
            JOIN bansir.establishments e ON e.tenant_id=em.tenant_id AND e.id=em.establishment_id
            JOIN bansir.tenants t ON t.id=em.tenant_id
            JOIN bansir.tenant_memberships m ON m.tenant_id=em.tenant_id AND m.user_id=em.user_id
            JOIN bansir.users u ON u.id=em.user_id
            WHERE em.user_id=$1 AND em.tenant_id=$2 AND em.establishment_id=$3
              AND em.active AND e.active AND m.active AND t.active AND u.active`, [userId,tenantId,establishmentId])
          : await client.query(`SELECT m.role,m.allowed_routes,t.id,t.slug,t.name
            FROM bansir.tenant_memberships m JOIN bansir.tenants t ON t.id=m.tenant_id
            JOIN bansir.users u ON u.id=m.user_id
            WHERE m.user_id=$1 AND m.tenant_id=$2 AND m.active AND t.active AND u.active`, [userId,tenantId]);
        membership = result.rows[0];
        if (!membership) throw httpError(403, establishmentId?'Você não tem acesso a este estabelecimento.':'Você não tem acesso a esta empresa.', establishmentId?'ESTABLISHMENT_FORBIDDEN':'TENANT_FORBIDDEN');
      }
      if (sessionId) {
        const { rowCount } = await client.query(`SELECT 1 FROM bansir.access_sessions WHERE id=$1 AND user_id=$2
          AND tenant_id=$3 AND establishment_id=$4 AND revoked_at IS NULL AND expires_at>now()`,
        [sessionId,userId,tenantId,establishmentId]);
        if (!rowCount) throw httpError(401,'Sessão encerrada. Selecione o estabelecimento novamente.','SESSION_REVOKED');
      }
      if(tenantId&&!allowPasswordChange){
        const user=(await client.query('SELECT must_change_password FROM bansir.users WHERE id=$1',[userId])).rows[0];
        if(user?.must_change_password)throw httpError(403,'Altere sua senha temporária antes de continuar.','PASSWORD_CHANGE_REQUIRED');
      }
      const result = await callback(client, membership);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) { discard = rollbackError; }
      throw error;
    } finally { client.release(discard); }
  }

  const closeHooks=[];
  return {
    onClose:fn=>closeHooks.push(fn),
    pool, transaction,
    async ready() {
      const { rows: [role] } = await pool.query(`SELECT r.rolsuper, r.rolbypassrls,
        EXISTS (SELECT 1 FROM pg_roles elevated WHERE (elevated.rolsuper OR elevated.rolbypassrls)
          AND pg_has_role(current_user,elevated.oid,'MEMBER')) AS privileged_membership,
        EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='bansir' AND c.relkind='r' AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns_tables
        FROM pg_roles r WHERE r.rolname=current_user`);
      if (!role || role.rolsuper || role.rolbypassrls || role.privileged_membership || role.owns_tables) {
        throw new Error('DATABASE_URL deve usar papel de execução sem propriedade das tabelas, superuser ou BYPASSRLS.');
      }
      await pool.query('SELECT 1 FROM bansir.products LIMIT 0');
    },
    async ping() { await pool.query('SELECT 1'); },
    close: async () => {await Promise.allSettled(closeHooks.map(fn=>fn()));await pool.end();}
  };
}
