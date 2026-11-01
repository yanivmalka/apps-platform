/* ===================== UTIL ===================== */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtN=n=>Math.round(n||0).toLocaleString('he-IL');
const fmtS=n=>'₪'+Math.round(n||0).toLocaleString('he-IL');
const DAY=864e5;
function gem(n){const o=['','א','ב','ג','ד','ה','ו','ז','ח','ט'],t=['','י','כ','ל','מ','נ','ס','ע','פ','צ'],h=['','ק','ר','ש','ת','תק','תר','תש','תת','תתק'];
  n=n%1000;let s=h[Math.floor(n/100)];let r=n%100;if(r===15)s+='טו';else if(r===16)s+='טז';else s+=t[Math.floor(r/10)]+o[r%10];
  return s.length>1?s.slice(0,-1)+'״'+s.slice(-1):s+'׳';}
let toastT;function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,2800)}
const uidGen=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

/* ===================== SEASON (Omer days) ===================== */
function nisan16(y){
  try{const f=new Intl.DateTimeFormat('en-u-ca-hebrew',{month:'long',day:'numeric',timeZone:'UTC'});
    for(let t=Date.UTC(y,2,10);t<Date.UTC(y,4,15);t+=DAY){const p=f.formatToParts(new Date(t));
      const m=(p.find(x=>x.type==='month')||{}).value||'',d=+((p.find(x=>x.type==='day')||{}).value);
      if(/^Nisan/.test(m)&&d===16)return t;}}catch(e){}
  return null;}
const SEASON=(()=>{const y=new Date().getUTCFullYear();let t=nisan16(y);if(!t||Date.now()>t+49*DAY)t=nisan16(y+1);if(!t)t=Date.UTC(2027,3,23);
  const days=[];for(let n=1;n<=49;n++){const dayT=t+(n-1)*DAY,eve=new Date(dayT-DAY);let blocked=null;
    if(eve.getUTCDay()===5)blocked='שבת';if(n===6)blocked='יום טוב';days.push({n,dayT,eve,blocked,week:Math.ceil(n/7)});}
  const hy=new Date(t).getUTCFullYear()+3760;return{t,days,hy};})();
const DAYS=SEASON.days;
const eveStr=n=>{const e=DAYS[n-1].eve;return e.getUTCDate()+'.'+(e.getUTCMonth()+1)};
const WEEK_SEF=['חסד','גבורה','תפארת','נצח','הוד','יסוד','מלכות'];

/* ===================== STATE ===================== */
const DEFAULT_CFG={users:5000,opens:1.4,more:0.2,sellable:0.8,cpm:40,allowCustom:true,minPrice:18};
const PURPOSES=['לעילוי נשמת','לרפואת','להצלחת','לפרנסה טובה ל','לזיווג הגון ל','לשלום בית ל'];
const STATUS={pending:['ממתין לתשלום','warn'],active:['פעיל','ok'],paused:['מושהה','bad'],done:['הסתיים',''],cancelled:['בוטל','bad']};
const S={P:null,reg:{},uid:null,isAdmin:false,me:null,member:undefined,plans:[],orders:[],slots:[],counts:{},members:[],config:{...DEFAULT_CFG},
  ready:{plans:false,orders:false},sel:{planId:null,start:null,purpose:PURPOSES[0],name:'',from:'',imp:2000,days:7},editPlan:null,
  adminFilter:'all',confirm:null,sim:{users:5000,sell:40,cpm:40,cpi:1,excl:50,exclPrice:250,fixed:2000,avgOrder:110}};

/* ===================== INVENTORY ===================== */
function supply(n){const d=DAYS[n-1];if(!d||d.blocked)return 0;const c=S.config;let f=1-0.35*(n-1)/48;
  if(n===1)f*=1.3;if(n===2||n===3)f*=1.1;if(n===33)f*=1.25;return Math.round(c.users*f*c.opens*(1+c.more)*c.sellable);}
const LIVE=['pending','active','paused'];
function allOrders(){return S.orders.filter(o=>o.season===SEASON.hy).map(o=>({...o,shown:(S.counts[o.id]||{}).shown||0,prayed:(S.counts[o.id]||{}).prayed||0})).sort((a,b)=>(b.created||0)-(a.created||0));}
/* Inventory: an admin sees every order (pending ones hold stock too); a customer sees the published slots (approved orders). */
function usedMap(){const u={};if(S.isAdmin){for(const o of allOrders())if(LIVE.includes(o.status)&&!o.exclusive)for(const[k,v]of Object.entries(o.alloc||{}))u[k]=(u[k]||0)+v;}
  else for(const sl of S.slots)for(const it of sl.items||[])if(!it.exclusive)u[sl.night]=(u[sl.night]||0)+(it.weight||0);return u;}
function exclTaken(){const s=new Set();if(S.isAdmin){for(const o of allOrders())if(LIVE.includes(o.status)&&o.exclusive)for(const k of Object.keys(o.alloc||{}))s.add(+k);}
  else for(const sl of S.slots)if((sl.items||[]).some(i=>i.exclusive))s.add(sl.night);return s;}
function windowDays(start,len){const r=[];for(let n=start;n<=Math.min(49,start+len-1);n++)r.push(n);return r;}
function tryAlloc(start,len,imp,exclusive){
  const days=windowDays(start,len).filter(n=>!DAYS[n-1].blocked);if(!days.length)return{ok:false,why:'אין בטווח ימים פעילים'};
  if(exclusive){const tk=exclTaken();const bad=days.filter(n=>tk.has(n));if(bad.length)return{ok:false,why:'החסות הבלעדית כבר תפוסה בליל '+bad.map(gem).join(', ')};
    const alloc={};days.forEach(n=>alloc[n]=supply(n));return{ok:true,alloc,days,imp:days.reduce((a,n)=>a+supply(n),0)};}
  const used=usedMap();const free=days.map(n=>Math.max(0,supply(n)-(used[n]||0)));const tot=free.reduce((a,b)=>a+b,0);
  if(tot<imp)return{ok:false,why:'בטווח הזה נשארו רק '+fmtN(tot)+' חשיפות פנויות',max:tot};
  const alloc={};let given=0;days.forEach((n,i)=>{const a=Math.floor(imp*free[i]/tot);alloc[n]=a;given+=a});
  let rem=imp-given,i=0;while(rem>0){const n=days[i%days.length];if(alloc[n]<free[i%days.length]){alloc[n]++;rem--}i++;}
  for(const k in alloc)if(!alloc[k])delete alloc[k];return{ok:true,alloc,days,imp};}
function dayUtil(n){const s=supply(n);if(!s)return null;return Math.min(1,(usedMap()[n]||0)/s);}
function customPrice(imp,days){const c=S.config;let x=imp*c.cpm/1000;x*=imp>=10000?.8:imp>=5000?.88:imp>=2000?.95:1;if(days<=2)x*=1.15;return Math.max(c.minPrice||18,Math.round(x/6)*6);}
function suggestedPrice(imp,days,excl){if(excl)return Math.max(180,Math.round(days*S.config.users*0.05/18)*18);return customPrice(imp,days);}

/* ===================== SELECTION ===================== */
function curPlan(){if(S.sel.planId==='custom')return{id:'custom',name:'חבילה בהתאמה אישית',days:S.sel.days,impressions:S.sel.imp,price:customPrice(S.sel.imp,S.sel.days),exclusive:false};
  return S.plans.find(p=>p.id===S.sel.planId&&p.active)||null;}
function bestStart(len,imp,excl){let best=null,bestFree=-1;const used=usedMap(),tk=exclTaken();
  for(let s=1;s<=49;s++){const ds=windowDays(s,len).filter(n=>!DAYS[n-1].blocked);if(!ds.length)continue;
    if(excl){if(ds.some(n=>tk.has(n)))continue;const f=ds.length;if(f>bestFree){bestFree=f;best=s}continue;}
    const f=ds.reduce((a,n)=>a+Math.max(0,supply(n)-(used[n]||0)),0);if(f>=imp&&f>bestFree){bestFree=f;best=s}}
  return best;}

