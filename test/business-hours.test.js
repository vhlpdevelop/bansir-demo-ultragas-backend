import test from 'node:test';
import assert from 'node:assert/strict';
import {businessStatus} from '../src/postgres/business-hours.js';
import {businessHoursInput} from '../src/postgres/storefront.js';
const hours={enabled:true,ignoreWhatsappOutsideHours:true,closingSoonMinutes:30,days:Array.from({length:7},(_,day)=>({day,enabled:day===1,open:'08:00',close:'18:00'}))};
test('business calendar: timezone, exact boundaries, closing warning, closed days and overnight',()=>{
 const cfg={timeZone:'America/Cuiaba',businessHours:hours};
 for(const [date,state] of [['2026-10-26T11:59Z','closed'],['2026-10-26T12:00Z','open'],['2026-10-26T21:30Z','closing'],['2026-10-26T22:00Z','closed'],['2026-10-27T14:00Z','closed']])assert.equal(businessStatus(cfg,new Date(date)).state,state);
 const night={...cfg,businessHours:{...hours,days:hours.days.map(d=>({...d,open:'22:00',close:'02:00'}))}};
 assert.equal(businessStatus(night,new Date('2026-10-27T05:00Z')).state,'open');assert.equal(businessStatus(night,new Date('2026-10-27T06:00Z')).state,'closed');
 assert.equal(businessStatus({}).open,true);assert.equal(businessStatus({...cfg,acceptingOrders:false},new Date('2026-10-26T14:00Z')).open,false);
 assert.equal(businessHoursInput.safeParse({...hours,days:hours.days.map(d=>({...d,close:'25:00'}))}).success,false);
 assert.equal(businessHoursInput.safeParse({...hours,days:hours.days.map(d=>({...d,day:1}))}).success,false);
});
