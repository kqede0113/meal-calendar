import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validDate,validEntry,validateRecords,totalFor,shiftMonth,dateKey} from '../docs/model.js';
const meal={id:'a',date:'2026-11-06',type:'昼食',name:'定食',amount:650};
test('monthly and daily totals do not include other months or days',()=>{
 const records=[meal,{...meal,id:'b',amount:300},{...meal,id:'c',date:'2026-11-07',amount:0},{...meal,id:'d',date:'2026-12-06',amount:900}];
 assert.equal(totalFor(records,'2026-11-'),950); assert.equal(totalFor(records,'2026-11-06'),950); assert.equal(totalFor(records,'2026-12-'),900); assert.equal(totalFor([], '2026-11-'),0);
 const edited=records.map(e=>e.id==='a'?{...e,amount:500}:e); assert.equal(totalFor(edited,'2026-11-'),800); assert.equal(totalFor(edited.filter(e=>e.id!=='b'),'2026-11-'),500);
});
test('record validation accepts zero and rejects invalid amounts and data',()=>{
 assert.ok(validEntry({...meal,amount:0}));
 for(const amount of [-1,0.5,NaN,Infinity,'650',100000000]) assert.equal(validEntry({...meal,amount}),false);
 assert.equal(validEntry({...meal,name:' '}),false); assert.equal(validEntry({...meal,type:'不明'}),false);
 assert.equal(validateRecords([meal,{...meal}]),false); assert.equal(validateRecords({}),false);assert.equal(validateRecords([meal]),true);
});
test('dates handle leap years, year boundaries and local date keys',()=>{
 assert.ok(validDate('2024-02-29')); assert.equal(validDate('2026-02-29'),false);assert.equal(validDate('2026-13-01'),false);
 assert.equal(shiftMonth('2026-12',1),'2027-01'); assert.equal(shiftMonth('2026-01',-1),'2025-12');
 assert.equal(dateKey(new Date(2026,10,6,0,1)),'2026-11-06');
});