/* ===================== RENDER: shell ===================== */
const TABS=[['order','הזמנת הקדשה'],['mine','ההזמנות שלי'],['admin','ניהול',1],['sim','סימולציית רווח',1]];
function route(){let h=(location.hash||'#order').slice(1);if(!TABS.some(t=>t[0]===h))h='order';const t=TABS.find(x=>x[0]===h);if(t[2]&&!S.isAdmin)h='order';return h;}
function renderTabs(){const cur=route();$('#tabs').innerHTML=TABS.filter(t=>!t[2]||S.isAdmin).map(([k,l])=>`<a href="#${k}" ${k===cur?'aria-current="page"':''}>${l}</a>`).join('');}
function renderHeader(){
  const s=DAYS[0].eve,e=DAYS[48].eve;
  $('#seasonLine').textContent=`ספירת העומר ${gem(SEASON.hy)} · ליל א׳ ${s.getUTCDate()}.${s.getUTCMonth()+1} עד ליל מ״ט ${e.getUTCDate()}.${e.getUTCMonth()+1}.${e.getUTCFullYear()}`;
  const w=$('#who');if(!S.P){w.textContent='';return}
  if(!S.me){w.innerHTML='<button class="btn small" data-act="signIn">התחברות עם Google</button>';return}
  const nm=S.member?.name||S.me.name||'';w.innerHTML=`${S.me.photo?`<img alt="" src="${esc(S.me.photo)}">`:''}<span>${esc(nm||'מחובר')}${S.isAdmin?' · מנהל':''}</span><button class="btn small" data-act="signOut">יציאה</button>`;}
let lastRoute=null;
function render(force){renderTabs();renderHeader();const r=route();if(r!==lastRoute||force){lastRoute=r;({order:buildOrder,mine:buildMine,admin:buildAdmin,sim:buildSim})[r]();}refresh();}
function refresh(){const r=route();({order:refreshOrder,mine:refreshMine,admin:refreshAdmin,sim:refreshSim})[r]();}
window.addEventListener('hashchange',()=>render());

/* ===================== ORDER TAB ===================== */
function buildOrder(){
  $('#main').innerHTML=`
  <section class="block"><div class="step"><b>א</b><div><h2>בחרו חבילה</h2><p class="sub">ההקדשה מוצגת למתפללים בתוך האפליקציה, בזמן הספירה. כל חבילה קובעת עד כמה חשיפות ובאיזה פרק זמן.</p></div></div>
    <div class="grid-plans" id="plans"></div><div id="customBox"></div></section>
  <section class="block"><div class="step"><b>ב</b><div><h2>בחרו מאיזה לילה להתחיל</h2><p class="sub">הפס בכל משבצת מראה כמה מהמלאי של אותו לילה כבר הוזמן. ליל שבת וליל יום טוב חסומים.</p></div></div>
    <div class="panel"><div class="row" style="justify-content:space-between"><div class="cal-legend">
      <span><i style="background:var(--ok)"></i>פנוי</span><span><i style="background:var(--warn)"></i>מתמלא</span><span><i style="background:var(--bad)"></i>כמעט מלא</span><span><i style="background:var(--gold-soft);border:1px solid var(--gold-line)"></i>הטווח שבחרתם</span></div>
      <button class="btn small" data-act="best">הציעו לי את הימים הפנויים ביותר</button></div>
      <div class="cal" id="cal"></div><p class="err" id="calErr"></p></div></section>
  <section class="block"><div class="step"><b>ג</b><div><h2>נוסח ההקדשה</h2></div></div>
    <div class="panel"><div class="row">
      <label class="f">מטרה<select id="fPurpose">${PURPOSES.map(p=>`<option ${p===S.sel.purpose?'selected':''}>${esc(p)}</option>`).join('')}</select></label>
      <label class="f" style="flex:2 1 220px">שם (לדוגמה: יוסף בן רחל)<input id="fName" maxlength="60" value="${esc(S.sel.name)}" autocomplete="off"></label></div>
      <div class="row" style="margin-top:10px"><label class="f">הוקדש על ידי (לא חובה)<input id="fFrom" maxlength="40" value="${esc(S.sel.from)}" placeholder="משפחת כהן"></label></div>
      <p class="note" id="preview" style="margin:10px 0 0"></p></div></section>
  <section class="block"><div class="step"><b>ד</b><div><h2>סיכום והזמנה</h2></div></div><div class="panel" id="summary"></div></section>`;
  $('#fPurpose').onchange=e=>{S.sel.purpose=e.target.value;refreshPreview()};
  $('#fName').oninput=e=>{S.sel.name=e.target.value;refreshPreview();refreshSummary()};
  $('#fFrom').oninput=e=>{S.sel.from=e.target.value;refreshPreview()};}
function refreshPreview(){const p=$('#preview');if(!p)return;const n=S.sel.name.trim()||'פלוני בן פלוני';
  p.innerHTML=`כך זה ייראה באפליקציה: <b style="color:var(--ink)">הספירה הלילה ${esc(S.sel.purpose)} ${esc(n)}</b>${S.sel.from.trim()?` · <span>הוקדש ע״י ${esc(S.sel.from)}</span>`:''}`;}
function refreshOrder(){
  const pl=$('#plans');if(!pl)return;
  const plans=S.plans.filter(p=>p.active).sort((a,b)=>(a.order||0)-(b.order||0));
  if(!S.ready.plans){pl.innerHTML='<div class="empty">טוען חבילות…</div>'}
  else if(!plans.length&&!S.config.allowCustom){pl.innerHTML='<div class="empty">אין כרגע חבילות פתוחות להזמנה.</div>'}
  else{pl.innerHTML=plans.map(p=>`<button class="plan" data-act="plan" data-id="${esc(p.id)}" aria-pressed="${S.sel.planId===p.id}">
      <div class="row" style="justify-content:space-between"><h3>${esc(p.name)}</h3>${p.exclusive?'<span class="tag gold">בלעדי</span>':''}</div>
      <div class="price num">${fmtS(p.price)}</div>
      <div class="meta">${p.exclusive?'כל המסך הראשי של הלילה':'עד '+fmtN(p.impressions)+' חשיפות'} · ${p.days===1?'לילה אחד':'עד '+p.days+' לילות'}</div>
      ${p.desc?`<div class="desc">${esc(p.desc)}</div>`:''}</button>`).join('')+
    (S.config.allowCustom?`<button class="plan" data-act="plan" data-id="custom" aria-pressed="${S.sel.planId==='custom'}"><h3>בנו חבילה בעצמכם</h3>
      <div class="price num">מ־${fmtS(S.config.minPrice||18)}</div><div class="meta">בוחרים כמות חשיפות ומספר לילות, המחיר מחושב מיד</div></button>`:'');}
  const cb=$('#customBox');
  if(S.sel.planId==='custom'){if(!cb.dataset.on){cb.dataset.on=1;cb.innerHTML=`<div class="panel custom-box">
      <label class="f">כמות חשיפות: <span class="num" id="cImpL"></span><input type="range" id="cImp" min="300" max="20000" step="100" value="${S.sel.imp}"></label>
      <label class="f">פרק זמן: <span id="cDaysL"></span><input type="range" id="cDays" min="1" max="49" step="1" value="${S.sel.days}"></label>
      <p class="note" id="cHint" style="margin:0"></p></div>`;
      $('#cImp').oninput=e=>{S.sel.imp=+e.target.value;refreshCalendar();refreshSummary();customLabels()};
      $('#cDays').oninput=e=>{S.sel.days=+e.target.value;refreshCalendar();refreshSummary();customLabels()};}
    customLabels();}else{cb.dataset.on='';cb.innerHTML='';}
  refreshCalendar();refreshPreview();refreshSummary();}
