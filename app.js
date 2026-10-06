/* Local calendar helpers: never convert date keys through UTC. */
const Calendar = {
  key(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; },
  parse(key) { const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d,12); },
  add(date, days) { const result = new Date(date); result.setDate(result.getDate()+days); return result; },
  monday(date) { return this.add(date,-((date.getDay()+6)%7)); },
  label(date) { return `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()}`; }
};
const STORAGE_KEY = 'life-maintenance';
const SCHEMA_VERSION = 1;
const weekdays = ['月','火','水','木','金','土','日'];
const $ = id => document.getElementById(id);
const makeId = () => globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function initialData() {
  return {schemaVersion:SCHEMA_VERSION, settings:{weekStartsOn:1}, records:{}, tasks:[
    ['部屋を10分片付ける','daily',7,''],
    ['ウォーキング 20分','weekly',3,''],
    ['スクワット 10回×2セット','weekly',2,''],
    ['体幹トレーニング','weekly',2,'無理に回数を増やさず、軽い負荷から始める。']
  ].map(([name,type,target,note],i)=>({id:makeId(),name,type,target,note,order:i+1,deleted:false}))};
}
function validateData(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.tasks) || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) throw new Error('保存データの形式・バージョンに対応していません。');
  const ids = new Set();
  for (const task of value.tasks) {
    if (!task || typeof task.id !== 'string' || ids.has(task.id) || typeof task.name !== 'string' || typeof task.note !== 'string' || !['daily','weekly'].includes(task.type) || !Number.isInteger(task.target) || task.target<1 || task.target>7 || !Number.isInteger(task.order)) throw new Error('タスクの保存データを読み込めません。');
    ids.add(task.id);
  }
  for (const dates of Object.values(value.records)) {
    if (!dates || typeof dates !== 'object' || Array.isArray(dates) || Object.entries(dates).some(([key,v])=> !/^\d{4}-\d{2}-\d{2}$/.test(key) || v !== true)) throw new Error('チェック履歴を読み込めません。');
  }
  return value;
}
let data, storageAvailable = true, editingId = null;
let selectedWeek = Calendar.monday(new Date());
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  data = saved === null ? initialData() : validateData(JSON.parse(saved));
  if (saved === null) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
} catch (error) {
  storageAvailable = false;
  data = {schemaVersion:SCHEMA_VERSION,tasks:[],records:{},settings:{weekStartsOn:1}};
  $('status').textContent = `保存データを利用できません。ブラウザーの保存設定を確認してください。既存データは上書きしません。 (${error.message})`;
}
// Persist first: a failed save must not look like a successful check.
function commit(next, message='') {
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(next)); data=next; $('status').textContent=message; render(); return true; }
  catch { $('status').textContent='保存できませんでした。ブラウザーの保存設定や空き容量を確認してください。'; return false; }
}
function weekDates() { return Array.from({length:7},(_,i)=>Calendar.add(selectedWeek,i)); }
function progress(task, dates) {
  const count=dates.filter(date=>data.records[task.id]?.[Calendar.key(date)]).length;
  const target=task.type==='daily'?7:task.target;
  return {count,target,clear:count>=target};
}
function element(tag,className,text) { const node=document.createElement(tag); if(className) node.className=className; if(text !== undefined) node.textContent=text; return node; }
function render() {
  const dates=weekDates(), today=Calendar.key(new Date());
  const current=Calendar.key(selectedWeek)===Calendar.key(Calendar.monday(new Date()));
  $('week-label').textContent=current?'THIS WEEK · 今週':'WEEKLY LOG · 週の記録';
  $('this-week').hidden=current;
  $('week-range').textContent=`${Calendar.label(dates[0])} – ${Calendar.label(dates[6])}`;
  document.querySelector('.section-heading h2').textContent=current?'今週の習慣':'この週の習慣';
  const tasks=data.tasks.filter(t=>!t.deleted || dates.some(d=>data.records[t.id]?.[Calendar.key(d)])).sort((a,b)=>a.order-b.order);
  let cleared=0,done=0,total=0;
  $('tasks').replaceChildren();
  for(const task of tasks) {
    const p=progress(task,dates); cleared+=Number(p.clear); done+=Math.min(p.count,p.target); total+=p.target;
    const card=element('article',`task${p.clear?' clear':''}`);
    const top=element('div','task-top'), info=element('div');
    info.append(element('h3','',task.name));
    const meta=element('div','task-meta'); meta.append(element('span','type-label',task.type==='daily'?'毎日':`週${task.target}回`));
    if(task.deleted) meta.append(element('span','','削除済み · 履歴'));
    else { const edit=element('button','task-edit quiet','編集'); edit.setAttribute('aria-label',`${task.name}を編集`); edit.onclick=()=>openEditor(task); meta.append(edit); }
    info.append(meta); top.append(info);
    const result=element('div'); const ratio=element('div','progress'); ratio.append(element('span','',String(p.count)),element('small','',` / ${p.target}`)); result.append(ratio);
    result.append(element('div','clear-label',p.clear?'CLEAR ✓':`あと${p.target-p.count}日`)); top.append(result); card.append(top);
    if(task.note) card.append(element('p','task-note',task.note));
    const days=element('div','days');
    dates.forEach((date,i)=>{
      const key=Calendar.key(date), checked=Boolean(data.records[task.id]?.[key]);
      const button=element('button',`day${checked?' checked':''}${key===today?' today':''}`);
      button.dataset.taskId=task.id; button.dataset.date=key;
      const label=element('span','',weekdays[i]); label.append(element('span','day-number',String(date.getDate())));
      button.append(label,element('span','check',checked?'✓':'＋'));
      button.setAttribute('aria-pressed',String(checked)); button.setAttribute('aria-label',`${task.name}、${Calendar.label(date)}${key===today?'、今日':''}、${checked?'完了':'未完了'}`);
      button.disabled=!storageAvailable || Boolean(task.deleted);
      button.onclick=()=>toggleCheck(task.id,key); days.append(button);
    }); card.append(days); $('tasks').append(card);
  }
  if(!tasks.length) $('tasks').append(element('div','empty','習慣をひとつ追加して、気軽に始めましょう。'));
  $('summary').textContent=`${cleared} / ${tasks.length} の習慣が目標達成`;
  $('summary-detail').textContent=`${current?'今週':'この週'}の目標チェック ${done} / ${total}`;
  $('summary-fill').style.width=`${total?done/total*100:0}%`;
  $('add-task').disabled=!storageAvailable;
}
function toggleCheck(id,key) {
  const next=structuredClone(data); next.records[id] ||= {};
  if(next.records[id][key]) delete next.records[id][key]; else next.records[id][key]=true;
  if(commit(next)) {
    // Preserve keyboard position when rebuilding the cards.
    const buttons=[...$('tasks').querySelectorAll('.day')];
    buttons.find(b=>b.dataset.taskId===id && b.dataset.date===key)?.focus({preventScroll:true});
  }
}
function updateTypeField() { const daily=$('task-type').value==='daily'; $('target-field').hidden=daily; $('task-target').disabled=daily; }
function openEditor(task=null) {
  editingId=task?.id || null;
  $('dialog-title').textContent=task?'習慣を編集':'習慣を追加';
  $('task-name').value=task?.name || ''; $('task-note').value=task?.note || '';
  $('task-name').setCustomValidity('');
  $('task-type').value=task?.type || 'daily'; $('task-target').value=task?.target || 3;
  $('task-order').value=task?.order || Math.min(9999,Math.max(0,...data.tasks.filter(t=>!t.deleted).map(t=>t.order))+1);
  $('delete-task').hidden=!task; updateTypeField(); $('task-dialog').showModal(); $('task-name').focus();
}
$('task-form').onsubmit=event=>{
  event.preventDefault(); const name=$('task-name').value.trim();
  if(!name) { $('task-name').setCustomValidity('タスク名を入力してください。'); $('task-name').reportValidity(); return; }
  const next=structuredClone(data), task={id:editingId || makeId(),name,note:$('task-note').value.trim(),type:$('task-type').value,target:$('task-type').value==='daily'?7:Number($('task-target').value),order:Number($('task-order').value),deleted:false};
  if(editingId) next.tasks[next.tasks.findIndex(t=>t.id===editingId)]=task; else next.tasks.push(task);
  if(commit(next,'習慣を保存しました。')) $('task-dialog').close();
};
$('task-name').oninput=()=> $('task-name').setCustomValidity('');
$('delete-task').onclick=()=>{
  const task=data.tasks.find(t=>t.id===editingId);
  if(!confirm(`「${task.name}」を削除しますか？チェック済みの過去の記録は残ります。`)) return;
  const next=structuredClone(data); next.tasks.find(t=>t.id===editingId).deleted=true;
  if(commit(next,'習慣を削除しました。チェック履歴は保存されています。')) $('task-dialog').close();
};
$('add-task').onclick=()=>openEditor();
$('close-dialog').onclick=$('cancel-dialog').onclick=()=> $('task-dialog').close();
$('task-type').onchange=updateTypeField;
$('previous-week').onclick=()=>{selectedWeek=Calendar.add(selectedWeek,-7);render();};
$('next-week').onclick=()=>{selectedWeek=Calendar.add(selectedWeek,7);render();};
$('this-week').onclick=()=>{selectedWeek=Calendar.monday(new Date());render();};
// Refresh today's marker after returning to a tab, including across midnight.
document.addEventListener('visibilitychange',()=>{if(!document.hidden) render();});
render();
