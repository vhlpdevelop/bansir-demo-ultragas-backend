// Evaluates the weekly calendar in the establishment timezone, including overnight shifts.
export function businessStatus(config={},now=new Date()) {
 const h=config.businessHours;if(!h?.enabled)return {state:config.acceptingOrders===false?'paused':'unconfigured',open:config.acceptingOrders!==false};
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:config.timeZone||'America/Cuiaba',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday),minute=Number(parts.hour)*60+Number(parts.minute),toMinutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3));
 for(const offset of [-1,0]) {const row=h.days.find(r=>r.day===(day+offset+7)%7);if(!row?.enabled)continue;const start=toMinutes(row.open),end=toMinutes(row.close)+(row.close<row.open?1440:0),point=minute-offset*1440;if(point>=start&&point<end){const remaining=end-point;return {state:config.acceptingOrders===false?'paused':remaining<=h.closingSoonMinutes?'closing':'open',open:config.acceptingOrders!==false,closesAt:row.close,remainingMinutes:remaining};}}
 return {state:'closed',open:false};
}