function customLabels(){const p=customPrice(S.sel.imp,S.sel.days);$('#cImpL').textContent=fmtN(S.sel.imp);$('#cDaysL').textContent=S.sel.days===1?'לילה אחד':S.sel.days+' לילות';
  $('#cHint').textContent=`מחיר: ${fmtS(p)} · כ־${fmtN(S.sel.imp/Math.max(1,S.sel.days))} חשיפות ללילה. הנחת כמות מ־2,000 חשיפות ומעלה.`;}
function refreshCalendar(){
  const cal=$('#cal');if(!cal)return;const p=curPlan();const used=usedMap(),tk=exclTaken();
  const win=p&&S.sel.start?new Set(windowDays(S.sel.start,p.days)):new Set();let h='';
  for(let w=0;w<7;w++){h+=`<div class="wk" title="שבוע ${WEEK_SEF[w]}">${WEEK_SEF[w]}</div>`;
    for(let k=1;k<=7;k++){const n=w*7+k,d=DAYS[n-1],sup=supply(n),u=sup?Math.min(1,(used[n]||0)/sup):0;
      const cls=['day'];if(d.blocked)cls.push('blocked');else{if(u>=.9)cls.push('u-high','full');else if(u>=.6)cls.push('u-mid')}
      if(win.has(n)&&!d.blocked)cls.push('inwin');if(n===S.sel.start)cls.push('start');
      const xs=tk.has(n)?'<span class="x" title="חסות בלעדית תפוסה">★</span>':'';
      h+=`<button class="${cls.join(' ')}" data-act="day" data-n="${n}" ${d.blocked?'disabled aria-disabled="true"':''} aria-label="ליל ${gem(n)} לעומר${d.blocked?' – '+d.blocked:', '+Math.round((1-u)*100)+'% פנוי'}">
        ${xs}<span class="g">${gem(n)}</span><span class="d">${d.blocked?d.blocked:eveStr(n)}</span>${d.blocked?'':`<span class="bar"><span style="width:${Math.round(u*100)}%"></span></span>`}</button>`;}}
  cal.innerHTML=h;}
function refreshSummary(){
  const box=$('#summary');if(!box)return;const p=curPlan();
  if(!p){box.innerHTML='<p class="note" style="margin:0">בחרו חבילה ולילה התחלה כדי לראות סיכום.</p>';return}
  if(!S.sel.start){box.innerHTML=`<p class="note" style="margin:0">נבחרה: <b>${esc(p.name)}</b>. עכשיו בחרו לילה התחלה בלוח.</p>`;return}
  const a=tryAlloc(S.sel.start,p.days,p.impressions,p.exclusive);const end=Math.min(49,S.sel.start+p.days-1);
  let h=`<div class="summary">
    <div class="kv"><span>חבילה</span><span>${esc(p.name)}</span></div>
    <div class="kv"><span>טווח</span><span>ליל ${gem(S.sel.start)} (${eveStr(S.sel.start)})${end>S.sel.start?` עד ליל ${gem(end)} (${eveStr(end)})`:''}</span></div>
    <div class="kv"><span>${p.exclusive?'חשיפות משוערות':'עד'}</span><span class="num">${a.ok?fmtN(a.imp):'—'} חשיפות${a.ok?` ב־${a.days.length} לילות`:''}</span></div>
    <div class="kv"><span>לתשלום (כולל מע״מ)</span><span class="total num">${fmtS(p.price)}</span></div></div>`;
  if(!a.ok)h+=`<p class="err">${esc(a.why)}. נסו לילה התחלה אחר או חבילה קטנה יותר.</p>`;
  if(!S.P){h+=`<p class="err">המערכת לא מחוברת כרגע. נסו שוב מאוחר יותר.</p>`}
  else if(!S.uid){h+=`<div class="row" style="margin-top:12px"><button class="btn primary" data-act="signIn">התחברות עם Google כדי להזמין</button></div><p class="note">רק משתמשים רשומים יכולים להזמין.</p>`}
  else if(S.member===undefined){h+='<p class="note">בודק הרשמה…</p>'}
  else if(!S.member){h+=`<div class="panel" style="margin-top:12px;background:var(--sunk)"><h3>הרשמה קצרה לפני הזמנה</h3><p class="note">רק משתמשים רשומים יכולים להזמין. הפרטים משמשים לאישור התשלום וליצירת קשר.</p>
      <div class="row"><label class="f">שם מלא<input id="rName" data-reg="name" value="${esc(S.reg.name??S.me?.name??'')}"></label><label class="f">טלפון<input id="rPhone" data-reg="phone" inputmode="tel" dir="ltr" value="${esc(S.reg.phone??'')}"></label><label class="f">אימייל<input id="rEmail" data-reg="email" type="email" dir="ltr" value="${esc(S.reg.email??S.me?.email??'')}"></label></div>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-act="register">הרשמה</button><span class="err" id="rErr"></span></div></div>`}
  else{const can=a.ok&&S.sel.name.trim().length>=2;
    h+=`<div class="row" style="margin-top:12px"><button class="btn gold" data-act="placeOrder" ${can?'':'disabled'}>הזמנת ההקדשה</button>
      ${!S.sel.name.trim()?'<span class="note">חסר שם להקדשה (שלב ג)</span>':''}</div>
      <p class="note">אחרי ההזמנה המקום שמור לכם. ההקדשה עולה לאוויר כשהתשלום מאושר (ביט או העברה; פרטים יישלחו אליכם).</p>`}
  box.innerHTML=h;}

/* ===================== MINE TAB ===================== */
function buildMine(){$('#main').innerHTML=`<section class="block"><h2>ההזמנות שלי</h2><p class="sub">חשיפות והצבעות "הזכרתי בתפילתי" מתעדכנות מהאפליקציה בזמן הספירה.</p><div class="orders" id="mine"></div><p class="note" id="acct" style="margin-top:18px"></p></section>`}
function orderCard(o,admin){const st=STATUS[o.status]||['',''];const days=Object.keys(o.alloc||{}).map(Number).sort((a,b)=>a-b);
  const pr=o.impressions?Math.min(1,(o.shown||0)/o.impressions):0;const rate=o.shown?((o.prayed||0)/o.shown*100).toFixed(1):'0';
  return `<div class="ocard"><div class="row" style="justify-content:space-between"><span class="ded">${esc(o.purpose)} ${esc(o.name)}</span><span class="tag ${st[1]}">${st[0]}</span></div>
    <div class="note">${esc(o.planName)} · ${days.length?`ליל ${gem(days[0])}${days.length>1?' עד ליל '+gem(days[days.length-1]):''}`:''} · ${fmtS(o.price)}${o.from?' · הוקדש ע״י '+esc(o.from):''}</div>
    <div class="prog" aria-hidden="true"><span style="width:${Math.round(pr*100)}%"></span></div>
    <div class="stats"><span><b class="num">${fmtN(o.shown)}</b> / ${fmtN(o.impressions)} חשיפות</span><span><b class="num">${fmtN(o.prayed)}</b> הזכירו בתפילתם</span><span><b class="num">${rate}%</b> שיעור תפילה</span></div>
    ${!admin&&o.status==='pending'?`<div class="row">${S.confirm===o.id?`<div class="confirm-row">לבטל את ההזמנה? <button class="btn small danger" data-act="cancelMine" data-id="${o.id}">כן, בטלו</button><button class="btn small" data-act="noConfirm">לא</button></div>`:`<button class="btn small danger" data-act="askCancel" data-id="${o.id}">ביטול הזמנה</button>`}</div>`:''}</div>`;}
function refreshMine(){const m=$('#mine');if(!m)return;const ac=$('#acct');if(ac)ac.textContent=S.uid?'מזהה החשבון שלך (לצורכי תמיכה): '+S.uid:'';if(!S.uid){m.innerHTML='<div class="empty">התחברו כדי לראות את ההזמנות שלכם.</div>';return}
  if(!S.ready.orders){m.innerHTML='<div class="empty">טוען…</div>';return}
  const mine=allOrders().filter(o=>o.uid===S.uid);
  m.innerHTML=mine.length?mine.map(o=>orderCard(o,false)).join(''):'<div class="empty">עדיין אין הזמנות. <a href="#order">להזמנת הקדשה</a></div>';}

