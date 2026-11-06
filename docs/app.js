import {TYPES, dateKey, validEntry, validateRecords, totalFor, shiftMonth} from './model.js';
const $ = id => document.getElementById(id);
const yen = amount => '¥' + amount.toLocaleString('ja-JP');
const STORAGE_KEY = 'meal-calendar.v1';
const todayKey = dateKey(new Date());
let month = todayKey.slice(0,7), selectedDate = todayKey, editingId = null, records = [], storageBlocked = false;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  const saved = raw === null ? [] : JSON.parse(raw);
  if (!validateRecords(saved)) throw new Error('invalid');
  records = saved;
} catch {
  storageBlocked = true;
  $('storageError').textContent = '保存済みの記録を読み込めませんでした。ブラウザの保存設定を確認して再読み込みしてください。';
  $('storageError').hidden = false;
}
function persist(next) {
  if (storageBlocked) { showFormError('保存済みの記録を読み込めていないため、変更を保存できません。'); return false; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); records = next; return true; }
  catch { showFormError('保存できませんでした。ブラウザの空き容量・保存設定を確認してください。'); return false; }
}
function showFormError(message) { $('formError').textContent = message; $('formError').hidden = false; }
function renderCalendar() {
  const [year, m] = month.split('-').map(Number);
  $('monthTitle').textContent = `${year}年 ${m}月`;
  $('monthPicker').value = month;
  $('summaryLabel').textContent = month === todayKey.slice(0,7) ? '今月の食費' : `${year}年${m}月の食費`;
  $('monthTotal').textContent = yen(totalFor(records, month + '-'));
  const grid = $('calendar'); grid.replaceChildren();
  const firstDay = new Date(year,m-1,1).getDay(), days = new Date(year,m,0).getDate();
  const cells = Math.ceil((firstDay + days) / 7) * 7;
  for (let i=0; i<cells; i++) {
    const n = i-firstDay+1;
    if (n < 1 || n > days) { const blank = document.createElement('div'); blank.className='blank'; blank.setAttribute('aria-hidden','true'); grid.append(blank); continue; }
    const key = `${month}-${String(n).padStart(2,'0')}`;
    const meals = records.filter(e=>e.date===key);
    const cost = totalFor(meals,key);
    const b = document.createElement('button'); b.className='day'; b.type='button';
    b.dataset.date=key;
    b.setAttribute('aria-label',`${m}月${n}日${meals.length ? `、${meals.length}件、${cost.toLocaleString('ja-JP')}円` : '、食事を記録'}`);
    if (key===todayKey) { b.classList.add('is-today'); b.setAttribute('aria-current','date'); }
    const number = document.createElement('span'); number.className='day-number'; number.textContent=n; b.append(number);
    if (meals.length) {
      b.classList.add('has-entries');
      const names = document.createElement('span'); names.className='day-meals'; names.textContent=meals.map(e=>e.name).join('・'); b.append(names);
      const dot = document.createElement('span'); dot.className='day-dot'; dot.setAttribute('aria-hidden','true'); b.append(dot);
      const amount=document.createElement('span'); amount.className='day-cost'; amount.textContent=yen(cost); b.append(amount);
    }
    b.addEventListener('click',()=>openDay(key)); grid.append(b);
  }
  $('prevMonth').disabled = month === '1900-01';
  $('nextMonth').disabled = month === '9999-12';
}
function renderDay() {
  const date = new Date(selectedDate+'T12:00:00');
  $('dayTitle').textContent=`${date.getMonth()+1}月${date.getDate()}日`;
  $('dayWeekday').textContent=`${date.getFullYear()}年 · ${['日','月','火','水','木','金','土'][date.getDay()]}曜日`;
  const meals = records.filter(e=>e.date===selectedDate).sort((a,b)=>TYPES.indexOf(a.type)-TYPES.indexOf(b.type));
  $('dayTotal').textContent=yen(totalFor(meals,selectedDate));
  const list=$('entries'); list.replaceChildren();
  if (!meals.length) { const empty=document.createElement('p'); empty.className='empty'; empty.textContent='まだ食事の記録がありません'; list.append(empty); }
  meals.forEach(entry=>{
    const row=document.createElement('div'); row.className='entry';
    const type=document.createElement('span'); type.className='entry-type'; type.textContent=entry.type;
    const main=document.createElement('div'); main.className='entry-main';
    const name=document.createElement('span'); name.className='entry-name'; name.textContent=entry.name;
    const amount=document.createElement('span'); amount.className='entry-amount'; amount.textContent=yen(entry.amount); main.append(name,amount);
    const actions=document.createElement('div'); actions.className='entry-action';
    const edit=document.createElement('button'); edit.type='button'; edit.textContent='編集'; edit.setAttribute('aria-label',`${entry.name}を編集`);
    edit.addEventListener('click',()=>{
      editingId=entry.id; $('mealName').value=entry.name; $('mealAmount').value=entry.amount;
      $('mealTypes').querySelectorAll('input').forEach(r=>r.checked=r.value===entry.type);
      $('formTitle').textContent='食事を編集'; $('saveMeal').textContent='変更を保存'; $('cancelEdit').hidden=false; $('formError').hidden=true;
      $('mealName').focus();
    });
    const remove=document.createElement('button'); remove.type='button'; remove.className='delete'; remove.textContent='削除'; remove.setAttribute('aria-label',`${entry.name}を削除`);
    remove.addEventListener('click',()=>{if (persist(records.filter(e=>e.id!==entry.id))) {if(editingId===entry.id) resetForm(); renderDay(); renderCalendar();}});
    actions.append(edit,remove); row.append(type,main,actions); list.append(row);
  });
}
function resetForm() {
  editingId=null; $('mealForm').reset(); $('formError').hidden=true; $('cancelEdit').hidden=true;
  $('formTitle').textContent='食事を追加'; $('saveMeal').textContent='記録する ↗';
}
function openDay(date) { selectedDate=date; resetForm(); renderDay(); $('dayDialog').showModal(); $('closeDialog').focus(); }
TYPES.forEach((type,i)=>{
  const label=document.createElement('label'); label.className='type-option';
  const radio=document.createElement('input'); radio.type='radio'; radio.name='mealType'; radio.value=type; radio.defaultChecked=i===0;
  const span=document.createElement('span'); span.textContent=type; label.append(radio,span); $('mealTypes').append(label);
});
$('mealForm').addEventListener('submit',event=>{
  event.preventDefault();
  const value=$('mealAmount').value;
  const entry={id:editingId || crypto.randomUUID(),date:selectedDate,type:new FormData($('mealForm')).get('mealType'),name:$('mealName').value.trim(),amount:Number(value)};
  if (!validEntry(entry) || value.trim()==='') {showFormError('食事名と、0円以上の整数の金額を入力してください。'); return;}
  const next=editingId ? records.map(e=>e.id===editingId ? entry : e) : [...records,entry];
  if (persist(next)) {resetForm();renderDay();renderCalendar();}
});
$('cancelEdit').addEventListener('click',resetForm);
$('prevMonth').addEventListener('click',()=>{month=shiftMonth(month,-1);renderCalendar();});
$('nextMonth').addEventListener('click',()=>{month=shiftMonth(month,1);renderCalendar();});
$('monthPicker').addEventListener('change',event=>{if (/^\d{4}-\d{2}$/.test(event.target.value) && event.target.validity.valid) {month=event.target.value;renderCalendar();}});
$('today').addEventListener('click',()=>{month=dateKey(new Date()).slice(0,7);renderCalendar();});
$('closeDialog').addEventListener('click',()=>$('dayDialog').close());
$('dayDialog').addEventListener('click',event=>{if(event.target===$('dayDialog')) {const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) event.target.close();}});
$('dayDialog').addEventListener('close',()=>$('calendar').querySelector(`[data-date="${selectedDate}"]`)?.focus());
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY || event.key===null) {try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');if(!validateRecords(saved)) throw Error();records=saved;storageBlocked=false;$('storageError').hidden=true;renderCalendar();if($('dayDialog').open){resetForm();renderDay();}}catch{storageBlocked=true;$('storageError').textContent='記録が更新されましたが、読み込めません。再読み込みしてください。';$('storageError').hidden=false;}}});
renderCalendar();
