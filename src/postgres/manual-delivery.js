import {createHash} from 'node:crypto';
import {httpError} from './database.js';
import {manageDeliveries} from './delivery-permissions.js';

export async function confirmManualDelivery(c, identity, member, sale, requestKey) {
  if (!manageDeliveries(member)) throw httpError(403,'Sem permissão para confirmar entregas.','FORBIDDEN');
  if (sale.cancelled_at || sale.status === 'cancelled') throw httpError(409,'Venda cancelada.','SALE_CANCELLED');
  if (sale.outstanding_cents !== 0) throw httpError(409,'Quite o saldo antes de confirmar a entrega pelo PDV.','DELIVERY_PAYMENT_REQUIRED');
  const digest = createHash('sha256').update(JSON.stringify({saleId:sale.id,userId:identity.userId,action:'complete_pdv'})).digest('hex');
  const prior = (await c.query('SELECT request_hash FROM bansir.delivery_events WHERE request_key=$1',[requestKey])).rows[0];
  if (prior && prior.request_hash !== digest) throw httpError(409,'Identificador de confirmação já utilizado.','IDEMPOTENCY_CONFLICT');
  const task = (await c.query('SELECT * FROM bansir.delivery_tasks WHERE sale_id=$1 FOR UPDATE',[sale.id])).rows[0];
  if (!task || ['cancelled','unverified'].includes(task.status)) throw httpError(409,'Esta venda não possui uma entrega ativa para confirmar.','DELIVERY_NOT_ACTIVE');
  if (task.status === 'delivered') return;
  await c.query("UPDATE bansir.delivery_tasks SET status='delivered',delivered_at=now(),version=version+1,updated_at=now() WHERE sale_id=$1",[sale.id]);
  const reason = 'Entrega confirmada manualmente pelo usuário no PDV.';
  await c.query(`INSERT INTO bansir.delivery_events(tenant_id,establishment_id,sale_id,user_id,request_key,request_hash,action,reason)
    VALUES($1,$2,$3,$4,$5,$6,'complete_pdv',$7)`,[identity.tenantId,identity.establishmentId,sale.id,identity.userId,requestKey,digest,reason]);
}