/* ===================== ADMIN TAB ===================== */
function buildAdmin(){
  $('#main').innerHTML=`
  <section class="block"><h2>תמונת מצב</h2><p class="sub">כל המספרים כוללים הזמנות פיקטיביות כשהן קיימות. אפשר לסנן למטה.</p><div class="kpis" id="kpis"></div>
    <div class="panel chart"><h3 style="margin-bottom:8px">תפוסת מלאי לפי לילה</h3><div id="utilChart"></div></div></section>
  <section class="block"><div class="row" style="justify-content:space-between"><h2>תכניות</h2><button class="btn small" data-act="newPlan">תכנית חדשה</button></div>
    <p class="sub">תכנית מושהית לא מוצגת ללקוחות, וההזמנות הקיימות עליה ממשיכות.</p><div id="planForm"></div><div class="tbl-wrap" id="plansTbl"></div></section>
  <section class="block"><div class="row" style="justify-content:space-between"><h2>הזמנות</h2>
    <select id="oFilter" style="width:auto"><option value="all">הכל</option><option value="real">אמיתיות</option><option value="sim">פיקטיביות</option><option value="pending">ממתינות לתשלום</option></select></div>
    <div class="tbl-wrap" id="ordersTbl" style="margin-top:8px"></div></section>
  <section class="block"><h2>כלי סימולציה</h2><p class="sub">הזמנות פיקטיביות מסומנות ואפשר למחוק את כולן בלחיצה. הן תופסות מלאי כמו הזמנות אמיתיות.</p>
    <div class="row"><button class="btn primary" data-act="fake" data-k="20">הוסף 20 הזמנות פיקטיביות</button><button class="btn" data-act="fake" data-k="60">הוסף 60</button>
    <button class="btn" data-act="fakeStats">מלא חשיפות ותפילות לפיקטיביות</button><button class="btn danger" data-act="askDelFake">מחק את כל הפיקטיביות</button></div><div id="fakeConfirm"></div></section>
  <section class="block"><h2>משתמשים רשומים</h2><div class="tbl-wrap" id="membersTbl"></div></section>
  <section class="block"><h2>הגדרות מלאי ומחיר</h2><p class="sub">המלאי היומי = משתמשים פעילים × פתיחות ללילה × (1 + שיעור "עוד שם") × החלק שנמכר. שאר החשיפות נשארות להקדשות של הבית.</p>
    <div class="panel"><div class="row">
      <label class="f">משתמשים פעילים צפויים<input type="number" id="cfg-users" min="100" step="100"></label>
      <label class="f">פתיחות ללילה למשתמש<input type="number" id="cfg-opens" min="0.5" step="0.1"></label>
      <label class="f">שיעור "עוד שם"<input type="number" id="cfg-more" min="0" max="2" step="0.05"></label>
      <label class="f">חלק נמכר מהמלאי<input type="number" id="cfg-sellable" min="0.1" max="1" step="0.05"></label>
      <label class="f">מחיר יעד לאלף חשיפות (₪)<input type="number" id="cfg-cpm" min="5" step="1"></label>
      <label class="f">מחיר מינימום (₪)<input type="number" id="cfg-minPrice" min="0" step="1"></label></div>
      <div class="row" style="margin-top:10px"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="cfg-allowCustom"> לאפשר ללקוחות לבנות חבילה בעצמם</label></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" data-act="saveCfg">שמירה</button><span class="note" id="cfgNote"></span></div></div></section>`;
  $('#oFilter').value=S.adminFilter;$('#oFilter').onchange=e=>{S.adminFilter=e.target.value;refreshAdmin()};
  fillCfgForm();}
function fillCfgForm(){for(const k of Object.keys(DEFAULT_CFG)){const i=$('#cfg-'+k);if(!i)continue;if(i.type==='checkbox')i.checked=!!S.config[k];else i.value=S.config[k];}
  const tot=DAYS.reduce((a,d)=>a+supply(d.n),0);const n=$('#cfgNote');if(n)n.textContent=`מלאי עונתי למכירה: ${fmtN(tot)} חשיפות · שווי מלא לפי מחיר היעד: ${fmtS(tot*S.config.cpm/1000)}`;}
function planFormHtml(p){p=p||{name:'',desc:'',days:7,impressions:2000,price:'',exclusive:false,active:true};
  return `<div class="panel" style="margin-bottom:12px"><h3 style="margin-bottom:8px">${S.editPlan==='new'?'תכנית חדשה':'עריכת תכנית'}</h3><div class="row">
    <label class="f" style="flex:2 1 220px">שם<input id="pName" value="${esc(p.name)}"></label>
    <label class="f">לילות (חלון)<input type="number" id="pDays" min="1" max="49" value="${p.days}"></label>
    <label class="f">עד חשיפות<input type="number" id="pImp" min="100" step="100" value="${p.impressions}"></label>
    <label class="f">מחיר (₪)<input type="number" id="pPrice" min="0" value="${p.price}"></label></div>
    <div class="row" style="margin-top:8px"><label class="f" style="flex:1 1 100%">תיאור קצר ללקוח<input id="pDesc" value="${esc(p.desc||'')}"></label></div>
    <div class="row" style="margin-top:8px"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pExcl" ${p.exclusive?'checked':''}> חסות בלעדית (כותרת הלילה, אחת ללילה)</label></div>
    <p class="note" id="pHint"></p>
    <div class="row"><button class="btn small" data-act="suggestPrice">מחיר מוצע לפי הסימולציה</button><button class="btn primary" data-act="savePlan">שמירה</button><button class="btn" data-act="closePlan">ביטול</button></div></div>`;}
function planHint(){const d=+$('#pDays').value||1,i=+$('#pImp').value||0,pr=+$('#pPrice').value||0,ex=$('#pExcl').checked;
  const supAvg=DAYS.reduce((a,x)=>a+supply(x.n),0)/42;
  $('#pHint').textContent=ex?`חסות בלעדית: כ־${fmtN(supAvg*d)} חשיפות בכותרת.`:`מחיר לאלף חשיפות: ${i?fmtS(pr/i*1000):'—'} · צורך כ־${Math.round(i/d/supAvg*100)}% מהמלאי הממוצע של לילה · מחיר מוצע: ${fmtS(suggestedPrice(i,d,false))}`;}
