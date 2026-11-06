import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker,{digest} from '../backend/worker/index.js';
function fixture() {
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(readFileSync(new URL('../backend/drizzle/0000_shared_calendar.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../backend/drizzle/0001_device_profiles.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../backend/drizzle/0002_name_sessions.sql',import.meta.url),'utf8'));
  const db={prepare(query){const s={args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};},async run(){const result=sql.prepare(query).run(...this.args);return {meta:{changes:result.changes}};}};return s;},async batch(statements){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.all());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const call=async(path,{method='GET',key,data,version,origin='https://kqede0113.github.io',deviceKey='a'.repeat(43)}={})=>{
    const headers={'Origin':origin};if(deviceKey)headers['X-Device-Key']=deviceKey;if(key)headers.Authorization='Bearer '+key;if(data!==undefined)headers['Content-Type']='application/json';if(version)headers['If-Match']=String(version);
    const response=await worker.fetch(new Request('https://api.example'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),{DB:db});
    return {status:response.status,data:response.status===204?null:await response.json(),headers:response.headers};
  };return {call,sql};
}
test('the same saved name logs in from another device and keeps the same record owner',async()=>{
 const {call,sql}=fixture();const a=(await call('/api/calendars',{method:'POST',data:{name:'楓'}})).data;const key=a.key;
 const b=(await call('/api/device',{method:'POST',key,deviceKey:'b'.repeat(43),data:{name:'もう1人'}})).data;
 const entry={id:'purchase-a',date:'2026-11-06',amount:650};
 const saved=await call('/api/entries/purchase-a',{method:'PUT',key,data:{entry,expectedVersion:null}});assert.equal(saved.data.entry.memberId,a.device.id);
 const before=sql.prepare('SELECT * FROM entries ORDER BY id').all();
 const third=await call('/api/device',{method:'POST',key,deviceKey:'c'.repeat(43),data:{name:'　楓　'}});assert.equal(third.status,200);assert.equal(third.data.device.id,a.device.id);
 const again=await call('/api/device',{method:'POST',key,deviceKey:'d'.repeat(43),data:{name:'楓'}});assert.equal(again.data.device.id,a.device.id);
 assert.deepEqual(sql.prepare('SELECT * FROM entries ORDER BY id').all(),before);
 const read=(await call('/api/entries?month=2026-11',{key,deviceKey:'c'.repeat(43)})).data;assert.equal(read.device.id,a.device.id);assert.equal(read.entries[0].amount,650);assert.equal(read.members.length,2);
 const second={id:'purchase-c',date:'2026-11-06',amount:200};await call('/api/entries/purchase-c',{method:'PUT',key,deviceKey:'c'.repeat(43),data:{entry:second,expectedVersion:null}});
 const rows=(await call('/api/entries?month=2026-11',{key})).data.entries;assert.equal(rows.filter(e=>e.memberId===a.device.id).reduce((s,e)=>s+e.amount,0),850);
 await call('/api/device',{method:'POST',key,deviceKey:'c'.repeat(43),data:{name:'もう1人'}});
 assert.equal((await call('/api/entries?month=2026-11',{key,deviceKey:'c'.repeat(43)})).data.device.id,b.device.id);
 assert.equal((await call('/api/entries?month=2026-11',{key})).data.device.name,'楓');
 assert.deepEqual((await call('/api/entries?month=2026-11',{key})).data.members.map(m=>m.name),['楓','もう1人']);
 assert.equal((await call('/api/device',{method:'POST',key,deviceKey:'c'.repeat(43),data:{name:'3人目'}})).status,409);
 assert.equal((await call('/api/entries?month=2026-11',{key,deviceKey:'c'.repeat(43)})).data.device.id,b.device.id);
});
test('pre-update names, ids, all records and old device logins survive without a backfill',async()=>{
 const {call,sql}=fixture();const key='k'.repeat(43),calendar=await digest(key),oldHash=await digest('a'.repeat(43));
 sql.prepare('INSERT INTO calendars(id,created_at) VALUES(?,0)').run(calendar);
 sql.prepare('INSERT INTO members(id,calendar_id,name) VALUES(?,?,?)').run('old-a',calendar,'元のA');
 sql.prepare('INSERT INTO members(id,calendar_id,name) VALUES(?,?,?)').run('old-b',calendar,'元のB');
 sql.prepare('INSERT INTO device_profiles(calendar_id,device_hash,member_id) VALUES(?,?,?)').run(calendar,oldHash,'old-a');
 sql.prepare("INSERT INTO entries(id,calendar_id,date,type,name,amount,member_id,version,updated_at) VALUES(?,?,'2026-11-06','昼食','定食',?, ?,3,123)").run('old-purchase-a',calendar,650,'old-a');
 sql.prepare("INSERT INTO entries(id,calendar_id,date,type,name,amount,member_id,version,updated_at) VALUES(?,?,'2026-10-31','夕食','カレー',?, ?,1,124)").run('old-purchase-b',calendar,500,'old-b');
 const namesBefore=sql.prepare('SELECT * FROM members ORDER BY id').all(),recordsBefore=sql.prepare('SELECT * FROM entries ORDER BY id').all();
 assert.equal((await call('/api/entries?month=2026-11',{key})).data.device.id,'old-a');
 const result=await call('/api/device',{method:'POST',key,deviceKey:'c'.repeat(43),data:{name:'元のA',legacyMemberId:'old-b'}});assert.equal(result.data.device.id,'old-a');
 await call('/api/device',{method:'POST',key,deviceKey:'d'.repeat(43),data:{name:'元のB'}});
 await call('/api/device',{method:'POST',key,data:{name:'元のB'}});
 assert.equal((await call('/api/entries?month=2026-11',{key})).data.device.id,'old-b');
 assert.deepEqual(sql.prepare('SELECT * FROM members ORDER BY id').all(),namesBefore);assert.deepEqual(sql.prepare('SELECT * FROM entries ORDER BY id').all(),recordsBefore);
});
test('private room boundaries, safe imports and edit/delete conflicts remain enforced',async()=>{
 const {call}=fixture();const a=(await call('/api/calendars',{method:'POST',data:{name:'A'}})).data;
 assert.equal((await call('/api/entries?month=2026-11')).status,401);
 assert.equal((await call('/api/entries?month=2026-11',{key:'x'.repeat(43)})).status,401);
 assert.equal((await call('/api/entries?month=2026-11',{key:a.key,origin:'https://evil.example'})).status,403);
 const other=(await call('/api/calendars',{method:'POST',data:{name:'別の共有先'}})).data;
 const entry={id:'import-1',date:'2026-11-06',amount:650};for(let i=0;i<2;i++)assert.equal((await call('/api/import',{method:'POST',key:a.key,data:{entries:[entry]}})).status,200);
 assert.equal((await call('/api/entries?month=2026-11',{key:a.key})).data.entries.length,1);assert.equal((await call('/api/entries?month=2026-11',{key:other.key})).data.entries.length,0);
 for(const patch of [{amount:-1},{amount:.1},{date:'2026-02-29'},{id:undefined}])assert.equal((await call('/api/entries/import-1',{method:'PUT',key:a.key,data:{entry:{...entry,...patch},expectedVersion:1}})).status,400);
 assert.equal((await call('/api/entries/import-1',{method:'PUT',key:a.key,data:{entry:{...entry,amount:800},expectedVersion:1}})).status,200);
 assert.equal((await call('/api/entries/import-1',{method:'PUT',key:a.key,data:{entry:{...entry,amount:900},expectedVersion:1}})).status,409);
 assert.equal((await call('/api/entries/import-1',{method:'DELETE',key:a.key,version:1})).status,409);
 assert.equal((await call('/api/entries/import-1',{method:'DELETE',key:a.key,version:2})).status,200);
});
