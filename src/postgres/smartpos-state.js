import {httpError} from './database.js';
export async function expireSmartpos(c){
 await c.query("UPDATE bansir.smartpos_charges SET status=CASE WHEN status='queued' THEN 'expired' ELSE 'unknown' END,updated_at=now() WHERE status IN('queued','executing') AND expires_at<now()");
}
export async function assertNoSmartpos(c,{saleId,cashId,terminalId,provider,exceptId}={}){
 const row=(await c.query(`SELECT id FROM bansir.smartpos_charges WHERE status IN('queued','executing','unknown','approved_review')
 AND ($1::uuid IS NULL OR sale_id=$1) AND ($2::uuid IS NULL OR cash_session_id=$2) AND ($3::uuid IS NULL OR terminal_id=$3)
 AND ($4::text IS NULL OR provider=$4) AND ($5::uuid IS NULL OR id<>$5) LIMIT 1`,[saleId||null,cashId||null,terminalId||null,provider||null,exceptId||null])).rows[0];
 if(row)throw httpError(409,'Existe cobrança SmartPOS pendente. Confira o resultado antes de receber, estornar, fechar o caixa ou trocar o vínculo.','SMARTPOS_PENDING');
}
