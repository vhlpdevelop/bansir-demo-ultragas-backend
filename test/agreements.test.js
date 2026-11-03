import test from 'node:test';import assert from 'node:assert/strict';import {agreementTerms} from '../src/postgres/agreements.js';
test('agreement cycles use local calendar, month boundaries and leap years',()=>{
 assert.deepEqual(agreementTerms('2026-11-03',25,10),{periodEnd:'2026-11-25',dueDate:'2026-12-10'});
 assert.deepEqual(agreementTerms('2026-11-26',25,28),{periodEnd:'2026-12-25',dueDate:'2026-12-28'});
 assert.deepEqual(agreementTerms('2028-02-28',31,31),{periodEnd:'2028-02-29',dueDate:'2028-03-31'});
 assert.deepEqual(agreementTerms('2026-12-31',31,10),{periodEnd:'2026-12-31',dueDate:'2027-01-10'});
});
