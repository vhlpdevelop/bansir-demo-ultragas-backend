import pg from 'pg';
export async function enqueue(client,identity,{kind,key,payload,maxAttempts=8}) {
 const {rows:[job]}=await client.query(`INSERT INTO bansir.jobs(tenant_id,establishment_id,kind,dedupe_key,payload,max_attempts)
 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,establishment_id,kind,dedupe_key) DO NOTHING RETURNING id`,[identity.tenantId,identity.establishmentId,kind,key,payload,maxAttempts]);
 return job?.id;
}
export function createQueue(connectionString) {
 const pool=new pg.Pool({connectionString,max:3,connectionTimeoutMillis:10000,statement_timeout:15000,application_name:'bansir-worker'});
 pool.on('error',()=>console.error('[worker] Database connection error'));
 return {
  pool,
  async ready(){const {rows:[role]}=await pool.query(`SELECT rolsuper,rolbypassrls,pg_has_role(current_user,'bansir_worker','MEMBER') AS worker,
   EXISTS(SELECT 1 FROM pg_roles elevated WHERE (elevated.rolsuper OR elevated.rolbypassrls) AND pg_has_role(current_user,elevated.oid,'MEMBER')) AS elevated,
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='bansir' AND c.relkind='r' AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns
   FROM pg_roles WHERE rolname=current_user`);if(!role||role.rolsuper||role.rolbypassrls||role.elevated||role.owns||!role.worker)throw new Error('Worker requires a restricted bansir_worker login');},
  async claim(kind){await pool.query('SELECT bansir.reap_jobs()');return (await pool.query('SELECT * FROM bansir.claim_job($1)',[kind])).rows[0];},
  async scope(job,fn){const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.establishment_id',$2,true)",[job.tenant_id,job.establishment_id]);
   // Fences writes from a worker whose lease has already expired or was reclaimed.
   const check=()=>client.query('SELECT id FROM bansir.jobs WHERE id=$1 AND lease_token=$2 AND leased_until>now()',[job.id,job.lease_token]);
   if(!(await check()).rowCount)throw new Error('LEASE_LOST');const result=await fn(client);
   if(!(await check()).rowCount)throw new Error('LEASE_LOST');await client.query('COMMIT');return result;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}},
  async finish(job,outcome,error){return (await pool.query('SELECT bansir.finish_job($1,$2,$3,$4) AS ok',[job.id,job.lease_token,outcome,error])).rows[0].ok;},
  async renew(job){return (await pool.query('SELECT bansir.renew_job($1,$2) AS ok',[job.id,job.lease_token])).rows[0].ok;},
  close:()=>pool.end()
 };
}
