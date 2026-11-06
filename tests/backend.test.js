import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../backend/worker/index.js';
function fixture() {
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');sql.exec(readFileSync(new URL('../backend/drizzle/0000_shared_calendar.sql',import.meta.url),'utf8'));
  const db={prepare(query){const s={args:[],bind(...args){this.args=args;return this;},async first(){return sql.prepare(query).get(...this.args)||null;},async all(){return {results:sql.prepare(query).all(...this.args)};}};return s;},async batch(statements){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.all());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  const call=async(path,{method='GET',key,data,version,origin='https://kqede0113.github.io'}={})=>{
    const headers={'Origin':origin};if(key)headers.Authorization='Bearer '+key;if(data!==undefined)headers['Content-Type']='application/json';if(version)headers['If-Match']=String(version);
    const response=await worker.fetch(new Request('https://api.example'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),{DB:db});
    return {status:response.status,data:response.status===204?null:await response.json(),headers:response.headers};
  };return {call,sql};
}
test('two saved names share records; edit/delete conflicts cannot overwrite another device',async()=>{
  const {call}=fixture();
  const a=await call('/api/calendars',{method:'POST',data:{name:'楓'}});assert.equal(a.status,201);const {key,memberId}=a.data;
  const b=await call('/api/members',{method:'POST',key,data:{name:'もう1人'}});assert.equal(b.status,201);
  assert.equal((await call('/api/members',{method:'POST',key,data:{name:'3人目'}})).status,409);
  const entry={id:'meal-1',date:'2026-11-06',type:'昼食',name:'定食',amount:650,memberId};
  const saved=await call('/api/entries/meal-1',{method:'PUT',key,data:{entry,expectedVersion:null}});assert.equal(saved.data.entry.version,1);
  assert.equal((await call('/api/entries/meal-1',{method:'PUT',key,data:{entry,expectedVersion:null}})).data.entry.version,1);
  const other={...entry,id:'meal-2',memberId:b.data.member.id,amount:500};await call('/api/entries/meal-2',{method:'PUT',key,data:{entry:other,expectedVersion:null}});
  const list=await call('/api/entries?month=2026-11',{key});assert.equal(list.data.entries.length,2);assert.equal(list.data.entries.reduce((s,e)=>s+e.amount,0),1150);
  const updated={...entry,amount:800};assert.equal((await call('/api/entries/meal-1',{method:'PUT',key,data:{entry:updated,expectedVersion:1}})).data.entry.version,2);
  assert.equal((await call('/api/entries/meal-1',{method:'PUT',key,data:{entry:updated,expectedVersion:1}})).status,200);
  assert.equal((await call('/api/entries/meal-1',{method:'PUT',key,data:{entry:{...entry,amount:900},expectedVersion:1}})).status,409);
  assert.equal((await call('/api/entries/meal-1',{method:'DELETE',key,version:1})).status,409);
  assert.equal((await call('/api/entries/meal-1',{method:'DELETE',key,version:2})).status,200);
  assert.equal((await call('/api/entries/meal-1',{method:'DELETE',key,version:2})).status,200);
  const renamed=await call('/api/members/'+memberId,{method:'PATCH',key,data:{name:'楓のiPhone'}});assert.equal(renamed.data.member.name,'楓のiPhone');
  assert.equal((await call('/api/entries?month=2026-12',{key})).data.entries.length,0);
});
test('records stay private and isolated; invalid data and foreign authors are rejected',async()=>{
  const {call}=fixture();const a=(await call('/api/calendars',{method:'POST',data:{name:'A'}})).data;const b=(await call('/api/calendars',{method:'POST',data:{name:'B'}})).data;
  assert.equal((await call('/api/entries?month=2026-11')).status,401);assert.equal((await call('/api/entries?month=2026-11',{key:'a'.repeat(43)})).status,401);
  assert.equal((await call('/api/entries?month=2026-11',{key:a.key,origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/entries?month=2026-11',{method:'OPTIONS'})).headers.get('Access-Control-Allow-Origin'),'https://kqede0113.github.io');
  const entry={id:'same-id',date:'2026-11-06',type:'昼食',name:'定食',amount:650,memberId:a.memberId};
  assert.equal((await call('/api/entries/same-id',{method:'PUT',key:a.key,data:{entry,expectedVersion:null}})).status,200);
  assert.equal((await call('/api/entries?month=2026-11',{key:b.key})).data.entries.length,0);
  assert.equal((await call('/api/entries/same-id',{method:'PUT',key:b.key,data:{entry,expectedVersion:null}})).status,400);
  for(const patch of [{amount:-1},{amount:0.1},{date:'2026-02-29'},{name:' '}])assert.equal((await call('/api/entries/same-id',{method:'PUT',key:a.key,data:{entry:{...entry,...patch},expectedVersion:1}})).status,400);
});
test('import is retry-safe and preserves the original owner when ids already exist',async()=>{
  const {call}=fixture();const a=(await call('/api/calendars',{method:'POST',data:{name:'A'}})).data;
  const entry={id:'old-id',date:'2026-10-31',type:'夕食',name:'カレー',amount:400,memberId:a.memberId};
  for(let i=0;i<2;i++)assert.equal((await call('/api/import',{method:'POST',key:a.key,data:{entries:[entry]}})).status,200);
  const list=await call('/api/entries?month=2026-10',{key:a.key});assert.equal(list.data.entries.length,1);assert.equal(list.data.entries[0].amount,400);
  assert.equal((await call('/api/entries?month=2026-11',{key:a.key})).data.entries.length,0);
});
