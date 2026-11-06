const PAGE = 'https://kqede0113.github.io/meal-calendar/';
const TYPES = ['朝食','昼食','夕食','間食'];
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const KEY = /^[a-zA-Z0-9_-]{43}$/;
const MONTH = /^(?:19\d{2}|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/;
const fields = 'id, date, type, name, amount, member_id AS memberId, version';
class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function newKey() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
function cleanName(value) {
  if(typeof value !== 'string') throw new HttpError(400,'名前を入力してください。');
  const name=value.normalize('NFKC').trim();
  if(!name || name.length>30 || /[\u0000-\u001f\u007f]/.test(name)) throw new HttpError(400,'名前は30文字以内で入力してください。');
  return name;
}
export function validEntry(e) {
  if(!e || typeof e.id!=='string' || !ID.test(e.id) || typeof e.date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !MONTH.test(e.date.slice(0,7))) return false;
  const d=new Date(e.date+'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===e.date && TYPES.includes(e.type) && typeof e.name==='string' && e.name.trim().length>0 && e.name.length<=80 && Number.isSafeInteger(e.amount) && e.amount>=0 && e.amount<=99999999 && typeof e.memberId==='string' && ID.test(e.memberId);
}
async function body(request) {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415,'JSON形式で送信してください。');
  if(Number(request.headers.get('content-length')||0)>65536) throw new HttpError(413,'一度に送信する記録が多すぎます。');
  const reader=request.body?.getReader(); let size=0, chunks=[];
  if(!reader) throw new HttpError(400,'入力内容を確認してください。');
  for(;;) {const {done,value}=await reader.read();if(done) break;size+=value.length;if(size>65536){await reader.cancel();throw new HttpError(413,'一度に送信する記録が多すぎます。');}chunks.push(value);}
  const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(buffer));}catch{throw new HttpError(400,'入力内容を確認してください。');}
}
function json(data,status=200) {return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});}
async function members(db,calendar) {return (await db.prepare('SELECT id, name FROM members WHERE calendar_id = ? ORDER BY rowid').bind(calendar).all()).results;}
async function memberExists(db,calendar,id) {return !!await db.prepare('SELECT id FROM members WHERE calendar_id = ? AND id = ?').bind(calendar,id).first();}
function equalEntry(a,b) {return ['id','date','type','name','amount','memberId'].every(k=>a[k]===b[k]);}
async function authenticate(request,db) {
  const match=/^Bearer ([a-zA-Z0-9_-]{43})$/.exec(request.headers.get('authorization')||'');
  if(!match || !KEY.test(match[1])) throw new HttpError(401,'共有リンクからカレンダーを開いてください。');
  const calendar=await digest(match[1]);
  if(!await db.prepare('SELECT id FROM calendars WHERE id = ?').bind(calendar).first()) throw new HttpError(401,'共有リンクが見つかりません。リンクを確認してください。');
  return calendar;
}
async function route(request,env) {
  const url=new URL(request.url), db=env.DB;
  if(url.pathname==='/') return Response.redirect(PAGE,302);
  if(url.pathname==='/api/health' && request.method==='GET') return json({ok:true});
  if(!db) throw new HttpError(503,'共有保存を準備しています。少し待って再試行してください。');
  if(url.pathname==='/api/calendars' && request.method==='POST') {
    const input=await body(request), name=cleanName(input.name), key=newKey(), calendar=await digest(key), memberId=crypto.randomUUID();
    const day=Math.floor(Date.now()/86400000), limitId=await digest(`${request.headers.get('cf-connecting-ip')||'unknown'}:${day}`);
    const limit=await db.prepare('INSERT INTO creation_limits(id,count,expires_at) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count = count + 1 WHERE count < 10 RETURNING count').bind(limitId,Date.now()+172800000).first();
    if(!limit) throw new HttpError(429,'作成回数の上限です。すでに作成した共有リンクを使ってください。');
    await db.batch([db.prepare('INSERT INTO calendars(id,created_at) VALUES(?,?)').bind(calendar,Date.now()),db.prepare('INSERT INTO members(id,calendar_id,name) VALUES(?,?,?)').bind(memberId,calendar,name),db.prepare('DELETE FROM creation_limits WHERE expires_at < ?').bind(Date.now())]);
    return json({key,memberId,members:[{id:memberId,name}]},201);
  }
  const calendar=await authenticate(request,db);
  if(url.pathname==='/api/entries' && request.method==='GET') {
    const month=url.searchParams.get('month');if(!MONTH.test(month||'')) throw new HttpError(400,'月の指定を確認してください。');
    const results=await db.batch([db.prepare(`SELECT ${fields} FROM entries WHERE calendar_id = ? AND date LIKE ? ORDER BY date, updated_at`).bind(calendar,month+'-%'),db.prepare('SELECT id, name FROM members WHERE calendar_id = ? ORDER BY rowid').bind(calendar)]);
    return json({entries:results[0].results,members:results[1].results});
  }
  if(url.pathname==='/api/members' && request.method==='POST') {
    const name=cleanName((await body(request)).name), id=crypto.randomUUID();
    let added;
    try {added=await db.prepare('INSERT INTO members(id,calendar_id,name) SELECT ?,?,? WHERE (SELECT count(*) FROM members WHERE calendar_id = ?) < 2 RETURNING id, name').bind(id,calendar,name,calendar).first();}
    catch {throw new HttpError(409,'同じ名前が保存されています。その名前を選んでください。');}
    if(!added) throw new HttpError(409,'2人の名前が保存済みです。使う名前を選んでください。');
    return json({member:added,members:await members(db,calendar)},201);
  }
  const memberMatch=/^\/api\/members\/([a-zA-Z0-9_-]{1,80})$/.exec(url.pathname);
  if(memberMatch && request.method==='PATCH') {
    const name=cleanName((await body(request)).name);let updated;
    try {updated=await db.prepare('UPDATE members SET name = ? WHERE calendar_id = ? AND id = ? RETURNING id, name').bind(name,calendar,memberMatch[1]).first();}
    catch {throw new HttpError(409,'同じ名前が保存されています。別の名前を入力してください。');}
    if(!updated) throw new HttpError(404,'保存済みの名前が見つかりません。');
    return json({member:updated,members:await members(db,calendar)});
  }
  if(url.pathname==='/api/import' && request.method==='POST') {
    const input=await body(request);
    if(!Array.isArray(input.entries) || !input.entries.length || input.entries.length>100 || !input.entries.every(validEntry)) throw new HttpError(400,'記録の形式を確認してください。');
    const ids=[...new Set(input.entries.map(e=>e.memberId))];
    for(const id of ids) if(!await memberExists(db,calendar,id)) throw new HttpError(400,'入力する人の名前を選んでください。');
    const count=await db.prepare('SELECT count(*) AS n FROM entries WHERE calendar_id = ?').bind(calendar).first();if(count.n+input.entries.length>30000) throw new HttpError(409,'記録件数の上限に達しました。');
    await db.batch(input.entries.map(e=>db.prepare('INSERT INTO entries(id,calendar_id,date,type,name,amount,member_id,version,updated_at) VALUES(?,?,?,?,?,?,?,1,?) ON CONFLICT(calendar_id,id) DO NOTHING').bind(e.id,calendar,e.date,e.type,e.name.trim(),e.amount,e.memberId,Date.now())));
    return json({ok:true});
  }
  const entryMatch=/^\/api\/entries\/([a-zA-Z0-9_-]{1,80})$/.exec(url.pathname);
  if(entryMatch && request.method==='PUT') {
    const {entry,expectedVersion}=await body(request);
    if(!validEntry(entry) || entry.id!==entryMatch[1]) throw new HttpError(400,'食事名と0円以上の整数の金額を入力してください。');
    if(!await memberExists(db,calendar,entry.memberId)) throw new HttpError(400,'端末の名前を設定してください。');
    entry.name=entry.name.trim();let saved;
    if(expectedVersion===null) {
      saved=await db.prepare(`INSERT INTO entries(id,calendar_id,date,type,name,amount,member_id,version,updated_at) SELECT ?,?,?,?,?,?,?,1,? WHERE (SELECT count(*) FROM entries WHERE calendar_id = ?) < 30000 ON CONFLICT(calendar_id,id) DO NOTHING RETURNING ${fields}`).bind(entry.id,calendar,entry.date,entry.type,entry.name,entry.amount,entry.memberId,Date.now(),calendar).first();
      if(!saved) {const old=await db.prepare(`SELECT ${fields} FROM entries WHERE calendar_id = ? AND id = ?`).bind(calendar,entry.id).first();if(old && equalEntry(old,entry)) saved=old;else throw new HttpError(409,'記録が更新されています。再読み込みして確認してください。');}
    } else {
      if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1) throw new HttpError(400,'記録の更新番号を確認してください。');
      saved=await db.prepare(`UPDATE entries SET date=?, type=?, name=?, amount=?, member_id=?, version=version+1, updated_at=? WHERE calendar_id=? AND id=? AND version=? RETURNING ${fields}`).bind(entry.date,entry.type,entry.name,entry.amount,entry.memberId,Date.now(),calendar,entry.id,expectedVersion).first();
      if(!saved) {const old=await db.prepare(`SELECT ${fields} FROM entries WHERE calendar_id=? AND id=?`).bind(calendar,entry.id).first();if(old && old.version===expectedVersion+1 && equalEntry(old,entry)) saved=old;else throw new HttpError(409,'もう1人がこの記録を変更しました。最新の内容を確認してから編集し直してください。');}
    }
    return json({entry:saved});
  }
  if(entryMatch && request.method==='DELETE') {
    const version=Number(request.headers.get('if-match'));
    if(!Number.isSafeInteger(version)||version<1) throw new HttpError(400,'記録の更新番号を確認してください。');
    const removed=await db.prepare('DELETE FROM entries WHERE calendar_id=? AND id=? AND version=? RETURNING id').bind(calendar,entryMatch[1],version).first();
    if(!removed && await db.prepare('SELECT id FROM entries WHERE calendar_id=? AND id=?').bind(calendar,entryMatch[1]).first()) throw new HttpError(409,'もう1人がこの記録を変更しました。最新の内容を確認してから削除してください。');
    return json({ok:true});
  }
  throw new HttpError(404,'見つかりません。');
}
export default {
  async fetch(request,env) {
    const origin=request.headers.get('origin'), self=new URL(request.url).origin;
    const allowed=origin==='https://kqede0113.github.io' || origin===self;
    let response;
    if(origin && !allowed) response=json({error:'このページからは利用できません。'},403);
    else if(request.method==='OPTIONS') response=new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, PUT, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, If-Match','Access-Control-Max-Age':'600'}});
    else {try {response=await route(request,env);}catch(error){response=json({error:error instanceof HttpError?error.message:'共有保存に接続できませんでした。入力は残っています。もう一度お試しください。'},error instanceof HttpError?error.status:503);}}
    const headers=new Headers(response.headers);headers.set('Vary','Origin');
    if(allowed) headers.set('Access-Control-Allow-Origin',origin);
    headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  }
};