function refreshAdmin(){
  if(!$('#kpis'))return;const all=allOrders();const real=all.filter(o=>!o.sim),sim=all.filter(o=>o.sim);
  const paid=all.filter(o=>o.status==='active'||o.status==='done'),pend=all.filter(o=>o.status==='pending');
  const sum=(a,f)=>a.reduce((x,o)=>x+(f(o)||0),0);const tot=DAYS.reduce((a,d)=>a+supply(d.n),0);const sold=sum(all.filter(o=>LIVE.includes(o.status)&&!o.exclusive),o=>o.impressions);
  const shown=sum(all,o=>o.shown),prayed=sum(all,o=>o.prayed);
  const k=[['משתמשים רשומים',fmtN(S.members.length),''],['הזמנות',fmtN(all.length),`${fmtN(real.length)} אמיתיות · ${fmtN(sim.length)} פיקטיביות`],
    ['הכנסות מאושרות',fmtS(sum(paid,o=>o.price)),`${fmtN(paid.length)} הזמנות`],['ממתין לתשלום',fmtS(sum(pend,o=>o.price)),`${fmtN(pend.length)} הזמנות`],
    ['מלאי שנמכר',Math.round(sold/Math.max(1,tot)*100)+'%',`${fmtN(sold)} מתוך ${fmtN(tot)}`],['חשיפות שנמסרו',fmtN(shown),''],
    ['הזכירו בתפילה',fmtN(prayed),shown?(prayed/shown*100).toFixed(1)+'% מהחשיפות':''],['תכניות פעילות',fmtN(S.plans.filter(p=>p.active).length),`מתוך ${S.plans.length}`]];
  $('#kpis').innerHTML=k.map(x=>`<div class="kpi"><div class="l">${x[0]}</div><div class="v">${x[1]}</div><div class="s">${x[2]}</div></div>`).join('');
  // util chart
  const used=usedMap(),W=760,H=170,pl=34,pb=24,bw=(W-pl-6)/49;let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="תפוסת מלאי לפי לילה"><g>`;
  [0,50,100].forEach(v=>{const y=8+(H-pb-8)*(1-v/100);svg+=`<line class="axis" x1="${pl}" x2="${W}" y1="${y}" y2="${y}" stroke-dasharray="${v?'3 3':''}"/><text x="${pl-6}" y="${y+4}" text-anchor="end">${v}%</text>`;});
  for(let n=1;n<=49;n++){const s=supply(n);const x=W-6-(n)*bw;const u=s?Math.min(1,(used[n]||0)/s):0;const hh=(H-pb-8)*u;
    const col=!s?'var(--hatch)':u>=.9?'var(--bad)':u>=.6?'var(--warn)':'var(--ok)';
    svg+=s?`<rect x="${x+1}" y="${H-pb-hh}" width="${bw-2}" height="${Math.max(hh,1)}" fill="${col}" rx="1"><title>ליל ${gem(n)}: ${Math.round(u*100)}% (${fmtN(used[n]||0)}/${fmtN(s)})</title></rect>`:`<rect x="${x+1}" y="${8}" width="${bw-2}" height="${H-pb-8}" fill="var(--hatch)" opacity=".5"><title>ליל ${gem(n)}: ${DAYS[n-1].blocked}</title></rect>`;
    if(n%7===1)svg+=`<text x="${x+bw/2}" y="${H-6}" text-anchor="middle">${gem(n)}</text>`;}
  $('#utilChart').innerHTML=svg+'</g></svg>';
  // plans table
  const pf=$('#planForm');if(S.editPlan&&!pf.dataset.open){pf.dataset.open=1;pf.innerHTML=planFormHtml(S.editPlan==='new'?null:S.plans.find(p=>p.id===S.editPlan));
      ['pDays','pImp','pPrice','pExcl'].forEach(id=>$('#'+id).addEventListener('input',planHint));planHint();}
  else if(!S.editPlan){pf.dataset.open='';pf.innerHTML='';}
  const sold4=id=>all.filter(o=>o.planId===id&&o.status!=='cancelled').length;
  const plans=S.plans.slice().sort((a,b)=>(a.order||0)-(b.order||0));
  $('#plansTbl').innerHTML=plans.length?`<table><thead><tr><th>תכנית</th><th>לילות</th><th>עד חשיפות</th><th>מחיר</th><th>לאלף</th><th>נמכרו</th><th>מצב</th><th></th></tr></thead><tbody>${plans.map(p=>`<tr>
    <td>${esc(p.name)}${p.exclusive?' <span class="tag gold">בלעדי</span>':''}</td><td class="num">${p.days}</td><td class="num">${p.exclusive?'—':fmtN(p.impressions)}</td><td class="num">${fmtS(p.price)}</td>
    <td class="num">${p.exclusive||!p.impressions?'—':fmtS(p.price/p.impressions*1000)}</td><td class="num">${sold4(p.id)}</td>
    <td><span class="tag ${p.active?'ok':'bad'}">${p.active?'פעילה':'מושהית'}</span></td>
    <td><button class="btn small" data-act="togglePlan" data-id="${p.id}">${p.active?'הפסק':'הפעל'}</button> <button class="btn small" data-act="editPlan" data-id="${p.id}">עריכה</button></td></tr>`).join('')}</tbody></table>`
    :`<div class="empty">אין עדיין תכניות. <button class="btn small primary" data-act="seedPlans">טען חבילות מומלצות</button></div>`;
  // orders table
  const f=S.adminFilter;const list=all.filter(o=>f==='all'||(f==='real'&&!o.sim)||(f==='sim'&&o.sim)||(f==='pending'&&o.status==='pending')).slice(0,200);
  $('#ordersTbl').innerHTML=list.length?`<table><thead><tr><th>הקדשה</th><th>תכנית</th><th>טווח</th><th>חשיפות</th><th>תפילות</th><th>מחיר</th><th>מצב</th><th>פעולה</th></tr></thead><tbody>${list.map(o=>{
    const ds=Object.keys(o.alloc||{}).map(Number).sort((a,b)=>a-b);const st=STATUS[o.status]||['',''];
    return `<tr><td class="wrap-cell">${esc(o.purpose)} ${esc(o.name)}${o.sim?' <span class="tag">פיקטיבי</span>':''}</td><td>${esc(o.planName)}</td>
    <td>${ds.length?gem(ds[0])+(ds.length>1?'–'+gem(ds[ds.length-1]):''):''}</td><td class="num">${fmtN(o.shown)} / ${fmtN(o.impressions)}</td><td class="num">${fmtN(o.prayed)}</td><td class="num">${fmtS(o.price)}</td>
    <td><span class="tag ${st[1]}">${st[0]}</span></td><td>${o.status==='pending'?`<button class="btn small primary" data-act="setStatus" data-id="${o.id}" data-s="active">אשר תשלום</button> `:''}
    ${o.status==='active'?`<button class="btn small" data-act="setStatus" data-id="${o.id}" data-s="paused">השהה</button> `:''}
    ${o.status==='paused'?`<button class="btn small" data-act="setStatus" data-id="${o.id}" data-s="active">חדש</button> `:''}
    ${LIVE.includes(o.status)?`<button class="btn small danger" data-act="setStatus" data-id="${o.id}" data-s="cancelled">בטל</button>`:''}</td></tr>`}).join('')}</tbody></table>`:'<div class="empty">אין הזמנות בסינון הזה.</div>';
  // members
  $('#membersTbl').innerHTML=S.members.length?`<table><thead><tr><th>שם</th><th>טלפון</th><th>אימייל</th><th>הזמנות</th><th>נרשם</th></tr></thead><tbody>${S.members.map(m=>`<tr><td>${esc(m.name)}</td><td dir="ltr">${esc(m.phone)}</td><td dir="ltr">${esc(m.email)}</td><td class="num">${S.orders.filter(o=>o.uid===m.id).length}</td><td>${m.created?new Date(m.created).toLocaleDateString('he-IL'):''}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">עדיין אין משתמשים רשומים.</div>';
  $('#fakeConfirm').innerHTML=S.confirm==='delFake'?`<div class="confirm-row">למחוק ${fmtN(sim.length)} הזמנות פיקטיביות? <button class="btn small danger" data-act="delFake">מחק</button><button class="btn small" data-act="noConfirm">ביטול</button></div>`:'';}

/* ===================== PROFIT SIM TAB ===================== */
const SIMF=[['users','משתמשים פעילים בעונה',500,50000,500],['sell','אחוז המלאי שנמכר',5,100,5],['cpm','מחיר ממוצע לאלף חשיפות (₪)',10,120,1],['cpi','עלות גיוס משתמש (₪)',0,15,0.5],
  ['excl','אחוז הלילות שנמכרת בהם חסות בלעדית',0,100,5],['exclPrice','מחיר חסות בלעדית ללילה (₪)',0,1500,10],['fixed','עלויות קבועות לעונה (₪)',0,20000,100],['avgOrder','סכום הזמנה ממוצע (₪)',18,1000,1]];
function buildSim(){$('#main').innerHTML=`<section class="block"><h2>סימולציית רווח לעונה</h2>
  <p class="sub">כל החישובים לעונה אחת של 49 לילות, מתוכם ${DAYS.filter(d=>!d.blocked).length} לילות פעילים. המחירים ללקוח כוללים מע״מ 18% (עוסק מורשה). סליקה מחושבת לפי 1.8% + ₪1 להזמנה.</p>
  <div class="split"><div class="panel" style="display:grid;gap:10px">${SIMF.map(([k,l,mi,ma,st])=>`<label class="f">${l}: <b class="num" id="sv-${k}" style="color:var(--ink)"></b><input type="range" id="s-${k}" min="${mi}" max="${ma}" step="${st}" value="${S.sim[k]}"></label>`).join('')}
    <div class="row"><button class="btn small" data-act="simFromCfg">טען מהגדרות המלאי</button></div></div>
  <div class="panel sim-out" id="simOut"></div></div></section>
  <section class="block"><h2>רווח לפי מספר משתמשים</h2><p class="sub">באותם פרמטרים, משנים רק את מספר המשתמשים. הקו האפור הוא נקודת האיזון.</p><div class="panel chart" id="simChart"></div></section>
  <section class="block"><h2>תרחישים</h2><div class="tbl-wrap" id="simTbl"></div></section>
  <section class="block"><h2>מאיפה המחירים</h2><div class="panel note" style="font-size:15px;color:var(--ink)">
  <p style="margin-top:0">אתרי לימוד יומי גובים על הקדשת יום כ־36$, ויורדים עד 15$ ליום בהקדשה של יותר משבועיים. ישיבות מבקשות כ־150 ₪ על הקדשת שיעור אחד ו־1,000 ₪ על יום לימוד שלם.</p>
  <p>פרסום ממומן בפייסבוק בישראל עלה ב־2025 כ־9$ לאלף חשיפות (כ־33 ₪) בממוצע בתחום הבידור. הקדשה היא מצווה ולא פרסומת, ולכן מחיר יעד של 40 ₪ לאלף חשיפות סביר, וחבילות קטנות נמכרות לפי "חי" (18, 36, 54…).</p>
  <p style="margin-bottom:0">כדאי לגבות דרך האתר ולא דרך רכישה בתוך האפליקציה, כדי לא לשלם עמלת חנות של 15%–30%.</p></div></section>`;
  SIMF.forEach(([k])=>$('#s-'+k).oninput=e=>{S.sim[k]=+e.target.value;refreshSim()});}
function simCalc(p){const c=S.config;let sup=0;for(const d of DAYS){if(d.blocked)continue;let f=1-0.35*(d.n-1)/48;if(d.n===1)f*=1.3;if(d.n===2||d.n===3)f*=1.1;if(d.n===33)f*=1.25;sup+=p.users*f*c.opens*(1+c.more)*c.sellable;}
  const nights=DAYS.filter(d=>!d.blocked).length;const sold=sup*p.sell/100;const revImp=sold*p.cpm/1000;const revEx=nights*p.excl/100*p.exclPrice;const gross=revImp+revEx;
  const net=gross/1.18;const orders=gross/Math.max(18,p.avgOrder);const clearing=gross*0.018+orders;const mkt=p.users*p.cpi;const profit=net-clearing-mkt-p.fixed;
  return{sup,sold,revImp,revEx,gross,net,orders,clearing,mkt,profit,vat:gross-net};}
function refreshSim(){if(!$('#simOut'))return;SIMF.forEach(([k])=>{const v=S.sim[k];$('#sv-'+k).textContent=['sell','excl'].includes(k)?v+'%':['users'].includes(k)?fmtN(v):['cpi'].includes(k)?'₪'+v:k==='cpm'||k==='exclPrice'||k==='fixed'||k==='avgOrder'?fmtS(v):v});
  const r=simCalc(S.sim);
  $('#simOut').innerHTML=`<div class="note">רווח נקי משוער לעונה</div><div class="big num ${r.profit>=0?'pos':'neg'}">${fmtS(r.profit)}</div>
   <div class="summary" style="margin-top:10px">
   <div class="kv"><span>מלאי למכירה</span><span class="num">${fmtN(r.sup)} חשיפות</span></div>
   <div class="kv"><span>נמכר</span><span class="num">${fmtN(r.sold)} חשיפות</span></div>
   <div class="kv"><span>הכנסה מחבילות</span><span class="num">${fmtS(r.revImp)}</span></div>
   <div class="kv"><span>הכנסה מחסויות בלעדיות</span><span class="num">${fmtS(r.revEx)}</span></div>
   <div class="kv"><span>סה״כ כולל מע״מ</span><span class="num">${fmtS(r.gross)}</span></div>
   <div class="kv"><span>מע״מ</span><span class="num">−${fmtS(r.vat)}</span></div>
   <div class="kv"><span>סליקה (כ־${fmtN(r.orders)} הזמנות)</span><span class="num">−${fmtS(r.clearing)}</span></div>
   <div class="kv"><span>גיוס משתמשים</span><span class="num">−${fmtS(r.mkt)}</span></div>
   <div class="kv"><span>עלויות קבועות</span><span class="num">−${fmtS(S.sim.fixed)}</span></div></div>
   <p class="note">לא כולל מס הכנסה וביטוח לאומי, שתלויים במצבך האישי.</p>`;
  // chart profit vs users
  const xs=[];for(let u=500;u<=50000;u+=500)xs.push(u);const ys=xs.map(u=>simCalc({...S.sim,users:u}).profit);
  const W=760,H=240,pl=64,pr=12,pt=12,pb=28;const mn=Math.min(0,...ys),mx=Math.max(1,...ys);
  const X=u=>W-pr-(u-500)/(49500)*(W-pl-pr),Y=v=>pt+(mx-v)/(mx-mn)*(H-pt-pb);
  let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="רווח לפי משתמשים">`;
  const step=niceStep((mx-mn)/4);for(let v=Math.ceil(mn/step)*step;v<=mx;v+=step)svg+=`<line class="axis" x1="${pl}" x2="${W-pr}" y1="${Y(v)}" y2="${Y(v)}" ${v?'stroke-dasharray="3 3"':'stroke-width="2"'}/><text x="${pl-6}" y="${Y(v)+4}" text-anchor="end">${fmtS(v)}</text>`;
  [1000,10000,20000,30000,40000,50000].forEach(u=>svg+=`<text x="${X(u)}" y="${H-8}" text-anchor="middle">${fmtN(u)}</text>`);
  const pts=xs.map((u,i)=>`${X(u).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(' ');
  svg+=`<polygon points="${X(500)},${Y(0)} ${pts} ${X(50000)},${Y(0)}" fill="var(--gold-soft)" opacity=".7"/><polyline points="${pts}" fill="none" stroke="var(--gold)" stroke-width="2.5"/>`;
  const cx=X(S.sim.users),cy=Y(simCalc(S.sim).profit);svg+=`<circle cx="${cx}" cy="${cy}" r="5" fill="var(--accent)"/><text x="${cx}" y="${cy-10}" text-anchor="middle" style="fill:var(--ink);font-weight:700">${fmtS(simCalc(S.sim).profit)}</text>`;
  $('#simChart').innerHTML=svg+'</svg>';
  const sc=[1000,3000,5000,10000,25000,50000];
  $('#simTbl').innerHTML=`<table><thead><tr><th>משתמשים</th><th>מלאי</th><th>הכנסה כולל מע״מ</th><th>אחרי מע״מ</th><th>עלויות</th><th>רווח</th><th>לכל משתמש</th></tr></thead><tbody>${sc.map(u=>{const r=simCalc({...S.sim,users:u});
    return `<tr><td class="num">${fmtN(u)}</td><td class="num">${fmtN(r.sup)}</td><td class="num">${fmtS(r.gross)}</td><td class="num">${fmtS(r.net)}</td><td class="num">${fmtS(r.clearing+r.mkt+S.sim.fixed)}</td><td class="num ${r.profit>=0?'pos':'neg'}"><b>${fmtS(r.profit)}</b></td><td class="num">₪${(r.profit/u).toFixed(2)}</td></tr>`}).join('')}</tbody></table>`;}
function niceStep(x){const p=Math.pow(10,Math.floor(Math.log10(Math.max(1,x))));const m=x/p;return (m<=1?1:m<=2?2:m<=5?5:10)*p;}

/* ===================== ACTIONS ===================== */
document.addEventListener('input',e=>{const k=e.target.dataset&&e.target.dataset.reg;if(k)S.reg[k]=e.target.value;});
const RECOMMENDED=[
  {name:'נר קטן',desc:'הקדשה ללילה אחד או שניים',days:2,impressions:400,price:18,exclusive:false,order:1},
  {name:'לילה אחד',desc:'ההקדשה מוצגת לאורך כל ליל הספירה',days:1,impressions:1000,price:36,exclusive:false,order:2},
  {name:'שבוע שלם',desc:'שבעה לילות, מידה אחת מהספירות',days:7,impressions:3000,price:118,exclusive:false,order:3},
  {name:'שבועיים',desc:'עד ארבעה עשר לילות',days:14,impressions:6000,price:216,exclusive:false,order:4},
  {name:'כל ימי הספירה',desc:'מליל א׳ ועד ליל מ״ט',days:49,impressions:12000,price:360,exclusive:false,order:5},
  {name:'חסות הלילה',desc:'"הספירה הלילה מוקדשת…" בראש המסך, הקדשה אחת בלבד ללילה',days:1,impressions:0,price:250,exclusive:true,order:6}];
const path=(...s)=>S.P.path(...s);
async function wr(fn,okMsg){try{await fn();if(okMsg)toast(okMsg);return true}catch(e){console.error(e);
  toast(/permission/i.test(e?.code||e?.message||'')?'אין הרשאה לפעולה הזו':'השמירה נכשלה. בדקו את החיבור ונסו שוב');return false}}
/* slots/<season>-<night>: what the app shows that night. Rebuilt from the approved (active) orders. */
function slotOps(nights,orders){const ops=[];for(const n of nights){
  const items=orders.filter(o=>o.status==='active'&&o.season===SEASON.hy&&(o.alloc||{})[n]).map(o=>({orderId:o.id,purpose:o.purpose,name:o.name,from:o.from||'',weight:o.alloc[n],exclusive:!!o.exclusive}));
  ops.push({op:'set',path:path('slots',SEASON.hy+'-'+n),data:{season:SEASON.hy,night:n,items,updated:S.P.now()}});}return ops;}
const nightsOf=os=>[...new Set(os.flatMap(o=>Object.keys(o.alloc||{}).map(Number)))];
async function setOrders(changes){ // changes: [{id,patch}|{id,del:true}|{id,create:data}] → one batch incl. the affected slots
  const by=Object.fromEntries(S.orders.map(o=>[o.id,o]));const ops=[];const touched=[];
  for(const c of changes){const cur=by[c.id];
    if(c.del){if(cur){touched.push(cur);delete by[c.id]}ops.push({op:'delete',path:path('orders',c.id)});}
    else if(c.create){by[c.id]={id:c.id,...c.create};touched.push(by[c.id]);ops.push({op:'set',path:path('orders',c.id),data:c.create});}
    else{by[c.id]={...cur,...c.patch};touched.push(by[c.id]);ops.push({op:'update',path:path('orders',c.id),data:c.patch});}}
  ops.push(...slotOps(nightsOf(touched),Object.values(by)));await S.P.db.batch(ops);}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(a==='signIn'){try{await S.P.auth.signInGoogle()}catch(err){console.error(err);toast('ההתחברות לא הושלמה')}return}
  if(a==='signOut'){await S.P.auth.signOut();location.hash='#order';return}
  if(a==='plan'){S.sel.planId=b.dataset.id;const p=curPlan();if(p&&S.sel.start){const t=tryAlloc(S.sel.start,p.days,p.impressions,p.exclusive);if(!t.ok)S.sel.start=null;}refreshOrder();return}
  if(a==='day'){const p=curPlan();if(!p){$('#calErr').textContent='קודם בחרו חבילה (שלב א).';return}const n=+b.dataset.n;const t=tryAlloc(n,p.days,p.impressions,p.exclusive);
    $('#calErr').textContent=t.ok?'':t.why;S.sel.start=n;refreshCalendar();refreshSummary();return}
  if(a==='best'){const p=curPlan();if(!p){$('#calErr').textContent='קודם בחרו חבילה (שלב א).';return}const s=bestStart(p.days,p.impressions,p.exclusive);
    if(!s){$('#calErr').textContent='לא נמצא טווח פנוי לחבילה הזו.';return}$('#calErr').textContent='';S.sel.start=s;refreshCalendar();refreshSummary();return}
  if(a==='register'){const name=$('#rName').value.trim(),phone=$('#rPhone').value.trim(),email=$('#rEmail').value.trim();
    if(name.length<2||!/^[0-9+\-\s]{9,15}$/.test(phone)){$('#rErr').textContent='צריך שם וטלפון תקין';return}
    await wr(()=>S.P.db.set('users/'+S.uid,{name,phone,email,created:Date.now(),apps:{[S.P.appId]:Date.now()}}),'נרשמת בהצלחה');return}
  if(a==='placeOrder'){const p=curPlan();const t=tryAlloc(S.sel.start,p.days,p.impressions,p.exclusive);if(!t.ok){toast(t.why);return}
    b.disabled=true;const alloc={};for(const[k,v]of Object.entries(t.alloc))alloc[k]=v;
    const ok=await wr(()=>S.P.db.add(path('orders'),{uid:S.uid,planId:p.id,planName:p.name,purpose:S.sel.purpose,name:S.sel.name.trim(),from:S.sel.from.trim(),
      season:SEASON.hy,start:S.sel.start,days:p.days,impressions:t.imp,alloc,price:p.price,exclusive:!!p.exclusive,status:'pending',created:Date.now()}),'ההזמנה נקלטה');
    if(ok){S.sel.name='';S.sel.start=null;location.hash='#mine'}else b.disabled=false;return}
  if(a==='askCancel'){S.confirm=b.dataset.id;refreshMine();return}
  if(a==='noConfirm'){S.confirm=null;refresh();return}
  if(a==='cancelMine'){S.confirm=null;await wr(()=>S.P.db.update(path('orders',b.dataset.id),{status:'cancelled'}),'ההזמנה בוטלה');return}
  if(!S.isAdmin)return;
  if(a==='newPlan'){S.editPlan='new';$('#planForm').dataset.open='';refreshAdmin();return}
  if(a==='editPlan'){S.editPlan=b.dataset.id;$('#planForm').dataset.open='';refreshAdmin();return}
  if(a==='closePlan'){S.editPlan=null;refreshAdmin();return}
  if(a==='suggestPrice'){$('#pPrice').value=suggestedPrice(+$('#pImp').value,+$('#pDays').value,$('#pExcl').checked);planHint();return}
  if(a==='savePlan'){const d={name:$('#pName').value.trim(),desc:$('#pDesc').value.trim(),days:Math.max(1,Math.min(49,+$('#pDays').value||1)),impressions:+$('#pImp').value||0,price:+$('#pPrice').value||0,exclusive:$('#pExcl').checked};
    if(!d.name||!d.price){toast('חסר שם או מחיר');return}
    if(S.editPlan==='new'){d.active=true;d.order=S.plans.length+1;await wr(()=>S.P.db.add(path('plans'),d),'התכנית נוספה')}
    else{await wr(()=>S.P.db.update(path('plans',S.editPlan),d),'התכנית עודכנה')}S.editPlan=null;refreshAdmin();return}
  if(a==='togglePlan'){const p=S.plans.find(x=>x.id===b.dataset.id);await wr(()=>S.P.db.update(path('plans',p.id),{active:!p.active}),p.active?'התכנית הופסקה':'התכנית הופעלה');return}
  if(a==='seedPlans'){b.disabled=true;await wr(()=>S.P.db.batch([
      ...RECOMMENDED.map((p,i)=>({op:'set',path:path('plans','p'+(i+1)),data:{...p,active:true}})),
      ...(S.configSaved?[]:[{op:'set',path:path('config','inventory'),data:{...DEFAULT_CFG}}])]),'נטענו 6 חבילות');return}
  if(a==='setStatus'){await wr(()=>setOrders([{id:b.dataset.id,patch:{status:b.dataset.s}}]),'עודכן');return}
  if(a==='saveCfg'){const c={};for(const k of Object.keys(DEFAULT_CFG)){const i=$('#cfg-'+k);c[k]=i.type==='checkbox'?i.checked:(+i.value||DEFAULT_CFG[k]);}
    await wr(()=>S.P.db.set(path('config','inventory'),c),'ההגדרות נשמרו');return}
  if(a==='fake'){b.disabled=true;await makeFake(+b.dataset.k);b.disabled=false;return}
  if(a==='fakeStats'){b.disabled=true;await fillFakeStats();b.disabled=false;return}
  if(a==='askDelFake'){S.confirm='delFake';refreshAdmin();return}
  if(a==='delFake'){S.confirm=null;const sim=S.orders.filter(o=>o.sim);
    await wr(()=>setOrders(sim.map(o=>({id:o.id,del:true}))),'הפיקטיביות נמחקו');return}
  if(a==='simFromCfg'){S.sim.users=S.config.users;S.sim.cpm=S.config.cpm;buildSim();refreshSim();return}
});
const FN=['יוסף','משה','אברהם','יצחק','יעקב','דוד','שמואל','אהרן','מרדכי','חיים','שלמה','מאיר','נחום','רפאל','אליהו','בנימין'];
const MN=['שרה','רבקה','רחל','לאה','מרים','חנה','אסתר','יהודית','שושנה','מזל','סעדה','פרחה'];
async function makeFake(k){const plans=S.plans.filter(p=>p.active);if(!plans.length){toast('צריך קודם תכניות פעילות');return}
  const pick=a=>a[Math.floor(Math.random()*a.length)];const real=S.orders;const made=[];
  for(let i=0;i<k*3&&made.length<k;i++){const w=plans.map(p=>p.exclusive?1:p.price<=40?4:p.price<=150?3:1.5);let r=Math.random()*w.reduce((a,b)=>a+b,0),p=plans[0];for(let j=0;j<plans.length;j++){r-=w[j];if(r<=0){p=plans[j];break}}
    const start=1+Math.floor(Math.random()*Math.max(1,49-p.days+1));
    S.orders=real.concat(made);const t=tryAlloc(start,p.days,p.impressions,p.exclusive);S.orders=real;if(!t.ok)continue;
    made.push({id:'sim-'+S.P.db.newId(path('orders')),uid:'sim',sim:true,planId:p.id,planName:p.name,purpose:pick(PURPOSES.slice(0,3)),name:pick(FN)+' בן '+pick(MN),from:'',season:SEASON.hy,start,days:p.days,
      impressions:t.imp,alloc:t.alloc,price:p.price,exclusive:!!p.exclusive,status:Math.random()<.85?'active':'pending',created:Date.now()-Math.floor(Math.random()*30*DAY)});}
  if(!made.length){toast('אין מלאי פנוי להזמנות נוספות');return}
  await wr(()=>setOrders(made.map(({id,...d})=>({id,create:d}))),`נוספו ${made.length} הזמנות פיקטיביות`);}
/* Fake counters go to shard 0 of each night, only under the fake orders' ids (real counters are untouched). */
async function fillFakeStats(){const per={};
  for(const o of S.orders.filter(o=>o.sim&&o.status==='active'&&o.season===SEASON.hy))for(const[n,imp]of Object.entries(o.alloc||{})){
    const d=per[n]=per[n]||{season:SEASON.hy,night:+n,shown:{},prayed:{},updated:S.P.now()};const sh=Math.round(imp*(0.55+Math.random()*0.45));
    d.shown[o.id]=sh;d.prayed[o.id]=Math.round(sh*(0.03+Math.random()*0.07));}
  if(!Object.keys(per).length){toast('אין הזמנות פיקטיביות פעילות');return}
  await wr(()=>S.P.db.batch(Object.entries(per).map(([n,d])=>({op:'set',merge:true,path:path('stats',`${SEASON.hy}-${n}-0`),data:d}))),'החשיפות והתפילות עודכנו');loadCounts();}
let countsT=0;async function loadCounts(){if(!S.P)return;try{S.counts=await S.P.sponsor.seasonCounts(SEASON.hy);refresh()}catch(e){console.warn(e)}}

/* ===================== BOOT ===================== */
render(true);
(async()=>{
  const cfg=window.PLATFORM_CONFIG||{};const qs=new URLSearchParams(location.search);
  const memory=qs.get('backend')==='memory'||!(cfg.firebase&&cfg.firebase.apiKey);
  try{S.P=await AppsPlatform.init({appId:qs.get('app')||cfg.appId||'omer',firebase:cfg.firebase,backend:memory?'memory':'firebase'});}catch(e){console.error(e);S.P=null}
  if(!S.P){S.ready.plans=S.ready.orders=true;S.member=null;render(true);return}
  if(S.P.kind==='memory')$('#banner').innerHTML='<div class="confirm-row" style="margin-bottom:12px">מצב בדיקה: הנתונים נשמרים רק בדפדפן הזה. כדי לעבוד מול השרת צריך למלא את config.js.</div>';
  const db=S.P.db;let unsub=[];
  const timer=setTimeout(()=>{if(!S.ready.plans){S.ready.plans=true;refresh();toast('הנתונים עוד לא נטענו, ייתכן שאין חיבור')}},10000);
  db.watchList(path('plans'),[],l=>{S.plans=l;S.ready.plans=true;clearTimeout(timer);refresh()},()=>{S.ready.plans=true;refresh()});
  db.watch(path('config','inventory'),d=>{S.configSaved=!!d;S.config={...DEFAULT_CFG,...(d||{})};refresh();if(route()==='admin'&&!document.activeElement?.id?.startsWith('cfg-'))fillCfgForm()});
  db.watchList(path('slots'),[['season','==',SEASON.hy]],l=>{S.slots=l;refresh()},()=>{});
  loadCounts();clearInterval(countsT);countsT=setInterval(()=>{if(!document.hidden&&['mine','admin'].includes(route()))loadCounts()},60000);
  S.P.auth.onChange(async u=>{unsub.forEach(f=>f());unsub=[];S.me=u&&!u.anonymous?u:null;S.uid=S.me?.uid||null;S.isAdmin=false;S.orders=[];S.members=[];S.member=S.uid?undefined:null;S.ready.orders=!S.uid;
    if(S.uid){
      unsub.push(db.watch('users/'+S.uid,d=>{S.member=d;renderHeader();refresh()},()=>{S.member=null;refresh()}));
      unsub.push(db.watch('admins/'+S.uid,d=>{const was=S.isAdmin;S.isAdmin=!!(d&&(d.apps||[]).some(x=>x==='*'||x===S.P.appId));if(was===S.isAdmin)return;
        ordersSub&&ordersSub();ordersSub=watchOrders();if(S.isAdmin){unsub.push(db.watchList('users',[],l=>{S.members=l;refresh()},()=>{}))}render(true)},()=>{}));
      let ordersSub=watchOrders();unsub.push(()=>ordersSub&&ordersSub());
    }
    render(true);});
  function watchOrders(){return db.watchList(path('orders'),S.isAdmin?[]:[['uid','==',S.uid]],l=>{S.orders=l;S.ready.orders=true;refresh()},e=>{console.warn(e);S.ready.orders=true;refresh()});}
  window.addEventListener('hashchange',()=>{if(['mine','admin'].includes(route()))loadCounts()});
})();
