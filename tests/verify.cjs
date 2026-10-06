// Optional browser regression suite. App itself needs no dependencies/build.
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const path=require('node:path');
const url=pathToFileURL(path.resolve(__dirname,'../index.html')).href;
const fixture={schemaVersion:1,settings:{weekStartsOn:1,custom:'keep'},tasks:[
  {id:'daily',name:'片付け',note:'メモ',type:'daily',target:7,order:3,deleted:false},
  {id:'walk',name:'歩く',note:'',type:'weekly',target:3,order:1,deleted:false},
  {id:'squat',name:'スクワット',note:'',type:'weekly',target:2,order:1,deleted:false},
  {id:'deleted',name:'以前の習慣',note:'',type:'daily',target:7,order:9,deleted:true}
],records:{daily:{'2026-09-30':true,'2026-10-01':true,'2026-10-05':true},walk:{'2026-09-28':true,'2026-09-30':true,'2026-10-02':true,'2026-10-05':true,'2026-10-07':true,'2026-10-09':true,'2026-10-26':true,'2026-10-30':true,'2026-11-01':true,'2026-12-28':true,'2026-12-30':true,'2027-01-01':true},deleted:{'2026-09-29':true}}};
(async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.TEST_BROWSER || 'msedge'});
  let checks=0;
  const check=(value,expected,message)=>{assert.deepEqual(value,expected,message);checks++;};
  const contexts=[];
  try {
    async function setup(seed,timezoneId='Asia/Tokyo') {
      const context=await browser.newContext({timezoneId,viewport:{width:1200,height:1000}});contexts.push(context);
      const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.clock.install({time:new Date('2026-10-06T12:00:00+09:00')});await page.goto(url);
      if(seed!==undefined) {await page.evaluate(seed=>localStorage.setItem('life-maintenance',JSON.stringify(seed)),seed);await page.reload();}
      return {page,errors};
    }
    const {page:fresh,errors:freshErrors}=await setup();
    check(await fresh.locator('.task').count(),4,'initial tasks');check(await fresh.locator('.today').count(),4,'today markers');
    await fresh.locator('.task').first().locator('.day').nth(1).click();check(await fresh.locator('.checked').count(),1,'ON');
    await fresh.locator('.task').first().locator('.day').nth(1).click();check(await fresh.locator('.checked').count(),0,'OFF');
    check(await fresh.locator('.task').first().locator('.day').first().isDisabled(),true,'before creation disabled');
    await fresh.locator('#add-task').click();await fresh.locator('#task-name').fill('自炊 <安全>');await fresh.locator('#task-type').selectOption('weekly');await fresh.locator('#task-target').fill('2');await fresh.locator('#task-form button[type=submit]').click();
    check(await fresh.locator('.task').count(),5,'add');
    const custom=fresh.locator('.task').filter({has:fresh.getByRole('heading',{name:'自炊 <安全>',exact:true})});
    await custom.locator('.task-edit').click();await fresh.locator('#task-name').fill('自炊');await fresh.locator('#task-note').fill('軽く');await fresh.locator('#task-form button[type=submit]').click();
    await fresh.reload();check(await fresh.getByRole('heading',{name:'自炊',exact:true}).count(),1,'edit persists');
    await fresh.locator('.task').filter({has:fresh.getByRole('heading',{name:'自炊',exact:true})}).locator('.task-edit').click();
    fresh.once('dialog',d=>d.dismiss());await fresh.locator('#delete-task').click();check(await fresh.locator('#task-dialog').evaluate(d=>d.open),true,'delete cancel');
    fresh.once('dialog',d=>d.accept());await fresh.locator('#delete-task').click();check(await fresh.locator('.task').count(),4,'delete');
    const {page,errors}=await setup(fixture);
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('life-maintenance')));
    const migrated=await saved();check(migrated.schemaVersion,2,'migration version');check(migrated.records,fixture.records,'all history preserved');check(migrated.settings,fixture.settings,'settings preserved');
    check(migrated.tasks.map(({periods,...task})=>task),fixture.tasks,'tasks/order preserved exactly');
    check(migrated.tasks[0].periods,[{start:null,end:null}],'unknown legacy start');
    check(await page.evaluate(()=>JSON.stringify(migrateData(migrateData(data)))===JSON.stringify(data)),true,'idempotent migration');
    await page.reload();check(await saved(),migrated,'repeat startup no changes');
    const card=id=>page.locator('.task').filter({has:page.locator(`.day[data-task-id="${id}"]`)});
    check(await card('walk').locator('.clear-label').innerText(),'CLEAR ✓','weekly clear');
    await card('walk').locator('.day').nth(5).click();check(await card('walk').locator('.progress').innerText(),'4 / 3','over target');
    await card('walk').locator('.day').nth(0).click();await card('walk').locator('.day').nth(2).click();check(await card('walk').locator('.clear-label').innerText(),'あと1日','clear can unset');
    await card('walk').locator('.day').nth(0).click();await card('walk').locator('.day').nth(2).click();
    for(let i=1;i<7;i++) await card('daily').locator('.day').nth(i).click();check(await card('daily').locator('.clear-label').innerText(),'CLEAR ✓','daily 7/7 legacy');
    await page.locator('#previous-week').click();check(await page.locator('.task').count(),4,'deleted legacy history visible');check(await card('deleted').locator('.day:disabled').count(),7,'deleted readonly');
    check(await page.locator('#week-range').innerText(),'2026/9/28 – 2026/10/4','month crossing week');
    await page.locator('#next-week').click();check(await card('walk').locator('.checked').count(),4,'week records persist');
    const historyBefore=(await saved()).records;
    await page.locator('#manage-tasks').click();
    const row=id=>page.locator(`.management-task[data-task-id="${id}"]`);
    await row('daily').locator('.pause-task').click();check(await page.locator('.task').count(),2,'paused hidden current');check((await saved()).records,historyBefore,'pause preserves every record');
    check((await saved()).tasks[0].periods,[{start:null,end:'2026-10-06'}],'pause end exclusive');
    await page.locator('#close-management').click();await page.locator('#previous-week').click();check(await card('daily').count(),1,'past active task shown');
    await page.locator('#next-week').click();await page.locator('#manage-tasks').click();
    await row('daily').locator('.pause-task').click();check((await saved()).tasks[0].periods,[{start:null,end:null}],'same day resume merges');
    await row('daily').locator('.pause-task').click();
    await page.clock.setSystemTime(new Date('2026-10-08T12:00:00+09:00'));await page.evaluate(()=>refreshDate());
    await row('daily').locator('.pause-task').click();check((await saved()).tasks[0].periods,[{start:null,end:'2026-10-06'},{start:'2026-10-08',end:null}],'later resume adds interval');
    check((await saved()).records,historyBefore,'resume preserves every record');
    await row('daily').locator('[data-direction="-1"]').click();check(await page.locator('.management-task').evaluateAll(rows=>rows.map(r=>r.dataset.taskId)),['walk','daily','squat'],'duplicate order handled');
    await row('daily').locator('.pause-task').click();await row('walk').locator('[data-direction="1"]').click();
    check(await page.locator('.management-task').evaluateAll(rows=>rows.map(r=>r.dataset.taskId)),['daily','walk','squat'],'paused position participates');
    await row('daily').locator('.pause-task').click();await page.locator('#close-management').click();await page.reload();
    check(await page.locator('.task').evaluateAll(rows=>rows.map(r=>r.querySelector('.day').dataset.taskId)),['daily','walk','squat'],'order reload and resume');
    check(await card('daily').locator('.day').nth(1).isDisabled(),true,'pause date readonly');check(await card('daily').locator('.day').nth(3).isDisabled(),false,'resume date enabled');
    await card('daily').locator('.task-edit').click();await page.locator('#task-note').fill('変更後');await page.locator('#task-form button[type=submit]').click();
    check((await saved()).tasks[0].periods,[{start:null,end:'2026-10-06'},{start:'2026-10-08',end:null}],'edit retains intervals');
    await page.locator('#month-tab').click();check(await page.locator('#month-range').innerText(),'2026年10月','month view');
    const stats=await page.evaluate(()=>monthStats(data.tasks.find(t=>t.id==='walk'),selectedMonth));
    check({count:stats.count,weeks:stats.weeks,cleared:stats.cleared},{count:7,weeks:4,cleared:2},'date month and Monday month boundaries');
    check(await page.evaluate(()=>monthStats(data.tasks.find(t=>t.id==='daily'),selectedMonth).eligible),29,'paused days excluded daily denominator');
    await page.locator('#previous-month').click();check(await page.locator('#month-range').innerText(),'2026年9月','previous month');
    check(await page.evaluate(()=>monthStats(data.tasks.find(t=>t.id==='walk'),selectedMonth).cleared),1,'October checks contribute September Monday clear');
    await page.locator('#next-month').click();await page.locator('#next-month').click();check(await page.locator('#month-range').innerText(),'2026年11月','next month');
    check(await page.evaluate(()=>monthStats(data.tasks.find(t=>t.id==='walk'),selectedMonth).count),1,'November actual date');
    await page.locator('#next-month').click();await page.locator('#next-month').click();check(await page.locator('#month-range').innerText(),'2027年1月','year boundary navigation');
    await page.locator('#previous-month').click();check(await page.evaluate(()=>monthStats(data.tasks.find(t=>t.id==='walk'),selectedMonth).cleared),1,'Jan checks contribute December Monday clear');
    await page.locator('#week-tab').click();await page.evaluate(()=>{selectedWeek=Calendar.monday(Calendar.parse('2027-01-01'));render();});check(await page.locator('#week-range').innerText(),'2026/12/28 – 2027/1/3','year crossing week');
    await page.locator('#this-week').click();await page.locator('#manage-tasks').click();await row('squat').locator('.pause-task').click();await row('squat').locator('.edit-task').click();
    page.once('dialog',d=>d.accept());await page.locator('#delete-task').click();check(await row('squat').count(),0,'delete paused');
    await page.setViewportSize({width:375,height:900});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile page overflow');
    check(await page.locator('#management-dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true,'mobile management overflow');
    await page.screenshot({path:path.join(__dirname,'mobile-management.png'),fullPage:true});await page.locator('#close-management').click();await page.locator('#month-tab').click();await page.locator('#this-month').click();
    await page.screenshot({path:path.join(__dirname,'mobile-month.png'),fullPage:true});
    await page.setViewportSize({width:1200,height:1000});await page.screenshot({path:path.join(__dirname,'desktop-month.png'),fullPage:true});
    const unsupported={schemaVersion:99};await page.evaluate(v=>localStorage.setItem('life-maintenance',JSON.stringify(v)),unsupported);await page.reload();
    check(await page.locator('#add-task').isDisabled(),true,'unsupported protected');check(await saved(),unsupported,'unsupported not overwritten');
    await page.evaluate(()=>localStorage.setItem('life-maintenance','null'));await page.reload();
    check(await page.locator('#add-task').isDisabled(),true,'invalid null protected');check(await page.evaluate(()=>localStorage.getItem('life-maintenance')),'null','null not replaced by samples');
    await page.evaluate(seed=>localStorage.setItem('life-maintenance',JSON.stringify(seed)),fixture);
    await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new Error('test quota');};});await page.reload();
    check(await saved(),fixture,'migration save failure retains v1');check(await page.locator('#add-task').isDisabled(),true,'failed migration disables writes');
    const {page:west,errors:westErrors}=await setup(fixture,'America/Los_Angeles');check(await west.evaluate(()=>Calendar.key(Calendar.parse('2027-01-01'))),'2027-01-01','local timezone keys');
    check(errors.concat(freshErrors,westErrors),[],'browser errors');
    console.log(`PASS: ${checks} assertions covering Phase 1, Phase 2 and v1 migration`);
  } finally {for(const context of contexts) await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

