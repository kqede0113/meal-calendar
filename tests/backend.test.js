import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker,{digest} from '../backend/worker/index.js';
function fixture() {
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(readFileSync(new URL('../backend/drizzle/0000_shared_calendar.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../backend/drizzle/0001_device_profiles.sql',import.meta.url),'utf8'));
  const db={prepare(query){const s={args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};}};return s;},async batch(statements){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.all());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const call=async(path,{method='GET',key,data,version,origin='https://kqede0113.github.io',deviceKey='a'.repeat(43)}={})=>{
    const headers={'Origin':origin};if(deviceKey)headers['X-Device-Key']=deviceKey;if(key)headers.Authorization='Bearer '+key;if(data!==undefined)headers['Content-Type']='application/json';if(version)headers['If-Match']=String(version);
    const response=await worker.fetch(new Request('https://api.example'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),{DB:db});
    return {status:response.status,data:response.status===204?null:await response.json(),headers:response.headers};
  };return {call,sql};
}
test('each device has an independent name; purchase records automatically use that device',async()=>{
 const {call}=fixture();const a=(await call('/api/calendars',{method:'POST',data:{name:'楓'}})).data;const key=a.key;
 const b=(await call('/api/device',{method:'POST',key,deviceKey:'b'.repeat(43),data:{name:'もう1人'}})).data;
 assert.notEqual(a.device.id,b.device.id);
 await call('/api/device',{method:'POST',key,deviceKey:'b'.repeat(43),data:{name:'Bの端末'}});
 const readA=(await call('/api/entries?month=2026-11',{key})).data;
 assert.equal(readA.device.name,'楓');assert.equal(readA.members.find(m=>m.id===b.device.id).name,'Bの端末');
 assert.equal((await call('/api/members/'+a.device.id,{method:'PATCH',key,deviceKey:'b'.repeat(43),data:{name:'他人を変更'}})).status,409);
 const entry={id:'purchase-a',date:'2026-11-06',amount:650,memberId:b.device.id};
 const saved=(await call('/api/entries/purchase-a',{method:'PUT',key,data:{entry,expectedVersion:null}})).data.entry;
 assert.equal(saved.memberId,a.device.id);assert.equal(saved.version,1);
 const second={id:'purchase-b',date:'2026-11-06',amount:500};
 await call('/api/entries/purchase-b',{method:'PUT',key,deviceKey:'b'.repeat(43),data:{entry:second,expectedVersion:null}});
 const both=(await call('/api/entries?month=2026-11',{key})).data;
 assert.equal(both.entries.reduce((s,e)=>s+e.amount,0),1150);
 assert.equal(both.entries.filter(e=>e.memberId===a.device.id).reduce((s,e)=>s+e.amount,0),650);
 assert.equal(both.entries.filter(e=>e.memberId===b.device.id).reduce((s,e)=>s+e.amount,0),500);
 const changed={id:'purchase-a',date:'2026-10-31',amount:800};
 const updated=(await call('/api/entries/purchase-a',{method:'PUT',key,deviceKey:'b'.repeat(43),data:{entry:changed,expectedVersion:1}})).data.entry;
 assert.equal(updated.memberId,a.device.id);assert.equal(updated.version,2);
 assert.equal((await call('/api/entries/purchase-a',{method:'DELETE',key,version:1})).status,409);
 assert.equal((await call('/api/entries/purchase-a',{method:'DELETE',key,version:2})).status,200);
 assert.equal((await call('/api/entries/purchase-a',{method:'DELETE',key,version:2})).status,200);
 assert.equal((await call('/api/entries?month=2026-11',{key,deviceKey:null})).data.device,null);
 assert.equal((await call('/api/entries/x',{method:'PUT',key,deviceKey:null,data:{entry:{id:'x',date:'2026-11-06',amount:100},expectedVersion:null}})).status,401);
});
test('old linked identities migrate without linking the two device names again',async()=>{
 const {call,sql}=fixture();const key='k'.repeat(43),calendar=await digest(key);
 sql.prepare('INSERT INTO calendars(id,created_at) VALUES(?,0)').run(calendar);
 sql.prepare('INSERT INTO members(id,calendar_id,name) VALUES(?,?,?)').run('old-person',calendar,'以前の名前');
 sql.prepare("INSERT INTO entries(id,calendar_id,date,type,name,amount,member_id,version,updated_at) VALUES(?,?,'2026-11-06','昼食','定食',650,'old-person',1,0)").run('old-meal',calendar);
 const a=(await call('/api/device',{method:'POST',key,data:{name:'A',legacyMemberId:'old-person'}})).data;
 const b=(await call('/api/device',{method:'POST',key,deviceKey:'b'.repeat(43),data:{name:'B',legacyMemberId:'old-person'}})).data;
 assert.equal(a.device.id,'old-person');assert.notEqual(a.device.id,b.device.id);
 await call('/api/device',{method:'POST',key,deviceKey:'b'.repeat(43),data:{name:'B変更'}});
 const state=(await call('/api/entries?month=2026-11',{key})).data;
 assert.equal(state.device.name,'A');assert.equal(state.entries[0].amount,650);assert.equal(state.entries[0].memberId,a.device.id);
});
test('private rooms, input validation, repeat-safe import and two-name limit',async()=>{
 const {call}=fixture();const a=(await call('/api/calendars',{method:'POST',data:{name:'A'}})).data;
 assert.equal((await call('/api/entries?month=2026-11')).status,401);
 assert.equal((await call('/api/entries?month=2026-11',{key:'x'.repeat(43)})).status,401);
 assert.equal((await call('/api/entries?month=2026-11',{key:a.key,origin:'https://evil.example'})).status,403);
 const b=(await call('/api/calendars',{method:'POST',data:{name:'別の共有先'}})).data;
 const entry={id:'import-1',date:'2026-11-06',amount:0};
 for(let i=0;i<2;i++)assert.equal((await call('/api/import',{method:'POST',key:a.key,data:{entries:[entry]}})).status,200);
 assert.equal((await call('/api/entries?month=2026-11',{key:a.key})).data.entries.length,1);
 assert.equal((await call('/api/entries?month=2026-11',{key:b.key})).data.entries.length,0);
 for(const patch of [{amount:-1},{amount:.1},{date:'2026-02-29'},{id:undefined}])assert.equal((await call('/api/entries/import-1',{method:'PUT',key:a.key,data:{entry:{...entry,...patch},expectedVersion:1}})).status,400);
 await call('/api/device',{method:'POST',key:a.key,deviceKey:'b'.repeat(43),data:{name:'B'}});
 assert.equal((await call('/api/device',{method:'POST',key:a.key,deviceKey:'c'.repeat(43),data:{name:'C'}})).status,409);
 assert.equal((await call('/api/device',{method:'POST',key:a.key,deviceKey:'b'.repeat(43),data:{name:'A'}})).status,409);
});
