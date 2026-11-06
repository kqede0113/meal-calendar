import {TYPES, dateKey, validEntry, validateRecords, totalFor, totalsByMember, shiftMonth} from './model.js?v=2';
import {SyncAPI, validKey} from './sync.js?v=2';
const $ = id => document.getElementById(id);
const yen = amount => '¥' + amount.toLocaleString('ja-JP');
const STORAGE_KEY = 'meal-calendar.v1';
const PROFILE_KEY = 'meal-calendar.shared-profile.v1';
const todayKey = dateKey(new Date());
let month = todayKey.slice(0,7), selectedDate = todayKey, editingId = null, records = [], legacy = [];
let api=null, members=[], memberId='', editingVersion=null, editingMemberId=null, draftId=null, busy=false, loadedMonth=null, requestSequence=0;
let savedProfile=null;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  const saved = raw === null ? [] : JSON.parse(raw);
  if (!validateRecords(saved)) throw new Error('invalid');
  legacy = saved; records = saved;
} catch {
  showStorageError('この端末の以前の記録を読み込めませんでした。元の保存データはそのまま残しています。');
}
try {savedProfile=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null');} catch {}
function showStorageError(message) {$('storageError').textContent=message;$('storageError').hidden=false;}
function currentName(id=memberId) {return members.find(m=>m.id===id)?.name||'名前を設定';}
function suggestedName() {const ua=navigator.userAgent;return /iPhone|iPad/.test(ua)?'iPhone':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows PC':/Mac/.test(ua)?'Mac':'この端末';}
function status(text,ok=false) {$('syncStatus').textContent=text;$('syncStatus').classList.toggle('is-synced',ok);}
function saveProfile() {
  savedProfile={key:api.key,memberId};
  try {localStorage.setItem(PROFILE_KEY,JSON.stringify(savedProfile));}
  catch {showStorageError('このブラウザに端末の名前を保存できません。次回も同じ共有リンクから開き、保存済みの名前を選んでください。');}
}
function updateSharingUI() {
  $('deviceButton').textContent=memberId?currentName():'端末の名前';
  $('deviceButton').title='この端末の名前を設定';
  $('shareButton').disabled=!api;
  $('autoName').textContent='名前は自動入力：'+currentName(editingMemberId||memberId);
  $('storageNote').textContent=api?'記録は2人で共有されます。名前はこの端末から自動入力。':'共有リンクから、2人で同じ記録を使えます。';
  let imported=false;try{imported=localStorage.getItem('meal-calendar.imported-to.v1')===api?.key;}catch{}
  $('importLegacy').hidden=!(api && memberId && legacy.length && !imported);
  $('importLegacy').textContent=`この端末の以前の記録${legacy.length}件を「${currentName()}」の記録として共有`;
}
function validateResponse(data) {
  if(!validateRecords(data.entries) || !Array.isArray(data.members) || data.members.length>2 || !data.members.every(m=>m && typeof m.id==='string' && typeof m.name==='string') || !data.entries.every(e=>Number.isSafeInteger(e.version)&&e.version>0&&data.members.some(m=>m.id===e.memberId))) throw Error('共有記録を読み込めませんでした。再試行してください。');
}
async function connect(key,preferredMember='') {
  if(!validKey(key))throw Error('共有リンク・コードを確認してください。');
  const nextAPI=new SyncAPI(key),data=await nextAPI.list(month);validateResponse(data);
  requestSequence++;api=nextAPI;members=data.members;memberId=members.some(m=>m.id===preferredMember)?preferredMember:'';records=data.entries;loadedMonth=month;
  saveProfile();renderCalendar();updateSharingUI();status('同期済み',true);
  if(memberId){resetForm();$('setupDialog').close();}else showSetup();
}
async function refresh() {
  if(!api || busy || document.hidden)return;
  const targetAPI=api,targetMonth=month,sequence=++requestSequence;
  try {
    const data=await targetAPI.list(targetMonth);validateResponse(data);
    if(sequence!==requestSequence||targetAPI!==api||targetMonth!==month)return;
    records=data.entries;members=data.members;loadedMonth=targetMonth;
    renderCalendar();if($('dayDialog').open)renderDay();updateSharingUI();status('同期済み',true);$('storageError').hidden=true;
  } catch(error) {if(sequence===requestSequence){status('未同期 · タップして再接続');showStorageError(error.message);}}
}
function setBusy(value) {
  busy=value;
  $('mealForm').querySelectorAll('input,button').forEach(el=>el.disabled=value);
  $('entries').querySelectorAll('button').forEach(el=>el.disabled=value);
  $('setupDialog').querySelectorAll('input,button').forEach(el=>el.disabled=value);
  $('importLegacy').disabled=value;
}
async function mutate(action,onSuccess) {
  if(busy || !api || !memberId)return;
  setBusy(true);requestSequence++;status('保存中…');$('formError').hidden=true;
  try {const result=await action();onSuccess(result);renderCalendar();if($('dayDialog').open)renderDay();status('同期済み',true);}
  catch(error){showFormError(error.message);showStorageError(error.message);status('未同期 · タップして再接続');}
  finally{requestSequence++;setBusy(false);await refresh();}
}
function showSetup() {
  if(busy)return;
  if($('dayDialog').open)$('dayDialog').close();
  $('setupTitle').textContent='この端末の名前';
  $('setupCopy').textContent=api?'保存済みの名前を選ぶか、この端末からの記録に付ける名前を保存してください。':'この端末からの食事記録に、自動で付ける名前です。最初の1人が作成し、リンクをもう1人に送ってください。';
  const list=$('savedNames');list.replaceChildren();
  members.forEach(m=>{const b=document.createElement('button');b.type='button';b.className='saved-name'+(m.id===memberId?' selected':'');b.textContent=m.name+(m.id===memberId?'（この端末で使用中）':' を使う');b.addEventListener('click',()=>{memberId=m.id;saveProfile();updateSharingUI();resetForm();$('setupDialog').close();});list.append(b);});
  $('setupForm').hidden=!!(api&&!memberId&&members.length>=2);
  $('joinForm').hidden=!!api;
  $('deviceName').value=memberId?currentName():suggestedName();
  if(!memberId && members.some(m=>m.name===$('deviceName').value))$('deviceName').value+=' 2';
  $('setupSubmit').textContent=api?(memberId?'この名前を保存':'この端末の名前を保存'):'共有カレンダーを作成';
  $('setupError').hidden=true;
  if(!$('setupDialog').open)$('setupDialog').showModal();
}
function showSetupError(message){$('setupError').textContent=message;$('setupError').hidden=false;}
function showShare() {
  if(!api)return showSetup();
  const url=new URL(location.href);url.hash='share='+api.key;url.search='';
  $('sharedLink').value=url.href;$('copyStatus').textContent='';$('shareDialog').showModal();
}
function showFormError(message) { $('formError').textContent = message; $('formError').hidden = false; }
function renderCalendar() {
  const [year, m] = month.split('-').map(Number);
  $('monthTitle').textContent = `${year}年 ${m}月`;
  $('monthPicker').value = month;
  $('summaryLabel').textContent = month === todayKey.slice(0,7) ? '今月の食費' : `${year}年${m}月の食費`;
  const ready=!api||loadedMonth===month;
  $('monthTotal').textContent = ready?yen(totalFor(records, month + '-')):'—';
  const totals=$('personTotals');totals.replaceChildren();
  totalsByMember(records,members,month+'-').forEach(person=>{const card=document.createElement('div');card.className='person-total';const name=document.createElement('span');name.textContent=person.name;const amount=document.createElement('strong');amount.textContent=ready?yen(person.total):'—';card.append(name,amount);totals.append(card);});
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
    b.disabled=!!(api&&!ready);
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
    const owner=document.createElement('span');owner.className='entry-owner';owner.textContent=currentName(entry.memberId);main.append(owner);
    const actions=document.createElement('div'); actions.className='entry-action';
    const edit=document.createElement('button'); edit.type='button'; edit.textContent='編集'; edit.setAttribute('aria-label',`${entry.name}を編集`);
    edit.addEventListener('click',()=>{
      editingId=entry.id;editingVersion=entry.version;editingMemberId=entry.memberId; $('mealName').value=entry.name; $('mealAmount').value=entry.amount;
      $('mealTypes').querySelectorAll('input').forEach(r=>r.checked=r.value===entry.type);
      $('formTitle').textContent='食事を編集'; $('saveMeal').textContent='変更を保存'; $('cancelEdit').hidden=false; $('formError').hidden=true;
      $('mealName').focus();
      updateSharingUI();
    });
    const remove=document.createElement('button'); remove.type='button'; remove.className='delete'; remove.textContent='削除'; remove.setAttribute('aria-label',`${entry.name}を削除`);
    remove.addEventListener('click',()=>mutate(()=>api.remove(entry.id,entry.version),()=>{records=records.filter(e=>e.id!==entry.id);if(editingId===entry.id)resetForm();}));
    edit.disabled=busy;remove.disabled=busy;
    actions.append(edit,remove); row.append(type,main,actions); list.append(row);
  });
}
function resetForm() {
  editingId=null;editingVersion=null;editingMemberId=null;draftId=null; $('mealForm').reset(); $('formError').hidden=true; $('cancelEdit').hidden=true;
  $('formTitle').textContent='食事を追加'; $('saveMeal').textContent='記録する ↗';
  updateSharingUI();
}
function openDay(date) {if(!api||!memberId)return showSetup();selectedDate=date; resetForm(); renderDay(); $('dayDialog').showModal(); $('closeDialog').focus(); }
TYPES.forEach((type,i)=>{
  const label=document.createElement('label'); label.className='type-option';
  const radio=document.createElement('input'); radio.type='radio'; radio.name='mealType'; radio.value=type; radio.defaultChecked=i===0;
  const span=document.createElement('span'); span.textContent=type; label.append(radio,span); $('mealTypes').append(label);
});
$('mealForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if(busy)return;
  if(!api||!memberId)return showSetup();
  const value=$('mealAmount').value;
  if(!editingId&&!draftId)draftId=crypto.randomUUID();
  const entry={id:editingId || draftId,date:selectedDate,type:new FormData($('mealForm')).get('mealType'),name:$('mealName').value.trim(),amount:Number(value),memberId:editingMemberId||memberId};
  if (!validEntry(entry) || value.trim()==='') {showFormError('食事名と、0円以上の整数の金額を入力してください。'); return;}
  await mutate(()=>api.save(entry,editingId?editingVersion:null),result=>{records=records.filter(e=>e.id!==result.entry.id);if(result.entry.date.startsWith(month+'-'))records.push(result.entry);resetForm();});
});
$('cancelEdit').addEventListener('click',resetForm);
function changeMonth(next){month=next;if(api){loadedMonth=null;records=[];status('読み込み中…');}renderCalendar();refresh();}
$('prevMonth').addEventListener('click',()=>changeMonth(shiftMonth(month,-1)));
$('nextMonth').addEventListener('click',()=>changeMonth(shiftMonth(month,1)));
$('monthPicker').addEventListener('change',event=>{if (/^\d{4}-\d{2}$/.test(event.target.value) && event.target.validity.valid)changeMonth(event.target.value);});
$('today').addEventListener('click',()=>changeMonth(dateKey(new Date()).slice(0,7)));
$('closeDialog').addEventListener('click',()=>$('dayDialog').close());
$('dayDialog').addEventListener('click',event=>{if(event.target===$('dayDialog')) {const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) event.target.close();}});
$('dayDialog').addEventListener('close',()=>$('calendar').querySelector(`[data-date="${selectedDate}"]`)?.focus());
$('deviceButton').addEventListener('click',showSetup);
$('shareButton').addEventListener('click',showShare);
$('closeSetup').addEventListener('click',()=>$('setupDialog').close());
$('closeShare').addEventListener('click',()=>$('shareDialog').close());
$('syncStatus').addEventListener('click',()=>api?refresh():showSetup());
$('setupForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  const name=$('deviceName').value.trim();if(!name)return;
  const creating=!api;setBusy(true);$('setupError').hidden=true;
  try {
    if(creating){const result=await new SyncAPI().create(name);await connect(result.key,result.memberId);showShare();}
    else {const result=memberId?await api.renameMember(memberId,name):await api.addMember(name);members=result.members;memberId=result.member.id;saveProfile();resetForm();updateSharingUI();renderCalendar();$('setupDialog').close();}
  } catch(error){showSetupError(error.message);}finally{setBusy(false);}
});
$('joinForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;let key=$('joinLink').value.trim();
  if(!validKey(key)){try{key=new URLSearchParams(new URL(key).hash.slice(1)).get('share');}catch{}}
  setBusy(true);try{await connect(key);setBusy(false);if(!memberId)showSetup();}catch(error){showSetupError(error.message);}finally{setBusy(false);}
});
$('copyLink').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('sharedLink').value);$('copyStatus').textContent='コピーしました。相手に送ってください。';}catch{$('sharedLink').focus();$('sharedLink').select();$('copyStatus').textContent='リンクを選択しました。コピーして相手に送ってください。';}});
$('importLegacy').addEventListener('click',()=>mutate(async()=>{for(let i=0;i<legacy.length;i+=100)await api.import(legacy.slice(i,i+100).map(e=>({...e,memberId})));return {};},()=>{try{localStorage.setItem('meal-calendar.imported-to.v1',api.key);}catch{}$('importLegacy').hidden=true;}));
window.addEventListener('online',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(refresh,5000);
renderCalendar();updateSharingUI();
let invitation=new URLSearchParams(location.hash.slice(1)).get('share');
if(invitation)history.replaceState(null,'',location.pathname+location.search);
const initialKey=validKey(invitation)?invitation:(validKey(savedProfile?.key)?savedProfile.key:null);
if(initialKey){status('読み込み中…');connect(initialKey,savedProfile?.key===initialKey?savedProfile.memberId:'').catch(error=>{showStorageError(error.message);showSetup();showSetupError(error.message);});}else showSetup();

