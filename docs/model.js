export function dateKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00');return !Number.isNaN(d.getTime())&&dateKey(d)===value;}
export function validEntry(e){return !!e&&typeof e.id==='string'&&e.id.length>0&&validDate(e.date)&&Number.isSafeInteger(e.amount)&&e.amount>=0&&e.amount<=99999999;}
export function validateRecords(records){return Array.isArray(records)&&records.every(validEntry)&&new Set(records.map(e=>e.id)).size===records.length;}
export function totalFor(records,prefix){return records.reduce((sum,e)=>sum+(e.date.startsWith(prefix)?e.amount:0),0);}
export function totalsByMember(records,members,prefix){return members.map(m=>({...m,total:records.reduce((s,e)=>s+(e.memberId===m.id&&e.date.startsWith(prefix)?e.amount:0),0)}));}
export function shiftMonth(month,delta){const [y,m]=month.split('-').map(Number);return dateKey(new Date(y,m-1+delta,1)).slice(0,7);}
