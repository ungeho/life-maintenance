/* Local calendar keys never pass through UTC. Period ends are exclusive. */
const Calendar = {
  key(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; },
  parse(key) { const [y,m,d]=key.split('-').map(Number); return new Date(y,m-1,d,12); },
  add(date,days) { const result=new Date(date); result.setDate(result.getDate()+days); return result; },
  monday(date) { return this.add(date,-((date.getDay()+6)%7)); },
  month(date,offset=0) { return new Date(date.getFullYear(),date.getMonth()+offset,1,12); },
  label(date) { return `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()}`; },
  valid(key) { return typeof key==='string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && this.key(this.parse(key))===key; }
};
const STORAGE_KEY='life-maintenance';
const SCHEMA_VERSION=2;
const weekdays=['月','火','水','木','金','土','日'];
const $=id=>document.getElementById(id);
const todayKey=()=>Calendar.key(new Date());
const makeId=()=>globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const daysFrom=(start,length)=>Array.from({length},(_,i)=>Calendar.add(start,i));
function initialData() {
  return {schemaVersion:SCHEMA_VERSION,settings:{weekStartsOn:1},records:{},tasks:[
    ['部屋を10分片付ける','daily',7,''],['ウォーキング 20分','weekly',3,''],
    ['スクワット 10回×2セット','weekly',2,''],['体幹トレーニング','weekly',2,'無理に回数を増やさず、軽い負荷から始める。']
  ].map(([name,type,target,note],i)=>({id:makeId(),name,type,target,note,order:i+1,deleted:false,periods:[{start:todayKey(),end:null}]}))};
}
function validateData(value,version=SCHEMA_VERSION) {
  if(!value || value.schemaVersion!==version || !Array.isArray(value.tasks) || !value.records || typeof value.records!=='object' || Array.isArray(value.records)) throw new Error('保存データの形式・バージョンに対応していません。');
  const ids=new Set();
  for(const task of value.tasks) {
    if(!task || typeof task.id!=='string' || ids.has(task.id) || typeof task.name!=='string' || typeof task.note!=='string' || !['daily','weekly'].includes(task.type) || !Number.isInteger(task.target) || task.target<1 || task.target>7 || !Number.isInteger(task.order)) throw new Error('タスクの保存データを読み込めません。');
    ids.add(task.id);
    if(version===2) {
      if(!Array.isArray(task.periods)) throw new Error('有効期間を読み込めません。');
      task.periods.forEach((p,i)=>{
        const previous=task.periods[i-1];
        if(!p || !(p.start===null && i===0 || Calendar.valid(p.start)) || !(p.end===null || Calendar.valid(p.end)) || p.start!==null && p.end!==null && p.end<p.start || previous && (previous.end===null || p.start===null || p.start<previous.end)) throw new Error('有効期間の形式が不正です。');
      });
    }
  }
  for(const dates of Object.values(value.records)) {
    if(!dates || typeof dates!=='object' || Array.isArray(dates) || Object.entries(dates).some(([key,v])=>!Calendar.valid(key) || v!==true)) throw new Error('チェック履歴を読み込めません。');
  }
  return value;
}
// Pure and idempotent: never modify the source or rewrite v2 periods.
function migrateData(value) {
  if(value?.schemaVersion===2) return validateData(value);
  validateData(value,1);
  const next=structuredClone(value);
  next.tasks.forEach(task=>{task.periods=[{start:null,end:task.deleted?todayKey():null}];});
  next.schemaVersion=2;
  return validateData(next);
}
let data,storageAvailable=true,editingId=null,view='week';
let selectedWeek=Calendar.monday(new Date()),selectedMonth=Calendar.month(new Date());
try {
  const saved=localStorage.getItem(STORAGE_KEY);
  const source=saved===null?null:JSON.parse(saved);
  data=saved===null?initialData():migrateData(source);
  if(saved===null || source.schemaVersion!==SCHEMA_VERSION) localStorage.setItem(STORAGE_KEY,JSON.stringify(data));
} catch(error) {
  storageAvailable=false;
  data={schemaVersion:SCHEMA_VERSION,tasks:[],records:{},settings:{weekStartsOn:1}};
  $('status').textContent=`保存データを利用できません。既存データは上書きしません。ブラウザーの保存設定を確認してください。 (${error.message})`;
}
function commit(next,message='') {
  if(!storageAvailable) return false;
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(next)); data=next; $('status').textContent=message; render(); return true; }
  catch { $('status').textContent='保存できませんでした。ブラウザーの保存設定や空き容量を確認してください。'; return false; }
}
const activeOn=(task,key)=>task.periods.some(p=>(p.start===null || p.start<=key) && (p.end===null || key<p.end));
const isPaused=task=>!activeOn(task,todayKey());
const orderedTasks=()=>data.tasks.map((task,index)=>({task,index})).sort((a,b)=>a.task.order-b.task.order || a.index-b.index).map(x=>x.task);
const hasRecords=(task,dates)=>dates.some(d=>data.records[task.id]?.[Calendar.key(d)]);
function progress(task,dates) {
  const count=dates.filter(d=>data.records[task.id]?.[Calendar.key(d)]).length;
  const eligible=dates.filter(d=>activeOn(task,Calendar.key(d))).length;
  const target=task.type==='daily'?eligible:task.target;
  return {count,target,eligible,clear:target>0 && count>=target};
}
function monthStats(task,month) {
  const end=Calendar.month(month,1),length=Calendar.add(end,-1).getDate();
  const dates=daysFrom(month,length);
  const count=dates.filter(d=>data.records[task.id]?.[Calendar.key(d)]).length;
  const eligible=dates.filter(d=>activeOn(task,Calendar.key(d))).length;
  let weeks=0,cleared=0,recordedWeeks=0;
  for(let monday=Calendar.monday(month);monday<end;monday=Calendar.add(monday,7)) {
    if(monday<month) continue;
    const week=daysFrom(monday,7),p=progress(task,week);
    if(hasRecords(task,week)) recordedWeeks++;
    if(p.eligible>0) {weeks++;cleared+=Number(p.clear);}
  }
  return {count,eligible,weeks,cleared,recordedWeeks};
}
function element(tag,className,text) { const node=document.createElement(tag); if(className) node.className=className; if(text!==undefined) node.textContent=text; return node; }
function action(text,label,handler,className='') { const button=element('button',className,text); button.type='button'; button.setAttribute('aria-label',label); button.onclick=handler; button.disabled=!storageAvailable; return button; }
function taskHeading(task) {
  const info=element('div'); info.append(element('h3','',task.name));
  const meta=element('div','task-meta'); meta.append(element('span','type-label',task.type==='daily'?'毎日':`週${task.target}回`));
  if(task.deleted) meta.append(element('span','','削除済み · 履歴'));
  else if(isPaused(task)) meta.append(element('span','','現在休止中'));
  info.append(meta); return info;
}
function renderWeek() {
  const dates=daysFrom(selectedWeek,7),current=Calendar.key(selectedWeek)===Calendar.key(Calendar.monday(new Date()));
  $('week-label').textContent=current?'THIS WEEK · 今週':'WEEKLY LOG · 週の記録';
  $('this-week').hidden=current; $('week-range').textContent=`${Calendar.label(dates[0])} – ${Calendar.label(dates[6])}`;
  $('list-title').textContent=current?'今週の習慣':'この週の習慣'; $('list-hint').textContent='曜日を押してチェック';
  const tasks=orderedTasks().filter(task=>task.deleted?hasRecords(task,dates):current? !isPaused(task):dates.some(d=>activeOn(task,Calendar.key(d))) || hasRecords(task,dates));
  let cleared=0,done=0,total=0,eligibleTasks=0;
  for(const task of tasks) {
    const p=progress(task,dates);
    if(!task.deleted && p.eligible>0) {eligibleTasks++;cleared+=Number(p.clear);done+=Math.min(p.count,p.target);total+=p.target;}
    const card=element('article',`task${p.clear?' clear':''}`),top=element('div','task-top'),info=taskHeading(task);
    if(!task.deleted) info.querySelector('.task-meta').append(action('編集',`${task.name}を編集`,()=>openEditor(task),'task-edit quiet'));
    top.append(info); const result=element('div'); const ratio=element('div','progress'); ratio.append(element('span','',String(p.count)),element('small','',` / ${p.target}`)); result.append(ratio);
    result.append(element('div','clear-label',p.clear?'CLEAR ✓':p.target>0?`あと${Math.max(0,p.target-p.count)}日`:'チェック履歴'));top.append(result);card.append(top);
    if(task.note) card.append(element('p','task-note',task.note));
    const days=element('div','days');
    dates.forEach((date,i)=>{
      const key=Calendar.key(date),checked=Boolean(data.records[task.id]?.[key]),enabled=activeOn(task,key);
      const button=action('',`${task.name}、${Calendar.label(date)}${key===todayKey()?'、今日':''}、${checked?'完了':'未完了'}${enabled?'':'、休止期間または開始前'}`,()=>toggleCheck(task.id,key),`day${checked?' checked':''}${key===todayKey()?' today':''}`);
      button.dataset.taskId=task.id;button.dataset.date=key;
      const label=element('span','',weekdays[i]);label.append(element('span','day-number',String(date.getDate())));
      button.append(label,element('span','check',checked?'✓':enabled?'＋':'—'));button.setAttribute('aria-pressed',String(checked));button.disabled=!storageAvailable || Boolean(task.deleted) || !enabled;
      days.append(button);
    });card.append(days);$('tasks').append(card);
  }
  if(!tasks.length) $('tasks').append(element('div','empty','この週に表示する習慣はありません。追加・管理から始められます。'));
  $('summary').textContent=`${cleared} / ${eligibleTasks} の習慣が目標達成`;
  $('summary-detail').textContent=`${current?'今週':'この週'}の目標チェック ${done} / ${total}`;
  $('summary-fill').style.width=`${total?done/total*100:0}%`;
}
function renderMonth() {
  const current=Calendar.key(selectedMonth)===Calendar.key(Calendar.month(new Date()));
  $('month-range').textContent=`${selectedMonth.getFullYear()}年${selectedMonth.getMonth()+1}月`;$('this-month').hidden=current;
  $('list-title').textContent='月の振り返り';$('list-hint').textContent='できたことを、淡々と';
  let visible=0;
  for(const task of orderedTasks()) {
    const stats=monthStats(task,selectedMonth);
    if(task.deleted && !stats.count && !(task.type==='weekly' && stats.recordedWeeks)) continue;
    if(!stats.eligible && !stats.count && !stats.weeks) continue;
    visible++;
    const card=element('article','task month-task');card.append(taskHeading(task));
    const metrics=element('div','month-metrics');
    if(task.type==='daily') metrics.append(element('p','',`実施 ${stats.count} / ${stats.eligible}日`));
    else {metrics.append(element('p','',`週間目標達成 ${stats.cleared} / ${stats.weeks}週`),element('p','',`合計実施 ${stats.count}回`));}
    card.append(metrics);$('tasks').append(card);
  }
  if(!visible) $('tasks').append(element('div','empty','この月の習慣・記録はありません。'));
}
function renderManagement() {
  const tasks=orderedTasks().filter(t=>!t.deleted);
  $('management-list').replaceChildren();
  tasks.forEach((task,index)=>{
    const row=element('article','management-task');row.dataset.taskId=task.id;row.append(taskHeading(task));
    const controls=element('div','management-controls');
    for(const [direction,text] of [[-1,'↑'],[1,'↓']]) {
      const button=action(text,`${task.name}を${direction<0?'上':'下'}へ移動`,()=>moveTask(task.id,direction),'move-task');
      button.dataset.direction=direction;button.disabled=!storageAvailable || index+direction<0 || index+direction>=tasks.length;controls.append(button);
    }
    controls.append(action(isPaused(task)?'再開':'休止',`${task.name}を${isPaused(task)?'再開':'休止'}`,()=>setPaused(task.id,!isPaused(task)),'pause-task'),action('編集',`${task.name}を編集`,()=>openEditor(task),'edit-task'));
    row.append(controls);$('management-list').append(row);
  });
  if(!tasks.length) $('management-list').append(element('p','empty','管理する習慣はありません。'));
}
function render() {
  $('tasks').replaceChildren();$('week-view').hidden=view!=='week';$('month-view').hidden=view!=='month';
  for(const mode of ['week','month']) $(`${mode}-tab`).setAttribute('aria-pressed',String(view===mode));
  if(view==='week') renderWeek();else renderMonth();
  $('add-task').disabled=$('manage-tasks').disabled=!storageAvailable;
  renderManagement();
}
function toggleCheck(id,key) {
  const task=data.tasks.find(t=>t.id===id);if(!task || task.deleted || !activeOn(task,key)) return;
  const next=structuredClone(data);next.records[id] ||= {};
  if(next.records[id][key]) delete next.records[id][key];else next.records[id][key]=true;
  if(commit(next)) [...$('tasks').querySelectorAll('.day')].find(b=>b.dataset.taskId===id && b.dataset.date===key)?.focus({preventScroll:true});
}
function setPaused(id,paused) {
  const next=structuredClone(data),task=next.tasks.find(t=>t.id===id),today=todayKey();
  if(!task || task.deleted || paused===isPaused(task)) return;
  if(paused) {
    const last=task.periods.at(-1);last.end=today;
    if(last.start===today) task.periods.pop();
  } else {
    const last=task.periods.at(-1);
    if(last?.end===today) last.end=null;else task.periods.push({start:today,end:null});
  }
  if(commit(next,`「${task.name}」を${paused?'休止':'再開'}しました。履歴は保持されています。`)) {
    [...$('management-list').querySelectorAll('.management-task')].find(row=>row.dataset.taskId===id)?.querySelector('.pause-task').focus();
  }
}
function moveTask(id,direction) {
  const tasks=orderedTasks().filter(t=>!t.deleted),index=tasks.findIndex(t=>t.id===id),other=index+direction;
  if(index<0 || other<0 || other>=tasks.length) return;
  [tasks[index],tasks[other]]=[tasks[other],tasks[index]];
  const next=structuredClone(data);
  // Renumber to handle duplicate legacy order values reliably, including paused slots.
  tasks.forEach((task,i)=>{next.tasks.find(t=>t.id===task.id).order=i+1;});
  if(commit(next,'表示順を変更しました。')) {
    const row=[...$('management-list').querySelectorAll('.management-task')].find(r=>r.dataset.taskId===id);
    const button=row.querySelector(`[data-direction="${direction}"]`);
    (button.disabled?row.querySelector('.pause-task'):button).focus();
  }
}
function updateTypeField() { const daily=$('task-type').value==='daily';$('target-field').hidden=daily;$('task-target').disabled=daily; }
function openEditor(task=null) {
  editingId=task?.id || null;$('dialog-title').textContent=task?'習慣を編集':'習慣を追加';
  $('task-name').value=task?.name || '';$('task-note').value=task?.note || '';$('task-name').setCustomValidity('');
  $('task-type').value=task?.type || 'daily';$('task-target').value=task?.target || 3;
  $('task-order').value=task?.order ?? Math.min(9999,Math.max(0,...data.tasks.filter(t=>!t.deleted).map(t=>t.order))+1);
  $('delete-task').hidden=!task;updateTypeField();$('task-dialog').showModal();$('task-name').focus();
}
$('task-form').onsubmit=event=>{
  event.preventDefault();const name=$('task-name').value.trim();
  if(!name) {$('task-name').setCustomValidity('タスク名を入力してください。');$('task-name').reportValidity();return;}
  const next=structuredClone(data),existing=next.tasks.find(t=>t.id===editingId);
  const task={...(existing || {id:makeId(),deleted:false,periods:[{start:todayKey(),end:null}]}),name,note:$('task-note').value.trim(),type:$('task-type').value,target:$('task-type').value==='daily'?7:Number($('task-target').value),order:Number($('task-order').value)};
  if(existing) next.tasks[next.tasks.findIndex(t=>t.id===editingId)]=task;else next.tasks.push(task);
  if(commit(next,'習慣を保存しました。')) $('task-dialog').close();
};
$('task-name').oninput=()=> $('task-name').setCustomValidity('');
$('delete-task').onclick=()=>{
  const task=data.tasks.find(t=>t.id===editingId);
  if(!confirm(`「${task.name}」を削除しますか？休止とは異なり再開できません。チェック済みの記録は残ります。`)) return;
  const next=structuredClone(data),target=next.tasks.find(t=>t.id===editingId);target.deleted=true;
  if(target.periods.at(-1)?.end===null) target.periods.at(-1).end=todayKey();
  if(commit(next,'習慣を削除しました。チェック履歴は保存されています。')) $('task-dialog').close();
};
$('add-task').onclick=()=>openEditor();$('close-dialog').onclick=$('cancel-dialog').onclick=()=> $('task-dialog').close();$('task-type').onchange=updateTypeField;
$('manage-tasks').onclick=()=>{$('management-dialog').showModal();};$('close-management').onclick=()=> $('management-dialog').close();
$('week-tab').onclick=()=>{view='week';render();};$('month-tab').onclick=()=>{view='month';render();};
$('previous-week').onclick=()=>{selectedWeek=Calendar.add(selectedWeek,-7);render();};$('next-week').onclick=()=>{selectedWeek=Calendar.add(selectedWeek,7);render();};$('this-week').onclick=()=>{selectedWeek=Calendar.monday(new Date());render();};
$('previous-month').onclick=()=>{selectedMonth=Calendar.month(selectedMonth,-1);render();};$('next-month').onclick=()=>{selectedMonth=Calendar.month(selectedMonth,1);render();};$('this-month').onclick=()=>{selectedMonth=Calendar.month(new Date());render();};
// Follow today only if the user was viewing the current week/month before midnight.
let lastToday=todayKey();
function refreshDate() {
  const today=todayKey();
  if(today!==lastToday) {
    if(Calendar.key(selectedWeek)===Calendar.key(Calendar.monday(Calendar.parse(lastToday)))) selectedWeek=Calendar.monday(new Date());
    if(Calendar.key(selectedMonth)===Calendar.key(Calendar.month(Calendar.parse(lastToday)))) selectedMonth=Calendar.month(new Date());
    lastToday=today;render();
  }
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden) refreshDate();});setInterval(refreshDate,60000);
render();
