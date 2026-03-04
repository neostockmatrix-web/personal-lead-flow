/* ═══════════════════════════════════════════════════════
   KALPAKUBER INTELLIGENCE OS v8 — app.js
   FIXES:
   1. PowerLog (entries) now link to LeadFlow leads by #clientname
   2. switchLFTab now renders the correct sub-panel each time
   3. CRM Dashboard, Portfolio, Referrals, Insights, Analytics all
      render properly when their sub-tab is clicked
   4. Log → LeadFlow auto-link: #clientname in log shows badge
      that navigates straight to that client in LeadFlow
   5. All BI / analytics driven from live data (log + pipeline)
═══════════════════════════════════════════════════════ */

'use strict';

/* ══ STORAGE KEYS ══ */
const PS_KEY      = 'kk_powerlog_v8';
const LF_KEY      = 'kk_leadflow_v8';
const TGT_KEY     = 'kk_targets_v8';
const SIP_KEY     = 'kk_siplog_v8';
const GOALS_KEY   = 'kk_goals_v8';
const REVIEWS_KEY = 'kk_reviews_v8';
const AUDIT_KEY   = 'kk_audit_v8';
const PREF_KEY    = 'kk_prefs_v1';

/* Legacy key migration */
const LEGACY_LF  = ['kk_leads','kk_leads_v2','kk_leadflow','kk_leadflow_v7'];
const LEGACY_TGT = ['kk_targets','kk_targets_v7'];
const LEGACY_SIP = ['kk_siplog','kk_siplog_v7'];

/* ══ STATE ══ */
let entries    = [];
let leads      = [];
let targets    = {};
let sipLog     = [];
let goals      = [];
let reviews    = [];
let auditLog   = [];
let currentMood       = 3;
let bannerOpen        = true;
let biOpen            = false;
let pendingStageMove  = null;
let pendingProdAction = null;
let clientDetailIndex = {};
let personalChart     = null;
let trendChart        = null;
let autoBackupTimer   = null;
let prefs             = { backupEnabled:false, backupIntervalMin:15, backupFolderConnected:false, lastBackupAt:null, darkMode:false, cloudSyncEnabled:false, cloudSyncUrl:'', lastCloudSyncAt:null };
let editingEntryId    = null;

/* ══ CONSTANTS ══ */
const STAGES = ['col-prospect','col-contacted','col-proposal','col-potential','col-won','col-lost'];
const PROBS  = {'col-prospect':.2,'col-contacted':.4,'col-proposal':.7,'col-potential':.55,'col-won':1,'col-lost':0};
const LABELS = {'col-prospect':'Prospect','col-contacted':'Contacted','col-proposal':'Proposal','col-potential':'Potential','col-won':'Won','col-lost':'Lost'};
const PEMOJI = {'MF-SIP':'📈','MF-Lumpsum':'💰','Life Insurance':'🛡️','Health Insurance':'🏥'};
const SIP_TYPES = {add:'➕ New SIP',top:'⬆️ Top-Up',stop:'➖ Stopped',reduce:'⬇️ Reduced'};

/* ══ UTILS ══ */
const $ = id => document.getElementById(id);
function fmt(n){return Number(n||0).toLocaleString('en-IN');}
function fmtCr(n){if(!n)return'0';if(n>=1e7)return(n/1e7).toFixed(2)+' Cr';if(n>=1e5)return(n/1e5).toFixed(2)+' L';return fmt(n);}
function fmtDate(ts){return new Date(ts).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});}
function daysSince(ts){return Math.floor((Date.now()-(ts||Date.now()))/86400000);}
function daysLeft(d){return Math.max(0,Math.ceil((d-Date.now())/86400000));}
function todayISO(){return new Date().toISOString().split('T')[0];}
function escHtml(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function sanitize(v){return String(v||'').replace(/[<>\u0000-\u001F]/g,'').trim();}
function isValidEmail(v){return !v||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);}
function isValidPhone(v){return !v||/^[0-9]{10,15}$/.test(v.replace(/\D/g,''));}
function safeId(v){return String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'client';}
function getStaleDays(){return{'col-prospect':parseInt(targets.staleProspect)||5,'col-contacted':parseInt(targets.staleContacted)||7,'col-proposal':parseInt(targets.staleProposal)||10,'col-potential':parseInt(targets.stalePotential)||21};}
function genId(){return (window.crypto&&crypto.randomUUID)?crypto.randomUUID():'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);}
function validateLead(lead){
  if(!lead||typeof lead!=='object') return null;
  if(!lead.id) lead.id=genId();
  if(!lead.name) return null;
  lead.stage=STAGES.includes(lead.stage)?lead.stage:'col-prospect';
  lead.products=Array.isArray(lead.products)?lead.products:[];
  lead.history=Array.isArray(lead.history)?lead.history:[];
  lead.createdAt=lead.createdAt||Date.now();
  lead.stageEntryDate=lead.stageEntryDate||lead.createdAt;
  lead.deletedAt=lead.deletedAt||null;
  lead.muted=!!lead.muted;
  if(lead.nextAction){lead.nextFollowUpDate=lead.nextAction;lead.followUpStatus=lead.nextAction<todayISO()?'overdue':'scheduled';}
  else {lead.nextFollowUpDate='';lead.followUpStatus='none';}
  return lead;
}
function validateEntry(entry){
  if(!entry||typeof entry!=='object'||!entry.text) return null;
  if(!entry.id) entry.id=genId();
  entry.type=['Note','Task','Habit'].includes(entry.type)?entry.type:'Note';
  entry.tags=Array.isArray(entry.tags)?entry.tags:[];
  entry.linkedLeadIds=Array.isArray(entry.linkedLeadIds)?entry.linkedLeadIds.filter(Boolean):[];
  entry.linkedLeadId=entry.linkedLeadId||entry.linkedLeadIds[0]||'';
  entry.sourceType=entry.sourceType||'manual-log';
  return entry;
}

function normKey(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function extractClientTags(text){return [...new Set((String(text||'').match(/#([A-Za-z][A-Za-z0-9_-]*)/g)||[]).map(t=>t.slice(1)))];}
function resolveLinkedLeadIds(text,selectedLeadId=''){
  const tags=extractClientTags(text);
  const ids=[];
  const addId=id=>{if(id&&!ids.includes(id)) ids.push(id);};
  tags.forEach(tag=>{
    const nk=normKey(tag);
    const match=leads.find(l=>normKey(l.name)===nk || normKey(l.id)===nk);
    if(match) addId(match.id);
  });
  if(selectedLeadId) addId(selectedLeadId);
  return {tags,ids};
}

function updateLogClientOptions(){
  const sel=$('logClientLink'); if(!sel) return;
  const prev=sel.value;
  const opts=['<option value="">Link client (optional)</option>'];
  [...leads].sort((a,b)=>String(a.name).localeCompare(String(b.name))).forEach(l=>{
    opts.push(`<option value="${escHtml(l.id)}">${escHtml(l.name)} · ${escHtml(l.id)}</option>`);
  });
  sel.innerHTML=opts.join('');
  if(prev && [...sel.options].some(o=>o.value===prev)) sel.value=prev;
}

function addAudit(msg){
  auditLog.unshift({ts:Date.now(),msg});
  if(auditLog.length>100) auditLog.splice(100);
  localStorage.setItem(AUDIT_KEY,JSON.stringify(auditLog));
}

/* ══ LOAD / SAVE ══ */
function loadAll(){
  // Migrate legacy data on first load
  try{ entries = JSON.parse(localStorage.getItem(PS_KEY)||'[]'); }catch(e){entries=[];}
  try{
    let raw = localStorage.getItem(LF_KEY);
    if(!raw) raw = LEGACY_LF.map(k=>localStorage.getItem(k)).find(Boolean)||'[]';
    leads = JSON.parse(raw);
  }catch(e){leads=[];}
  try{
    let raw = localStorage.getItem(TGT_KEY);
    if(!raw) raw = LEGACY_TGT.map(k=>localStorage.getItem(k)).find(Boolean)||'{}';
    targets = JSON.parse(raw);
  }catch(e){targets={};}
  try{
    let raw = localStorage.getItem(SIP_KEY);
    if(!raw) raw = LEGACY_SIP.map(k=>localStorage.getItem(k)).find(Boolean)||'[]';
    sipLog = JSON.parse(raw);
  }catch(e){sipLog=[];}
  try{ goals    = JSON.parse(localStorage.getItem(GOALS_KEY)||'[]'); }catch(e){goals=[];}
  try{ reviews  = JSON.parse(localStorage.getItem(REVIEWS_KEY)||'[]'); }catch(e){reviews=[];}
  try{ auditLog = JSON.parse(localStorage.getItem(AUDIT_KEY)||'[]'); }catch(e){auditLog=[];}
  try{ prefs = {...prefs,...JSON.parse(localStorage.getItem(PREF_KEY)||'{}')}; }catch(e){}
  if(!Array.isArray(entries)) entries=[];
  if(!Array.isArray(leads))   leads=[];
  entries=entries.map(validateEntry).filter(Boolean);
  leads=leads.map(validateLead).filter(Boolean);
  if(!Array.isArray(sipLog))  sipLog=[];
  if(!Array.isArray(goals))   goals=[];
  if(!Array.isArray(reviews)) reviews=[];
}

function applyTheme(){document.body.setAttribute('data-theme',prefs.darkMode?'dark':'light');const t=$('darkModeToggle');if(t)t.checked=!!prefs.darkMode;}

function saveAll(){
  localStorage.setItem(PS_KEY,     JSON.stringify(entries));
  localStorage.setItem(LF_KEY,     JSON.stringify(leads));
  localStorage.setItem(TGT_KEY,    JSON.stringify(targets));
  localStorage.setItem(SIP_KEY,    JSON.stringify(sipLog));
  localStorage.setItem(GOALS_KEY,  JSON.stringify(goals));
  localStorage.setItem(REVIEWS_KEY,JSON.stringify(reviews));
  localStorage.setItem(PREF_KEY,   JSON.stringify(prefs));
  const t = new Date().toLocaleTimeString();
  const el1=$('lastSyncTime');  if(el1) el1.textContent='Saved '+t;
  const el2=$('lastSyncTime2'); if(el2) el2.textContent=t;
  queueBackup();
}

function getUnifiedPayload(){
  return {entries,leads,targets,sipLog,goals,reviews,auditLog,exportedAt:new Date().toISOString()};
}

function queueBackup(){
  if(!prefs.backupEnabled || !window.showDirectoryPicker) return;
  if(queueBackup._t) clearTimeout(queueBackup._t);
  queueBackup._t=setTimeout(runManualBackup,800);
}

async function connectBackupFolder(){
  if(!window.showDirectoryPicker){alert('Folder backup is not supported in this browser. Use Export JSON in Settings.');return;}
  try{
    const dir=await window.showDirectoryPicker();
    window.__kkBackupDirHandle=dir;
    prefs.backupFolderConnected=true;
    addAudit('Backup folder connected');
    saveAll();
    updateBackupUI();
  }catch(err){
    if(err?.name!=='AbortError') alert('Unable to connect folder: '+err.message);
  }
}

async function syncCloudBackup(payload){
  if(!prefs.cloudSyncEnabled||!prefs.cloudSyncUrl) return;
  try{
    await fetch(prefs.cloudSyncUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    prefs.lastCloudSyncAt=Date.now();
  }catch(e){ addAudit('Cloud sync failed'); }
}

async function runManualBackup(){
  if(!prefs.backupEnabled && !window.__kkBackupDirHandle) return;
  if(!window.__kkBackupDirHandle){ updateBackupUI('Connect folder to start backups.'); return; }
  try{
    const filename=`KalpaKuber_AutoBackup_${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    const fileHandle=await window.__kkBackupDirHandle.getFileHandle(filename,{create:true});
    const writable=await fileHandle.createWritable();
    await writable.write(JSON.stringify(getUnifiedPayload(),null,2));
    await writable.close();
    prefs.lastBackupAt=Date.now();
    await syncCloudBackup(getUnifiedPayload());
    addAudit('Backup snapshot created');
    saveAll();
    updateBackupUI();
  }catch(err){
    updateBackupUI('Backup failed: permission or folder access issue.');
  }
}

function toggleAutoBackup(enabled){
  prefs.backupEnabled=!!enabled;
  scheduleAutoBackup();
  saveAll();
  updateBackupUI();
}

function updateBackupInterval(v){
  const n=Math.max(2,Math.min(120,parseInt(v,10)||15));
  prefs.backupIntervalMin=n;
  const el=$('backupInterval'); if(el) el.value=n;
  scheduleAutoBackup();
  saveAll();
}

function toggleCloudSync(enabled){prefs.cloudSyncEnabled=!!enabled;saveAll();updateBackupUI();}
function setCloudSyncUrl(v){prefs.cloudSyncUrl=sanitize(v);saveAll();}
function toggleDarkMode(enabled){prefs.darkMode=!!enabled;applyTheme();saveAll();}

function scheduleAutoBackup(){
  if(autoBackupTimer) clearInterval(autoBackupTimer);
  if(prefs.backupEnabled) autoBackupTimer=setInterval(runManualBackup,prefs.backupIntervalMin*60000);
}

function updateBackupUI(msg){
  const status=$('backup-status');
  const enabled=$('backupEnabled');
  const interval=$('backupInterval');
  if(enabled) enabled.checked=!!prefs.backupEnabled;
  if(interval) interval.value=prefs.backupIntervalMin||15;
  const cse=$('cloudSyncEnabled'); if(cse) cse.checked=!!prefs.cloudSyncEnabled;
  const csu=$('cloudSyncUrl'); if(csu) csu.value=prefs.cloudSyncUrl||'';
  if(!status) return;
  if(msg){status.textContent=msg;return;}
  const connected=window.__kkBackupDirHandle||prefs.backupFolderConnected;
  const last=prefs.lastBackupAt?new Date(prefs.lastBackupAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'Never';
  status.textContent=`Status: ${connected?'Folder connected':'No folder connected'} · Last backup: ${last}`;
  const bh=$('backup-health'); if(bh){
    const stale=prefs.lastBackupAt?daysSince(prefs.lastBackupAt):999;
    const cloud=prefs.lastCloudSyncAt?`Cloud: ${new Date(prefs.lastCloudSyncAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}`:'Cloud: never';
    bh.textContent=`Backup health: ${stale<=1?'🟢 Healthy':stale<=7?'🟡 Delayed':'🔴 Stale'} · ${cloud}`;
  }
}

/* ══ EXPORT / IMPORT ══ */
function exportUnifiedJSON(){
  const blob=new Blob([JSON.stringify(getUnifiedPayload(),null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`KalpaKuber_Backup_${todayISO()}.json`;
  a.click();URL.revokeObjectURL(url);
  addAudit('Exported unified JSON');
}

function importUnifiedJSON(ev){
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(data.entries  &&Array.isArray(data.entries))  entries=data.entries;
      if(data.leads    &&Array.isArray(data.leads))     leads=data.leads;
      if(data.targets  &&typeof data.targets==='object') targets=data.targets;
      if(data.sipLog   &&Array.isArray(data.sipLog))    sipLog=data.sipLog;
      if(data.goals    &&Array.isArray(data.goals))     goals=data.goals;
      if(data.reviews  &&Array.isArray(data.reviews))   reviews=data.reviews;
      if(Array.isArray(data)) leads=data; // legacy leads-only
      entries=entries.map(validateEntry).filter(Boolean);
      leads=leads.map(validateLead).filter(Boolean);
      saveAll();renderAll();
      addAudit(`Imported — ${entries.length} entries, ${leads.length} leads`);
      alert(`✅ Imported!\nEntries: ${entries.length} | Leads: ${leads.length}`);
    }catch(err){alert('❌ Error importing: '+err.message);}
  };
  reader.readAsText(ev.target.files[0]);
  ev.target.value='';
}

function exportLeadCSV(){
  const headers=['ID','Name','Phone','Email','Referred By','Products','Total Value','Rev Type','Source','Temperature','Stage','Actual Revenue','Next Action','Loss Reason','Total Age (days)','Notes'];
  const rows=leads.map(l=>{
    const prods=(l.products||[]).map(p=>`${p.product}(${p.status}):₹${p.value}${p.sipAmt?' SIP₹'+p.sipAmt+'/mo':''}`).join('|');
    const notes=(l.history||[]).map(h=>`${h.date}: ${h.msg}`).join('|');
    return [l.id,l.name,l.phone,l.email,l.referredBy||'',prods,l.value,l.revType,l.source,l.temp,LABELS[l.stage]||l.stage,l.actualValue||0,l.nextAction||'',l.lossReason||'',daysSince(l.createdAt),notes]
      .map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',');
  });
  const csv=[headers.join(','),...rows].join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download=`KK_Leads_${todayISO()}.csv`;a.click();URL.revokeObjectURL(url);
}

/* ══ TAB SYSTEM ══ */
function switchTab(name){
  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#main-tab-nav .tab-btn').forEach(b=>b.classList.remove('active'));
  const pane=$('tab-'+name); if(pane) pane.classList.add('active');
  const btns=document.querySelectorAll('#main-tab-nav .tab-btn');
  btns.forEach(b=>{if(b.getAttribute('onclick')&&b.getAttribute('onclick').includes("'"+name+"'"))b.classList.add('active');});
  // Lazy render per tab
  if(name==='tasks')        renderTasks();
  if(name==='habits')       renderHabits();
  if(name==='kb')           renderKB();
  if(name==='reviews')      renderReviews();
  if(name==='timeline')     renderTimeline();
  if(name==='personal-dash')renderPersonalDash();
  if(name==='analytics')    renderPersonalAnalytics();
  if(name==='clients')      renderClientsTab();
  if(name==='leadflow')     renderLeadFlow();
  if(name==='settings')     renderSettings();
}

/* ══ LEADFLOW SUB-TAB SYSTEM — FIXED ══
   Each sub-tab click now calls its own render function.
   This is the primary fix for empty tabs.             */
function switchLFTab(name){
  document.querySelectorAll('.lf-tab-pane').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('#lf-sub-nav .tab-btn').forEach(b=>b.classList.remove('active'));
  const pane=$('lf-tab-'+name); if(pane) pane.classList.add('active');
  const btns=document.querySelectorAll('#lf-sub-nav .tab-btn');
  btns.forEach(b=>{if(b.getAttribute('onclick')&&b.getAttribute('onclick').includes("'"+name+"'"))b.classList.add('active');});
  // Render the correct sub-tab content
  if(name==='lf-pipeline')  renderPipeline();
  if(name==='lf-dashboard') updateDashboard();
  if(name==='lf-portfolio') renderPortfolio();
  if(name==='lf-referrals') renderReferralTree();
  if(name==='lf-insights')  updateInsights();
  if(name==='lf-analytics') updateStats();
}

/* ══ COLLAPSIBLES ══ */
function toggleBanner(){
  bannerOpen=!bannerOpen;
  $('banner-body-content').style.display=bannerOpen?'flex':'none';
  $('banner-toggle-hint').textContent=bannerOpen?'▾ collapse':'▸ expand';
}
function toggleBI(){
  biOpen=!biOpen;
  $('bi-body').style.display=biOpen?'block':'none';
  $('bi-toggle-hint').textContent=biOpen?'▾ collapse':'▾ expand';
  if(biOpen) renderTrendChart();
}

/* ══ MOOD / ENERGY ══ */
function selectMood(v){
  currentMood=v;
  document.querySelectorAll('.mood-btn').forEach(b=>{b.classList.toggle('active',parseInt(b.dataset.val)===v);});
}

/* ══ EDITOR HELPERS ══ */
function updateEditorMeta(e){
  const words=e.target.value.trim().split(/\s+/).filter(Boolean).length;
  $('editor-meta').textContent=words+' words';
  // Tag suggestions
  const val=e.target.value; const cursor=e.target.selectionStart;
  const before=val.slice(0,cursor); const tagMatch=before.match(/#(\w*)$/);
  if(tagMatch){
    const q=tagMatch[1].toLowerCase();
    const clientNames=[...new Set(leads.map(l=>l.name))].filter(n=>n.toLowerCase().includes(q));
    const builtins=['p0','p1','p2','sip','renewal','objection','win','insight','task','habit'].filter(t=>t.includes(q));
    const combined=[...clientNames.map(n=>'#'+n),...builtins.map(t=>'#'+t)].slice(0,8);
    if(combined.length){
      $('tag-suggest').style.display='flex';
      $('tag-suggest').innerHTML=combined.map(t=>`<button type="button" class="tag-chip" data-tag="${escHtml(t)}">${escHtml(t)}</button>`).join('');
    } else {$('tag-suggest').style.display='none';}
  } else {$('tag-suggest').style.display='none';}
  // Live BI hint
  const hint=[];
  if(/#sip/i.test(val)) hint.push('📈 SIP logged');
  if(/#win/i.test(val)) hint.push('🏆 Win detected');
  if(/#objection/i.test(val)) hint.push('🔍 Objection noted');
  $('bi-live-hint').textContent=hint.join(' · ');
  // Log→Lead live link preview
  renderLogLeadLinks(val);
}

/* ══ LOG → LEAD LINK (KEY FIX) ══
   When a #clientname is typed in the log textarea, check if a lead
   with that name exists. Show a clickable badge below the editor.
   After saving, the entry's tags link to the lead in LeadFlow.    */
function renderLogLeadLinks(text){
  const el=$('log-lead-links'); if(!el) return;
  const tags=(text.match(/#([A-Za-z][A-Za-z0-9_\s]*)/g)||[]).map(t=>t.slice(1).trim());
  const linkedLeads=[];
  tags.forEach(tag=>{
    const match=leads.find(l=>l.name.toLowerCase()===tag.toLowerCase()||l.name.toLowerCase().includes(tag.toLowerCase()));
    if(match&&!linkedLeads.find(x=>x.id===match.id)) linkedLeads.push(match);
  });
  if(!linkedLeads.length){el.innerHTML='';return;}
  el.innerHTML='<span style="font-size:.68rem;color:var(--text-dim);">🔗 Links to: </span>'+
    linkedLeads.map(l=>`<span class="log-link-badge" onclick="jumpToLead('${escHtml(l.id)}')" title="Jump to ${escHtml(l.name)} in LeadFlow">🆔 ${escHtml(l.id)} · ${escHtml(l.name)}</span>`).join('');
}

/* Jump to a specific lead in LeadFlow Pipeline */
function jumpToLead(leadId){
  switchTab('leadflow');
  // Ensure pipeline sub-tab is active
  switchLFTab('lf-pipeline');
  // Scroll and highlight the lead card after a short delay
  setTimeout(()=>{
    const card=document.getElementById(leadId);
    if(card){
      card.scrollIntoView({behavior:'smooth',block:'center'});
      card.style.boxShadow='0 0 0 2px #3b82f6, 0 0 20px #3b82f666';
      setTimeout(()=>{card.style.boxShadow='';},2500);
    }
  },300);
}

function insertTag(tag){
  const ta=$('content'); const v=ta.value; const c=ta.selectionStart;
  const before=v.slice(0,c).replace(/#\w*$/,'');
  ta.value=before+tag+' '+v.slice(c); ta.focus();
  $('tag-suggest').style.display='none';
}

function toggleTaskUI(){$('taskExtras').style.display=$('type').value==='Task'?'inline-flex':'none';}
function resetForm(){
  editingEntryId=null;
  $('content').value='';$('reminder').value='';selectMood(3);$('type').value='Note';
  if($('logClientLink')) $('logClientLink').value='';
  toggleTaskUI();$('editor-meta').textContent='0 words';
  const ll=$('log-lead-links');if(ll)ll.innerHTML='';
  const sb=$('saveBtn'); if(sb) sb.textContent='Save Entry';
}

function insertTemplate(){$('content').value='## Reflection\n**What went well:**\n\n**What could improve:**\n\n**Key insight:**\n';}
function insertWin(){$('content').value+='🏆 WIN: ';}
function insertHabit(){$('content').value+='🔄 HABIT: ';}
function insertNote(){$('content').value+='💡 INSIGHT: ';}
function insertMorning(){$('content').value='☀️ Morning Intention:\n**Focus today:**\n**Energy intention:**\n**Top 3 tasks:**\n1. \n2. \n3. \n';}
function insertClient(){
  const lead=leads[0]||null;
  const name=lead?lead.name:'ClientName';
  $('content').value+=`👤 CLIENT LOG #${name.replace(/\s/g,'')}: `;
  if($('logClientLink')&&lead) $('logClientLink').value=lead.id;
  $('type').value='Note';
  renderLogLeadLinks($('content').value);
}

/* ══ SAVE ENTRY ══ */
function saveEntry(){
  const text=$('content').value.trim();
  if(!text) return;
  const type=$('type').value;
  const priority=type==='Task'?$('priority').value:null;
  const reminder=$('reminder').value||null;
  const selectedLeadId=$('logClientLink')?.value||'';
  const {tags:clientTags,ids:linkedLeadIds}=resolveLinkedLeadIds(text,selectedLeadId);
  const now=Date.now();

  if(editingEntryId){
    entries=entries.map(e=>e.id===editingEntryId?{
      ...e,
      text,type,priority,reminder,energy:currentMood,tags:clientTags,linkedLeadId:linkedLeadIds[0]||'',linkedLeadIds,linkedTaskId:e.linkedTaskId||null,sourceType:e.sourceType||'manual-log',
      done:type==='Task'?e.done:false,
      updatedAt:new Date().toISOString()
    }:e);
    if(linkedLeadIds.length){
      const snippet=text.slice(0,120).replace(/\n/g,' ');
      leads=leads.map(l=>{
        if(!linkedLeadIds.includes(l.id)) return l;
        const hist=[...(l.history||[])];
        hist.unshift({date:fmtDate(now),msg:`✏️ Log updated: ${snippet}`});
        return {...l,history:hist,lastUpdated:now};
      });
    }
    addAudit(`Log entry updated (${type})${linkedLeadIds.length?' — linked: '+linkedLeadIds.join(', '):''}`);
  } else {
    const entry={
      id:genId(),text,type,priority,reminder,
      energy:currentMood,done:false,
      tags:clientTags,
      linkedLeadId:linkedLeadIds[0]||'',
      linkedLeadIds,
      linkedTaskId:null,
      sourceType:'manual-log',
      date:new Date().toISOString(),
      dateShort:fmtDate(now)
    };
    entries.unshift(entry);
    if(linkedLeadIds.length){
      const snippet=text.slice(0,120).replace(/\n/g,' ');
      leads=leads.map(l=>{
        if(!linkedLeadIds.includes(l.id)) return l;
        const hist=[...(l.history||[])];
        hist.unshift({date:fmtDate(now),msg:`📝 Log: ${snippet}`});
        return {...l,history:hist,lastUpdated:now};
      });
    }
    addAudit(`Log entry saved (${type})${linkedLeadIds.length?' — linked: '+linkedLeadIds.join(', '):''}`);
  }

  saveAll();
  renderEntries();
  renderTasks();
  renderHabits();
  renderStatsPanel();
  updatePriorityIntel();
  updateReminders();
  renderBiKpis();
  resetForm();
}

function editEntry(id){
  const e=entries.find(x=>x.id===id); if(!e) return;
  editingEntryId=id;
  $('content').value=e.text||'';
  $('type').value=e.type||'Note';
  toggleTaskUI();
  if($('priority')) $('priority').value=e.priority||'Low';
  $('reminder').value=e.reminder||'';
  selectMood(e.energy||3);
  if($('logClientLink')) $('logClientLink').value=(e.linkedLeadIds||[])[0]||'';
  const sb=$('saveBtn'); if(sb) sb.textContent='Update Entry';
  updateEditorMeta({target:$('content')});
  $('content').focus();
  $('content').setSelectionRange($('content').value.length,$('content').value.length);
}

/* ══ RENDER ENTRIES ══ */
function renderEntries(){
  const search=($('search-log')?.value||'').toLowerCase();
  const typeFilter=$('filter-type')?.value||'';
  const list=$('entries-list'); if(!list) return;
  const filtered=entries.filter(e=>{
    if(typeFilter&&e.type!==typeFilter) return false;
    if(search&&!e.text.toLowerCase().includes(search)) return false;
    return true;
  });
  if(!filtered.length){list.innerHTML='<div style="text-align:center;padding:30px;color:var(--text-dim);">No entries yet. Start logging above ↑</div>';return;}
  list.innerHTML=filtered.slice(0,60).map(e=>{
    // Build linked lead badges for entries that have linked leads
    const linkedBadges=(e.linkedLeadIds||[]).map(lid=>{
      const lead=leads.find(l=>l.id===lid);
      return lead?`<span class="log-link-badge" onclick="jumpToLead('${escHtml(lid)}')" title="Jump to ${escHtml(lead.name)} in LeadFlow" style="margin-right:3px;">🆔 ${escHtml(lid)} · ${escHtml(lead.name)}</span>`:'';
    }).join('');
    return `<div class="entry-card ${e.done&&e.type==='Task'?'task-done':''}">
      <div class="entry-header">
        <div>
          <span class="entry-type-badge ${e.type.toLowerCase()}">${e.type}</span>
          ${e.priority?`<span class="priority-tag ${e.priority}" style="margin-left:5px;">${e.priority}</span>`:''}
          ${e.reminder?`<span style="font-size:.65rem;color:var(--accent-amber);margin-left:5px;">🔔 ${new Date(e.reminder).toLocaleString('en-IN',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>`:''}
        </div>
        <div class="entry-meta"><span class="energy-dot mood-${e.energy}"></span>${e.dateShort}</div>
      </div>
      <div class="entry-body">${escHtml(e.text.slice(0,400))}${e.text.length>400?'…':''}</div>
      ${linkedBadges?`<div style="margin-top:5px;">${linkedBadges}</div>`:''}
      <div class="entry-actions">
        <button onclick="editEntry(${e.id})">✏️ Edit</button>
        ${e.type==='Task'?`<button onclick="toggleDone(${e.id})">${e.done?'↩️ Reopen':'✅ Done'}</button>`:''}
        <button onclick="deleteEntry(${e.id})">🗑 Delete</button>
      </div>
    </div>`;
  }).join('');
}

function toggleDone(id){entries=entries.map(e=>e.id===id?{...e,done:!e.done}:e);saveAll();renderEntries();renderStatsPanel();}
function deleteEntry(id){if(!confirm('Delete this entry?'))return;entries=entries.filter(e=>e.id!==id);saveAll();renderEntries();renderStatsPanel();updatePriorityIntel();}

/* ══ TASKS ══ */
function renderTasks(){
  const pf=$('task-filter-priority')?.value||'';
  const df=$('task-filter-done')?.value||'';
  const list=$('tasks-list'); if(!list) return;
  let tasks=entries.filter(e=>e.type==='Task');
  if(pf) tasks=tasks.filter(t=>t.priority===pf);
  if(df==='open') tasks=tasks.filter(t=>!t.done);
  if(df==='done') tasks=tasks.filter(t=>t.done);
  if(!tasks.length){list.innerHTML='<div style="text-align:center;padding:24px;color:var(--text-dim);">No tasks found.</div>';return;}
  list.innerHTML=tasks.map(t=>`
    <div class="entry-card ${t.done?'task-done':''}" style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="display:flex;gap:8px;align-items:flex-start;flex:1;">
          <input type="checkbox" ${t.done?'checked':''} onchange="toggleDone(${t.id})" style="margin-top:3px;accent-color:var(--primary);">
          <div>
            <div style="font-size:.82rem;">${escHtml(t.text.slice(0,200))}</div>
            <div style="font-size:.65rem;color:var(--text-muted);margin-top:3px;">${t.dateShort} · <span class="priority-tag ${t.priority}">${t.priority}</span></div>
          </div>
        </div>
        <div style="display:flex;gap:4px;"><button onclick="editEntry(${t.id});switchTab('log')" style="background:none;border:none;color:var(--text-dim);cursor:pointer;">✏️</button><button onclick="deleteEntry(${t.id})" style="background:none;border:none;color:var(--text-dim);cursor:pointer;">🗑</button></div>
      </div>
    </div>`).join('');
}

/* ══ HABITS ══ */
function renderHabits(){
  const list=$('habits-list'); if(!list) return;
  const habitEntries=entries.filter(e=>e.type==='Habit');
  const today=todayISO();
  const todayHabits=habitEntries.filter(e=>e.date?.startsWith(today));
  const names=[...new Set(habitEntries.map(e=>e.text.replace(/^🔄\s*HABIT:\s*/i,'').split('\n')[0].trim()).filter(Boolean))].slice(0,20);
  if(!names.length){list.innerHTML='<div style="text-align:center;padding:24px;color:var(--text-dim);">No habits logged yet. Use the Habit button in Log tab.</div>';return;}
  list.innerHTML=names.map(name=>{
    const streak=countStreak(habitEntries,name);
    const doneToday=todayHabits.some(e=>e.text.includes(name));
    return `<div class="habit-row">
      <div><div class="habit-name">${escHtml(name)}</div><div class="habit-streak">🔥 ${streak} day streak</div></div>
      <input type="checkbox" class="habit-check" ${doneToday?'checked':''} onchange="logHabit('${escHtml(name)}',this.checked)" title="${doneToday?'Done today':'Mark done today'}">
    </div>`;
  }).join('');
}

function countStreak(habitEntries,name){
  let streak=0,d=new Date();
  for(let i=0;i<30;i++){
    const ds=d.toISOString().split('T')[0];
    if(habitEntries.some(e=>e.text.includes(name)&&e.date?.startsWith(ds))) streak++;
    else if(i>0) break;
    d.setDate(d.getDate()-1);
  }
  return streak;
}

function logHabit(name,checked){
  if(!checked) return;
  entries.unshift({id:genId(),text:`🔄 HABIT: ${name}`,type:'Habit',priority:null,reminder:null,energy:currentMood,done:false,tags:[],linkedLeadId:'',linkedLeadIds:[],linkedTaskId:null,sourceType:'habit-check',date:new Date().toISOString(),dateShort:fmtDate(Date.now())});
  saveAll();
}

/* ══ KNOWLEDGE BASE ══ */
function renderKB(){
  const search=($('kb-search')?.value||'').toLowerCase();
  const list=$('kb-list'); if(!list) return;
  const kbEntries=entries.filter(e=>e.type==='Note'&&(e.text.startsWith('💡')||e.text.includes('INSIGHT')||e.tags?.length>0));
  const filtered=kbEntries.filter(e=>!search||e.text.toLowerCase().includes(search));
  if(!filtered.length){list.innerHTML='<div style="text-align:center;padding:24px;color:var(--text-dim);">No knowledge entries. Add notes with 💡 INSIGHT prefix.</div>';return;}
  list.innerHTML=filtered.map(e=>`
    <div class="kb-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <h4>${escHtml(e.text.split('\n')[0].slice(0,80))}</h4>
        <span style="font-size:.65rem;color:var(--text-muted);">${e.dateShort}</span>
      </div>
      ${e.text.split('\n').length>1?`<div style="font-size:.76rem;color:var(--text-muted);margin-top:4px;">${escHtml(e.text.split('\n').slice(1).join('\n').slice(0,200))}</div>`:''}
      <div class="kb-tags">${(e.tags||[]).map(t=>`<span class="kb-tag">#${escHtml(t)}</span>`).join('')}</div>
    </div>`).join('');
}

/* ══ REVIEWS ══ */
function saveReview(){
  const score=parseInt($('review-score').value)||0;
  const date=$('review-date').value||todayISO();
  const wins=$('review-wins').value.trim();
  const challenges=$('review-challenges').value.trim();
  const tomorrow=$('review-tomorrow').value.trim();
  if(!score){alert('Please enter a review score.');return;}
  reviews.unshift({id:genId(),score,date,wins,challenges,tomorrow});
  saveAll();renderReviews();
  $('review-score').value='';$('review-wins').value='';$('review-challenges').value='';$('review-tomorrow').value='';
}

function renderReviews(){
  const list=$('reviews-list'); if(!list) return;
  if(!reviews.length){list.innerHTML='<div style="text-align:center;padding:24px;color:var(--text-dim);">No reviews yet.</div>';return;}
  list.innerHTML=reviews.map(r=>`
    <div class="review-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div><span class="review-score">${r.score}/10</span> <span class="review-label">Review Score</span></div>
        <span style="font-size:.72rem;color:var(--text-muted);">${r.date}</span>
      </div>
      ${r.wins?`<div style="font-size:.78rem;margin-bottom:4px;"><strong style="color:#86efac;">✅ Wins:</strong> ${escHtml(r.wins)}</div>`:''}
      ${r.challenges?`<div style="font-size:.78rem;margin-bottom:4px;"><strong style="color:#fca5a5;">⚠️ Challenges:</strong> ${escHtml(r.challenges)}</div>`:''}
      ${r.tomorrow?`<div style="font-size:.78rem;"><strong style="color:#93c5fd;">🎯 Tomorrow:</strong> ${escHtml(r.tomorrow)}</div>`:''}
      <button onclick="deleteReview(${r.id})" style="margin-top:8px;background:none;border:none;color:var(--text-dim);font-size:.68rem;cursor:pointer;">🗑 Delete</button>
    </div>`).join('');
}

function deleteReview(id){reviews=reviews.filter(r=>r.id!==id);saveAll();renderReviews();}

/* ══ TIMELINE ══ */
function renderTimeline(){
  const list=$('timeline-list'); if(!list) return;
  const all=[
    ...entries.map(e=>({ts:new Date(e.date).getTime(),text:e.text.split('\n')[0].slice(0,100),type:e.type,sub:'Personal Log'})),
    ...leads.flatMap(l=>(l.history||[]).map(h=>({ts:new Date(h.date).getTime()||l.createdAt,text:h.msg,type:'Lead',sub:l.name+' · '+l.id})))
  ].sort((a,b)=>b.ts-a.ts).slice(0,60);
  if(!all.length){list.innerHTML='<div style="text-align:center;padding:24px;color:var(--text-dim);">Nothing logged yet.</div>';return;}
  list.innerHTML=all.map((item,i)=>`
    <div class="timeline-item">
      <div class="timeline-line">
        <div class="timeline-dot" style="background:${item.type==='Lead'?'#f59e0b':item.type==='Task'?'#10b981':item.type==='Habit'?'#a78bfa':'#3b82f6'};"></div>
        ${i<all.length-1?'<div class="timeline-track"></div>':''}
      </div>
      <div class="timeline-content">
        <div class="timeline-date">${fmtDate(item.ts)} · <span style="color:var(--text-dim);">${escHtml(item.sub)}</span></div>
        <div class="timeline-text">${escHtml(item.text)}</div>
      </div>
    </div>`).join('');
}

/* ══ PERSONAL DASHBOARD ══ */
function renderPersonalDash(){
  const kpis=$('personal-kpis'); if(!kpis) return;
  const totalEntries=entries.length;
  const doneTasks=entries.filter(e=>e.type==='Task'&&e.done).length;
  const totalTasks=entries.filter(e=>e.type==='Task').length;
  const avgEnergy=entries.length?(entries.reduce((s,e)=>s+(e.energy||3),0)/entries.length).toFixed(1):0;
  const avgReview=reviews.length?(reviews.reduce((s,r)=>s+(r.score||0),0)/reviews.length).toFixed(1):0;
  const activeGoals=goals.filter(g=>!g.done).length;
  kpis.innerHTML=`
    <div class="dash-card"><h4>📝 Total Entries</h4><div style="font-size:1.6rem;font-weight:800;">${totalEntries}</div></div>
    <div class="dash-card"><h4>✅ Task Completion</h4><div style="font-size:1.6rem;font-weight:800;">${totalTasks?Math.round((doneTasks/totalTasks)*100):0}%</div><div style="font-size:.72rem;color:var(--text-muted);">${doneTasks}/${totalTasks} done</div></div>
    <div class="dash-card"><h4>⚡ Avg Energy</h4><div style="font-size:1.6rem;font-weight:800;">${avgEnergy}<span style="font-size:.8rem;">/5</span></div></div>
    <div class="dash-card"><h4>🌙 Avg Review</h4><div style="font-size:1.6rem;font-weight:800;">${avgReview}<span style="font-size:.8rem;">/10</span></div></div>
    <div class="dash-card"><h4>🎯 Active Goals</h4><div style="font-size:1.6rem;font-weight:800;">${activeGoals}</div></div>`;
  renderPersonalChart();
}

function renderPersonalChart(){
  const canvas=$('personalChart'); if(!canvas) return;
  const last30=entries.slice(0,30).reverse();
  const labels=last30.map(e=>e.dateShort?.split(' ').slice(0,2).join(' ')||'');
  const energyData=last30.map(e=>e.energy||0);
  if(personalChart) personalChart.destroy();
  personalChart=new Chart(canvas,{type:'line',data:{labels,datasets:[{label:'Energy',data:energyData,borderColor:'#3b82f6',backgroundColor:'rgba(59,130,246,.1)',tension:.4,fill:true,pointRadius:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8',font:{size:11}}}},scales:{x:{ticks:{color:'#64748b',font:{size:10}},grid:{color:'#1e293b'}},y:{min:0,max:5,ticks:{color:'#64748b',font:{size:10}},grid:{color:'#1e293b'}}}}});
}

/* ══ PERSONAL ANALYTICS ══ */
function renderPersonalAnalytics(){
  const el=$('personal-analytics'); if(!el) return;
  const totalEntries=entries.length;
  const byType=entries.reduce((a,e)=>{a[e.type]=(a[e.type]||0)+1;return a;},{});
  const tagCounts={};
  entries.forEach(e=>(e.tags||[]).forEach(t=>{tagCounts[t]=(tagCounts[t]||0)+1;}));
  const topTags=Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  el.innerHTML=`
    <div class="stat-boxes">
      <div class="stat-box"><div class="sb-val">${totalEntries}</div><div class="sb-label">Total Entries</div></div>
      <div class="stat-box"><div class="sb-val">${byType.Note||0}</div><div class="sb-label">Notes</div></div>
      <div class="stat-box"><div class="sb-val">${byType.Task||0}</div><div class="sb-label">Tasks</div></div>
      <div class="stat-box"><div class="sb-val">${byType.Habit||0}</div><div class="sb-label">Habit Logs</div></div>
      <div class="stat-box"><div class="sb-val">${reviews.length}</div><div class="sb-label">Reviews</div></div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-top:10px;">
      <h4 style="font-size:.78rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:10px;">Top Tags in Log</h4>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">${topTags.map(([t,c])=>`<span style="padding:4px 10px;background:var(--primary-glow);border:1px solid #3b82f633;border-radius:5px;font-size:.74rem;color:#93c5fd;">#${escHtml(t)} <strong>(${c})</strong></span>`).join('')||'<span style="color:var(--text-dim);">No tags yet</span>'}</div>
    </div>`;
}

/* ══ STATS PANEL ══ */
function renderStatsPanel(){
  const el=$('stats-panel'); if(!el) return;
  const tasks=entries.filter(e=>e.type==='Task');
  const done=tasks.filter(t=>t.done).length;
  const habits=entries.filter(e=>e.type==='Habit');
  const today=todayISO();
  const todayEntries=entries.filter(e=>e.date?.startsWith(today));
  const activeLeads=leads.filter(l=>!['col-won','col-lost'].includes(l.stage)).length;
  el.innerHTML=[
    {v:tasks.length,l:'Total Tasks'},{v:done,l:'Done Tasks'},{v:habits.length,l:'Habit Logs'},{v:todayEntries.length,l:"Today's Entries"},
    {v:leads.length,l:'All Leads'},{v:activeLeads,l:'Active Leads'},{v:leads.filter(l=>l.stage==='col-won').length,l:'Won Leads'},
  ].map(s=>`<div class="stat-card"><div class="sv">${s.v}</div><div class="sl">${s.l}</div></div>`).join('');
}

/* ══ PRIORITY INTEL ══ */
function updatePriorityIntel(){
  const el=$('priority-msg-text'); if(!el) return;
  const msgs=[];
  const today=todayISO();
  const overdueTasks=entries.filter(e=>e.type==='Task'&&!e.done&&e.reminder&&new Date(e.reminder)<new Date());
  if(overdueTasks.length) msgs.push(`🔴 ${overdueTasks.length} overdue task(s) need attention`);
  const hotLeads=leads.filter(l=>l.temp==='hot'&&!['col-won','col-lost'].includes(l.stage));
  if(hotLeads.length) msgs.push(`🔥 ${hotLeads.length} hot lead(s): ${hotLeads.slice(0,2).map(l=>l.name).join(', ')}`);
  const overdueLeads=leads.filter(l=>l.nextAction&&l.nextAction<today&&!['col-won','col-lost'].includes(l.stage));
  if(overdueLeads.length) msgs.push(`⚠️ ${overdueLeads.length} lead follow-up(s) overdue`);
  const pendingGoals=goals.filter(g=>!g.done);
  if(pendingGoals.length) msgs.push(`🎯 ${pendingGoals.length} active goal(s) in progress`);
  if(targets.name) msgs.unshift(`👋 Good day, ${targets.name}!`);
  el.innerHTML=msgs.length?msgs.map(m=>`<div style="padding:2px 0;">→ ${m}</div>`).join(''):'Everything looks good! Add entries and leads to see intelligence here.';
}

/* ══ REMINDERS ══ */
function updateReminders(){
  const panel=$('reminder-panel'); const list=$('reminder-list'); if(!panel||!list) return;
  const now=new Date();
  const due=entries.filter(e=>e.reminder&&new Date(e.reminder)<=now&&!e.done);
  if(!due.length){panel.style.display='none';return;}
  panel.style.display='block';
  list.innerHTML=due.map(e=>`<div class="reminder-item">🔔 ${escHtml(e.text.split('\n')[0].slice(0,80))} <span style="font-size:.62rem;color:#a78bfa;">(${new Date(e.reminder).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})})</span></div>`).join('');
}

/* ══ GOALS ══ */
function openGoalModal(){renderGoalsModal();$('goalModal').style.display='flex';}
function renderGoalsModal(){
  const el=$('goals-modal-list'); if(!el) return;
  el.innerHTML=goals.map((g,i)=>`
    <div class="goal-item">
      <input type="checkbox" ${g.done?'checked':''} onchange="toggleGoal(${i})">
      <div class="goal-item-text" style="${g.done?'text-decoration:line-through;opacity:.5;':''}">${escHtml(g.text)}</div>
      <button class="del-btn" onclick="deleteGoal(${i})">🗑</button>
    </div>`).join('')||'<div style="color:var(--text-dim);font-size:.78rem;padding:8px 0;">No goals yet.</div>';
  renderGoalDisplay();
}
function addGoal(){
  const text=$('new-goal-text').value.trim(); if(!text) return;
  goals.push({id:genId(),text,done:false,created:Date.now()});
  $('new-goal-text').value='';
  saveAll();renderGoalsModal();
}
function toggleGoal(i){goals[i].done=!goals[i].done;saveAll();renderGoalsModal();}
function deleteGoal(i){goals.splice(i,1);saveAll();renderGoalsModal();}
function renderGoalDisplay(){
  const el=$('goal-list-display'); if(!el) return;
  const active=goals.filter(g=>!g.done).slice(0,5);
  el.innerHTML=active.length?active.map(g=>`<div>→ ${escHtml(g.text)}</div>`).join(''):'<div style="color:#6ee7b7;">No active goals. Click Manage Goals to add.</div>';
}

/* ══ BI KPIS ══ */
function renderBiKpis(){
  const el=$('bi-kpis'); if(!el) return;
  const totalEntries=entries.length;
  const avgEnergy=entries.length?(entries.reduce((s,e)=>s+(e.energy||3),0)/entries.length).toFixed(1):0;
  const won=leads.filter(l=>l.stage==='col-won');
  const wonRev=won.reduce((s,l)=>s+(l.actualValue||l.value),0);
  const pipeline=leads.filter(l=>!['col-won','col-lost'].includes(l.stage)).reduce((s,l)=>s+l.value,0);
  el.innerHTML=[
    {v:totalEntries,l:'Log Entries',s:'all time'},
    {v:avgEnergy+'/5',l:'Avg Energy',s:'across all'},
    {v:leads.length,l:'Total Leads',s:'in pipeline'},
    {v:'₹'+fmtCr(wonRev),l:'Won Revenue',s:'closed deals'},
    {v:'₹'+fmtCr(pipeline),l:'Live Pipeline',s:'active leads'},
  ].map(k=>`<div class="bi-kpi"><div class="kpi-label">${k.l}</div><div class="kpi-value">${k.v}</div><div class="kpi-sub">${k.s}</div></div>`).join('');
  const iEl=$('bi-insights'); if(!iEl) return;
  const ins=[];
  if(parseFloat(avgEnergy)<2.5) ins.push({type:'warn',text:'Your energy average is low. Consider reviewing habits and workload.'});
  if(won.length>0) ins.push({type:'good',text:`${won.length} leads closed. Avg deal size: ₹${fmtCr(wonRev/won.length)}.`});
  const activeLeads=leads.filter(l=>!['col-won','col-lost'].includes(l.stage)).length;
  if(activeLeads>0) ins.push({type:'info',text:`${activeLeads} active leads in pipeline. Live value: ₹${fmtCr(pipeline)}.`});
  iEl.innerHTML=ins.map(i=>`<div class="bi-insight-item ${i.type}">${i.text}</div>`).join('');
}

function renderTrendChart(){
  const canvas=$('trendChart'); if(!canvas) return;
  const last30days=[]; const now=new Date();
  for(let i=29;i>=0;i--){const d=new Date(now);d.setDate(d.getDate()-i);last30days.push(d.toISOString().split('T')[0]);}
  const energyByDay=last30days.map(d=>{const es=entries.filter(e=>e.date?.startsWith(d)&&e.energy);return es.length?(es.reduce((s,e)=>s+(e.energy||0),0)/es.length).toFixed(1):null;});
  const tasksByDay=last30days.map(d=>entries.filter(e=>e.date?.startsWith(d)&&e.type==='Task'&&e.done).length);
  const reviewByDay=last30days.map(d=>{const r=reviews.find(rv=>rv.date===d);return r?(r.score/2):null;});
  if(trendChart) trendChart.destroy();
  trendChart=new Chart(canvas,{type:'line',data:{labels:last30days.map(d=>d.slice(5)),datasets:[
    {label:'Energy',data:energyByDay,borderColor:'#2563eb',backgroundColor:'transparent',tension:.4,spanGaps:true,pointRadius:2},
    {label:'Tasks Done',data:tasksByDay,borderColor:'#10b981',backgroundColor:'transparent',tension:.4,pointRadius:2},
    {label:'Review/2',data:reviewByDay,borderColor:'#f59e0b',backgroundColor:'transparent',tension:.4,spanGaps:true,pointRadius:2}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{x:{ticks:{color:'#64748b',font:{size:9},maxTicksLimit:8},grid:{color:'#1e293b'}},y:{min:0,ticks:{color:'#64748b',font:{size:9}},grid:{color:'#1e293b'}}}}});
}

/* ══ STRATEGIC INSIGHT ══ */
function updateStrategicInsight(){
  const el=$('strategic-insights'); if(!el) return;
  const today=todayISO();
  const overdueLeads=leads.filter(l=>l.nextAction&&l.nextAction<today&&!['col-won','col-lost'].includes(l.stage));
  const hotLeads=leads.filter(l=>l.temp==='hot'&&!['col-won','col-lost'].includes(l.stage));
  const tasks=entries.filter(e=>e.type==='Task'&&!e.done).length;
  const msgs=[];
  if(overdueLeads.length) msgs.push(`<strong>${overdueLeads.length} overdue follow-up(s)</strong> — act today!`);
  if(hotLeads.length) msgs.push(`<strong>${hotLeads.length} hot lead(s)</strong> ready to close.`);
  if(tasks>5) msgs.push(`<strong>${tasks} open tasks</strong> — triage by priority.`);
  if(!msgs.length) msgs.push("All clear! Great momentum. Log today's wins and plan tomorrow.");
  el.innerHTML='✨ <strong>Strategic Nudge:</strong> '+msgs[0];
}

/* ══ LEADFLOW RENDER ALL ══ */
function renderLeadFlow(){
  // Render whatever sub-tab is currently active
  const activeLFPane=document.querySelector('.lf-tab-pane.active');
  if(!activeLFPane) return;
  const id=activeLFPane.id; // e.g. "lf-tab-lf-pipeline"
  const name=id.replace('lf-tab-',''); // e.g. "lf-pipeline"
  if(name==='lf-pipeline')  renderPipeline();
  if(name==='lf-dashboard') updateDashboard();
  if(name==='lf-portfolio') renderPortfolio();
  if(name==='lf-referrals') renderReferralTree();
  if(name==='lf-insights')  updateInsights();
  if(name==='lf-analytics') updateStats();
  updateLogClientOptions();
  // Always default to pipeline if nothing is active
  if(!activeLFPane.classList.contains('active')) renderPipeline();
}

/* ══ LEAD ID GENERATOR ══ */
function generateLeadID(){
  const yr=new Date().getFullYear();
  const max=leads.reduce((m,l)=>Math.max(m,parseInt((l.clientCode||'').split('-')[2])||0),0);
  return `KK-${yr}-${String(max+1).padStart(3,'0')}`;
}

/* ══ PRODUCT HELPERS ══ */
function toggleProductValue(val,checked){
  const container=$('productValues');
  const rowId='pvrow-'+val.replace(/\s/g,'-');
  const checkItem=document.querySelector(`#productCheckboxes input[value="${CSS.escape(val)}"]`)?.closest('.product-check-item');
  if(checked){
    if(checkItem) checkItem.classList.add('selected');
    if(!$(rowId)){
      const row=document.createElement('div');
      row.className='product-value-row';row.id=rowId;
      row.innerHTML=`<div class="product-value-header">${PEMOJI[val]||''} ${val}</div>
        <div class="product-value-inputs">
          <div><label>Est. Value (₹)</label><input type="number" id="pval-${val.replace(/\s/g,'-')}" placeholder="e.g. 60000" min="0"></div>
          <div><label>Monthly SIP (₹) — if SIP</label><input type="number" id="psip-${val.replace(/\s/g,'-')}" placeholder="e.g. 5000" min="0"></div>
        </div>`;
      container.appendChild(row);
    }
  } else {
    if(checkItem) checkItem.classList.remove('selected');
    $(rowId)?.remove();
  }
}

function getSelectedProducts(){
  return [...document.querySelectorAll('#productCheckboxes input[type=checkbox]:checked')].map(cb=>({
    product:cb.value,
    value:parseFloat($('pval-'+cb.value.replace(/\s/g,'-'))?.value)||0,
    sipAmt:parseFloat($('psip-'+cb.value.replace(/\s/g,'-'))?.value)||0,
    status:'open'
  }));
}

function setProductCheckboxes(products){
  document.querySelectorAll('#productCheckboxes input[type=checkbox]').forEach(cb=>{
    cb.checked=false;cb.closest('.product-check-item')?.classList.remove('selected');
  });
  $('productValues').innerHTML='';
  (products||[]).forEach(p=>{
    const cb=document.querySelector(`#productCheckboxes input[value="${CSS.escape(p.product)}"]`);
    if(cb){cb.checked=true;toggleProductValue(p.product,true);}
    const inp=$('pval-'+p.product.replace(/\s/g,'-')); if(inp) inp.value=p.value||'';
    const sinp=$('psip-'+p.product.replace(/\s/g,'-')); if(sinp) sinp.value=p.sipAmt||'';
  });
}

function totalValue(products){return(products||[]).reduce((s,p)=>s+(p.value||0),0);}

/* ══ LEAD MODAL ══ */
function openLeadModal(editId=null){
  $('editLeadId').value='';
  $('leadModalTitle').textContent=editId?'Edit Lead':'New Lead';
  $('productValues').innerHTML='';
  $('noProductWarning').style.display='none';
  $('wonSection').style.display='none';$('lostSection').style.display='none';
  document.querySelectorAll('#productCheckboxes input[type=checkbox]').forEach(cb=>{cb.checked=false;cb.closest('.product-check-item')?.classList.remove('selected');});
  const names=[...new Set(leads.map(l=>l.name))].filter(Boolean);
  $('clientNamesList').innerHTML=names.map(n=>`<option value="${escHtml(n)}">`).join('');
  updateLogClientOptions();
  $('clientIdDisplay').textContent=editId?'Existing':'Auto on Save';
  if(editId){
    const l=leads.find(x=>x.id===editId); if(!l) return;
    $('editLeadId').value=l.id;
    $('clientName').value=l.name;
    $('phone').value=l.phone||'';
    $('email').value=l.email||'';
    $('referredBy').value=l.referredBy||'';
    setProductCheckboxes(l.products);
    $('revType').value=l.revType||'Trail';
    $('source').value=l.source||'Referral';
    $('temp').value=l.temp||'warm';
    $('nextAction').value=l.nextAction||'';
    $('clientIdDisplay').textContent=l.id;
    if(l.stage==='col-won'){$('wonSection').style.display='';$('actualValue').value=l.actualValue||'';}
    if(l.stage==='col-lost'){$('lostSection').style.display='';$('lossReason').value=l.lossReason||'';}
  } else {
    $('clientName').value='';$('phone').value='';$('email').value='';$('referredBy').value='';
    $('revType').value='Trail';$('source').value='Referral';$('temp').value='warm';$('nextAction').value='';$('leadNotes').value='';
  }
  $('leadModal').style.display='flex';
  setTimeout(()=>$('clientName').focus(),100);
}

function closeLeadModal(){$('leadModal').style.display='none';}

function submitLeadForm(){
  const prods=getSelectedProducts();
  if(!prods.length){$('noProductWarning').style.display='block';return;}
  $('noProductWarning').style.display='none';
  const id=$('editLeadId').value;
  const name=sanitize($('clientName').value);
  const phone=sanitize($('phone').value).replace(/\s+/g,'');
  const email=sanitize($('email').value);
  const referredBy=sanitize($('referredBy').value);
  const note=sanitize($('leadNotes').value);
  if(!name){alert('Client name is required.');return;}
  if(!isValidPhone(phone)){alert('Enter a valid phone number (10-15 digits).');return;}
  if(!isValidEmail(email)){alert('Enter a valid email address.');return;}
  const nextAction=$('nextAction').value;
  const data={name,phone,email,referredBy,products:prods,value:totalValue(prods),revType:$('revType').value,source:$('source').value,temp:$('temp').value,nextAction,followUpStatus:nextAction?(nextAction<todayISO()?'overdue':'scheduled'):'none',nextFollowUpDate:nextAction||'',actualValue:parseFloat($('actualValue')?.value)||0,lossReason:$('lossReason')?.value||'',lastUpdated:Date.now()};
  if(id){
    leads=leads.map(l=>{
      if(l.id!==id) return l;
      const hist=[...(l.history||[])];
      if(note) hist.unshift({date:fmtDate(Date.now()),msg:'💬 '+note});
      const merged=data.products.map(np=>{const ex=l.products?.find(ep=>ep.product===np.product);return ex?{...np,status:ex.status,actualValue:ex.actualValue}:np;});
      return {...l,...data,products:merged,history:hist};
    });
    addAudit(`Edited lead: ${name} (${id})`);
  } else {
    const newId=generateLeadID();
    const hist=[{date:fmtDate(Date.now()),msg:'🆕 Lead Created'}];
    if(note) hist.unshift({date:fmtDate(Date.now()),msg:'💬 '+note});
    leads.push(validateLead({...data,id:genId(),clientCode:newId,stage:'col-prospect',createdAt:Date.now(),stageEntryDate:Date.now(),history:hist,muted:false,deletedAt:null}));
    addAudit(`New lead: ${name} (${newId})`);
  }
  saveAll();renderLeadFlow();closeLeadModal();
}

/* ══ STAGE MOVES ══ */
function updateLeadStage(id,newStage){
  if(newStage==='col-lost'){pendingStageMove={id,newStage};$('lostModal').style.display='flex';return;}
  if(newStage==='col-won'){const l=leads.find(x=>x.id===id);pendingStageMove={id,newStage};$('wonModalRevenue').value=l?.value||'';$('wonModal').style.display='flex';return;}
  applyStageMove(id,newStage,{});
}
function confirmLost(){const reason=$('lostModalReason').value;$('lostModal').style.display='none';if(pendingStageMove)applyStageMove(pendingStageMove.id,pendingStageMove.newStage,{lossReason:reason});pendingStageMove=null;}
function confirmWon(){const rev=parseFloat($('wonModalRevenue').value)||0;$('wonModal').style.display='none';if(pendingStageMove)applyStageMove(pendingStageMove.id,pendingStageMove.newStage,{actualValue:rev});pendingStageMove=null;}
function cancelStageMove(){$('lostModal').style.display='none';$('wonModal').style.display='none';pendingStageMove=null;}
function applyStageMove(id,newStage,extras){
  leads=leads.map(l=>{
    if(l.id!==id) return l;
    const hist=[...(l.history||[])];
    hist.unshift({date:fmtDate(Date.now()),msg:`📌 Moved to ${LABELS[newStage]}`});
    let prods=l.products||[];
    if(newStage==='col-won') prods=prods.map(p=>p.status==='open'?{...p,status:'won'}:p);
    if(newStage==='col-lost') prods=prods.map(p=>p.status==='open'?{...p,status:'lost'}:p);
    return {...l,...extras,stage:newStage,lastUpdated:Date.now(),stageEntryDate:Date.now(),history:hist,products:prods};
  });
  addAudit(`Stage move: ${id} → ${LABELS[newStage]}`);
  saveAll();renderLeadFlow();
}

/* ══ PRODUCT STATUS ══ */
function setProdStatus(leadId,prodIdx,newStatus){
  const lead=leads.find(l=>l.id===leadId); if(!lead) return;
  const prod=lead.products[prodIdx]; if(!prod) return;
  if(newStatus==='won'){
    pendingProdAction={leadId,prodIdx,newStatus};
    const isSip=prod.product==='MF-SIP';
    $('prodWonDesc').textContent=`Closing: ${PEMOJI[prod.product]||''} ${prod.product} for ${lead.name}`;
    $('prodWonRevenue').value=prod.value||'';
    $('prodWonSipGroup').style.display=isSip?'':'none';
    $('prodWonAddSip').checked=isSip;
    $('prodWonSipAmt').value=prod.sipAmt||'';
    $('prodWonSipAmtGroup').style.display=isSip?'':'none';
    $('prodWonModal').style.display='flex';
  } else {applyProdStatus(leadId,prodIdx,newStatus,{});}
}

function confirmProdWon(){
  if(!pendingProdAction) return;
  const rev=parseFloat($('prodWonRevenue').value)||0;
  const addSip=$('prodWonAddSip').checked;
  const sipAmt=parseFloat($('prodWonSipAmt').value)||0;
  $('prodWonModal').style.display='none';
  if(addSip&&sipAmt>0){
    const lead=leads.find(l=>l.id===pendingProdAction.leadId);
    sipLog.push({id:genId(),date:todayISO(),client:lead?.name||'',type:'add',amount:sipAmt,note:`From won deal: ${lead?.products[pendingProdAction.prodIdx]?.product||''}`});
  }
  applyProdStatus(pendingProdAction.leadId,pendingProdAction.prodIdx,'won',{actualValue:rev});
  pendingProdAction=null;
}

function cancelProdAction(){$('prodWonModal').style.display='none';pendingProdAction=null;}

function applyProdStatus(leadId,prodIdx,newStatus,extras){
  leads=leads.map(l=>{
    if(l.id!==leadId) return l;
    const prods=[...(l.products||[])];
    prods[prodIdx]={...prods[prodIdx],status:newStatus,...(extras.actualValue!==undefined?{actualValue:extras.actualValue}:{})};
    const hist=[...(l.history||[])];
    hist.unshift({date:fmtDate(Date.now()),msg:`📦 ${prods[prodIdx].product} → ${newStatus.toUpperCase()}`});
    const allWon=prods.every(p=>p.status==='won');
    const allLost=prods.every(p=>p.status==='lost');
    let newStage=l.stage;
    if(allWon&&l.stage!=='col-won'){newStage='col-won';hist.unshift({date:fmtDate(Date.now()),msg:'✅ All products closed → Won'});}
    else if(allLost&&l.stage!=='col-lost'){newStage='col-lost';hist.unshift({date:fmtDate(Date.now()),msg:'❌ All products lost → Lost'});}
    else if(!allWon&&!allLost&&['col-won','col-lost'].includes(l.stage)){newStage='col-proposal';hist.unshift({date:fmtDate(Date.now()),msg:'🔄 Product re-opened → Proposal'});}
    return {...l,products:prods,history:hist,stage:newStage,lastUpdated:Date.now()};
  });
  saveAll();renderLeadFlow();
}

/* ══ LEAD CARD STATUS ══ */
function leadCardStatus(lead){
  const prods=lead.products||[];
  if(!prods.length) return lead.stage;
  const oc=prods.filter(p=>p.status==='open').length;
  const wc=prods.filter(p=>p.status==='won').length;
  const lc=prods.filter(p=>p.status==='lost').length;
  if(oc===prods.length) return 'all-open';
  if(wc===prods.length) return 'all-won';
  if(lc===prods.length) return 'all-lost';
  return 'partial';
}

/* ══ QUICK NOTE ══ */
function quickNote(id){
  const note=window.prompt('Quick Note:'); if(!note?.trim()) return;
  leads=leads.map(l=>{
    if(l.id!==id) return l;
    const hist=[...(l.history||[])];
    hist.unshift({date:fmtDate(Date.now()),msg:'💬 '+note.trim()});
    return {...l,lastUpdated:Date.now(),history:hist};
  });
  saveAll();renderLeadFlow();
}

/* ══ ARCHIVE / RESTORE LEAD ══ */
function archiveLead(id){if(!confirm('Archive this lead? You can restore later.'))return;leads=leads.map(l=>l.id===id?{...l,deletedAt:Date.now()}:l);addAudit(`Archived lead: ${id}`);saveAll();renderLeadFlow();}
function restoreLead(id){leads=leads.map(l=>l.id===id?{...l,deletedAt:null}:l);addAudit(`Restored lead: ${id}`);saveAll();renderLeadFlow();renderSettings();}
function toggleLeadMute(id){leads=leads.map(l=>l.id===id?{...l,muted:!l.muted}:l);saveAll();renderLeadFlow();}

/* ══ RENDER PIPELINE ══ */
function renderPipeline(){
  const search=($('searchBar')?.value||'').toLowerCase();
  const fTemp=$('filterTemp')?.value||'';
  const fSource=$('filterSource')?.value||'';
  const fStale=$('filterStale')?.checked||false;
  const showArchived=$('filterArchived')?.checked||false;
  const today=todayISO();
  const staleDays=getStaleDays();
  const todays=[];

  STAGES.forEach((stage,idx)=>{
    const staleLimit=staleDays[stage]||99;
    const filtered=leads.filter(l=>{
      if(l.stage!==stage) return false;
      if(!showArchived && l.deletedAt) return false;
      if(!l.name.toLowerCase().includes(search)) return false;
      if(fTemp&&l.temp!==fTemp) return false;
      if(fSource&&l.source!==fSource) return false;
      if(fStale){const d=daysSince(l.stageEntryDate||l.createdAt);if(d<staleLimit||stage==='col-won'||stage==='col-lost') return false;}
      return true;
    });
    const stageTotal=filtered.reduce((s,c)=>s+(stage==='col-won'?(c.actualValue||c.value):c.value),0);
    const metaEl=$(`meta-${stage}`); if(metaEl) metaEl.innerText=`₹${fmt(stageTotal)} · ${filtered.length} lead${filtered.length!==1?'s':''}`;
    const container=$(`lc-${stage}`); if(!container) return;
    container.innerHTML=filtered.map(l=>{
      const daysIn=daysSince(l.stageEntryDate||l.createdAt);
      const totalAge=daysSince(l.createdAt);
      const isStale=daysIn>=staleLimit&&!['col-won','col-lost'].includes(stage);
      const isOverdue=l.nextAction&&l.nextAction<today&&!['col-won','col-lost'].includes(stage);
      const nextStage=STAGES[idx+1];
      if(l.nextAction===today && !l.muted && !l.deletedAt) todays.push(l.name);
      const cardStatus=leadCardStatus(l);
      const ageClass=daysIn<7?'age-fresh':daysIn<21?'age-watch':'age-risk';
      const activityScore=Math.min(100,((l.history||[]).length*8)+((entries.filter(e=>(e.linkedLeadIds||[]).includes(l.id)).length)*6)+(l.nextAction?10:0)-(isOverdue?20:0));
      const isPartial=cardStatus==='partial';
      const prodRows=(l.products||[]).map((p,pi)=>`
        <div class="product-row prod-${p.status}">
          <span class="prod-emoji">${PEMOJI[p.product]||''}</span>
          <span class="prod-name">${escHtml(p.product)}</span>
          <span class="prod-val">₹${fmt(p.value)}${p.sipAmt?` · SIP ₹${fmt(p.sipAmt)}/mo`:''}</span>
          <div class="prod-status-btns">
            <button class="prod-status-btn prod-btn-open ${p.status==='open'?'active':''}" onclick="setProdStatus('${l.id}',${pi},'open')">Open</button>
            <button class="prod-status-btn prod-btn-won  ${p.status==='won' ?'active':''}" onclick="setProdStatus('${l.id}',${pi},'won')">Won</button>
            <button class="prod-status-btn prod-btn-lost ${p.status==='lost'?'active':''}" onclick="setProdStatus('${l.id}',${pi},'lost')">Lost</button>
          </div>
        </div>`).join('');
      let valDisplay=`₹${fmt(l.value)}`;
      if(stage==='col-won'&&l.actualValue){const v=l.value?Math.round(((l.actualValue-l.value)/l.value)*100):0;valDisplay=`₹${fmt(l.actualValue)} <span class="variance-badge ${v>=0?'variance-pos':'variance-neg'}">${v>=0?'+':''}${v}%</span>`;}
      const histHTML=(l.history||[]).slice(0,3).map(h=>`<div class="history-item"><span class="h-date">${h.date}:</span> ${escHtml(h.msg)}</div>`).join('');
      return `<div class="lead-card ${l.temp} ${ageClass}" draggable="true" id="${escHtml(l.id)}" data-lead-id="${escHtml(l.id)}" ondragstart="dragStart(event)" onclick="handleCardClick(event,'${escHtml(l.id)}')">
        ${isOverdue?'<div class="overdue-pulse"></div>':''}
        <div class="lead-card-top">
          <div>
            <div class="lead-name">${escHtml(l.name)}${isPartial?' <span class="partial-tag">PARTIAL</span>':''}</div>
            <div class="lead-id">🆔 ${escHtml(l.clientCode||l.id)}</div>
          </div>
          <div class="card-actions">
            <button class="icon-btn" onclick="event.stopPropagation();quickNote('${escHtml(l.id)}')" title="Note">💬</button>
            <button class="icon-btn" onclick="event.stopPropagation();openLeadModal('${escHtml(l.id)}')" title="Edit">✏️</button>
            <button class="icon-btn" onclick="event.stopPropagation();toggleLeadMute('${escHtml(l.id)}')" title="Mute alerts">${l.muted?'🔕':'🔔'}</button>
          </div>
        </div>
        <div class="lead-value">${valDisplay}</div><div style="font-size:.64rem;color:var(--text-muted);margin-bottom:4px;">Attention Index: ${activityScore}</div>
        <div>${prodRows}</div>
        <div class="tag-row">
          <span class="lead-tag source-tag">${escHtml(l.source)}</span>
          <span class="lead-tag rev-tag">${escHtml(l.revType)}</span>
          ${l.referredBy?`<span class="lead-tag ref-tag">🌿 ${escHtml(l.referredBy)}</span>`:''}
          ${l.lossReason?`<span class="lead-tag loss-tag">Lost: ${escHtml(l.lossReason)}</span>`:''}
        </div>
        ${histHTML?`<div class="history-box">${histHTML}</div>`:''}
        <div class="contact-links">
          ${l.phone?`<a href="https://wa.me/${l.phone}" target="_blank" class="contact-link" onclick="event.stopPropagation()">🟢</a>`:''}
          ${l.phone?`<a href="tel:${l.phone}" class="contact-link" onclick="event.stopPropagation()">📞</a>`:''}
          ${l.email?`<a href="mailto:${l.email}" class="contact-link" onclick="event.stopPropagation()">📧</a>`:''}
        </div>
        <div class="aging-row">
          ${isStale?`<span class="stale-badge">🕒 STUCK: ${daysIn}d (limit ${staleLimit}d)</span>`:`Stage: ${daysIn}d · Total: ${totalAge}d`}
          ${l.nextAction?`<br><span class="next-date ${isOverdue?'overdue':''}">📅 ${isOverdue?'OVERDUE':'Next'}: ${l.nextAction}</span>`:''}
        </div>
        <div class="card-footer">
          ${l.deletedAt?`<button class="btn-del" onclick="event.stopPropagation();restoreLead('${escHtml(l.id)}')">Restore</button>`:`<button class="btn-del" onclick="event.stopPropagation();archiveLead('${escHtml(l.id)}')">Archive</button>`}
          ${nextStage?`<button class="btn-next" onclick="event.stopPropagation();updateLeadStage('${escHtml(l.id)}','${nextStage}')">Next ➔</button>`:''}
        </div>
        <div class="compact-hint">Tap for full details</div>
      </div>`;
    }).join('');
  });
  const b=$('followUpBanner');
  if(b){if(todays.length){b.style.display='block';b.innerHTML=`🔔 <strong>Today's Follow-ups (${todays.length}):</strong> ${todays.join(' · ')}`;}else b.style.display='none';}
}

function handleCardClick(e,leadId){
  if(e.target.closest('button,a,input,select,textarea,label')) return;
  openLeadInfo(leadId);
}

/* ══ LEAD INFO MODAL ══ */
function openLeadInfo(leadId){
  const l=leads.find(x=>x.id===leadId); if(!l) return;
  const playbook=getLeadPlaybook(l);
  const intel=buildClientIntelligence(l.name);
  const products=(l.products||[]).map(p=>`<div class="product-row prod-${p.status}"><span class="prod-emoji">${PEMOJI[p.product]||''}</span><span class="prod-name">${escHtml(p.product)}</span><span class="prod-val">₹${fmt(p.value)}${p.sipAmt?` · SIP ₹${fmt(p.sipAmt)}/mo`:''}</span></div>`).join('');
  const history=(l.history||[]).slice(0,6).map(h=>`<div class="history-item"><span class="h-date">${escHtml(h.date)}:</span> ${escHtml(h.msg)}</div>`).join('');
  // Get related log entries mentioning this client
  const relatedLogs=entries.filter(e=>(e.linkedLeadIds||[]).includes(leadId)||(e.tags||[]).some(t=>t.toLowerCase()===l.name.toLowerCase())).slice(0,5);
  const relatedLogsHtml=relatedLogs.length?relatedLogs.map(e=>`<div class="history-item"><span class="h-date">${e.dateShort}:</span> ${escHtml(e.text.slice(0,120))}</div>`).join(''):'<p style="font-size:.75rem;color:var(--text-muted);">No log entries for this client yet.</p>';
  $('leadInfoContent').innerHTML=`
    <div style="font-size:1.05rem;font-weight:700;">${escHtml(l.name)}</div>
    <div style="display:flex;align-items:center;gap:8px;margin:4px 0 12px;flex-wrap:wrap;">
      <span class="client-id-badge">🆔 ${escHtml(l.id)}</span>
      <span style="font-size:.74rem;color:var(--text-muted);">${LABELS[l.stage]} · ${escHtml(l.source)} · ${escHtml(l.temp)}</span>
    </div>
    <div class="tag-row" style="margin-top:0;">
      <span class="lead-tag">Value: ₹${fmt(l.stage==='col-won'?(l.actualValue||l.value):l.value)}</span>
      ${l.nextAction?`<span class="lead-tag">Next: ${escHtml(l.nextAction)}</span>`:'<span class="lead-tag">Next: Not set</span>'}
      ${l.referredBy?`<span class="lead-tag ref-tag">🌿 ${escHtml(l.referredBy)}</span>`:''}
    </div>
    <div class="form-section" style="margin-top:10px;">Products</div>
    <div>${products||'<p style="font-size:.75rem;color:var(--text-muted);">No product data.</p>'}</div>
    <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;margin-top:8px;font-size:.73rem;color:var(--text-muted);">
      <strong>Client Snapshot:</strong> SIP ${intel.summary.sip.length} · Lumpsum ${intel.summary.lumpsum.length} · Life ${intel.summary.life.length} · Health ${intel.summary.health.length} · Log entries ${relatedLogs.length}
    </div>
    <div class="form-section">Recommended Next Steps</div>
    <ul style="margin:0 0 0 18px;font-size:.76rem;color:var(--text-muted);line-height:1.55;">${(playbook.length?playbook:['Capture latest objection and schedule the next action.']).map(t=>`<li>${escHtml(t)}</li>`).join('')}</ul>
    <div class="form-section">Recent History</div>
    <div style="max-height:120px;overflow-y:auto;background:var(--surface2);border-radius:8px;padding:8px 10px;">${history||'<p style="font-size:.75rem;color:var(--text-muted);">No history yet.</p>'}</div>
    <div class="form-section">📝 Related Log Entries</div>
    <div style="max-height:120px;overflow-y:auto;background:var(--surface2);border-radius:8px;padding:8px 10px;">${relatedLogsHtml}</div>
    <div class="form-btns" style="margin-top:14px;">
      <button class="btn btn-primary" onclick="openLeadModal('${escHtml(l.id)}');document.getElementById('leadInfoModal').style.display='none'">✏️ Edit Lead</button>
      <button class="btn btn-secondary" onclick="quickNote('${escHtml(l.id)}');document.getElementById('leadInfoModal').style.display='none'">💬 Add Note</button>
      ${!['col-won','col-lost'].includes(l.stage)?`<button class="btn btn-success" onclick="updateLeadStage('${escHtml(l.id)}','${STAGES[Math.min(STAGES.indexOf(l.stage)+1,STAGES.length-1)]}');document.getElementById('leadInfoModal').style.display='none'">Next ➔</button>`:''}
    </div>`;
  $('leadInfoModal').style.display='flex';
}

function getLeadPlaybook(lead){
  const tips=[];
  if(lead.temp==='hot') tips.push('Book a same-day call and lock next action before ending the conversation.');
  if(lead.temp==='cold') tips.push('Use an educational nudge (tax saving, protection gap, SIP calculator) before pitching.');
  if(lead.stage==='col-potential') tips.push('Treat as parked, not lost: add a reactivation date and one trigger message.');
  if(!lead.nextAction&&!['col-won','col-lost'].includes(lead.stage)) tips.push('No next action set — assign a specific follow-up date now.');
  if((lead.products||[]).some(p=>p.product==='MF-SIP'&&(!p.sipAmt||p.sipAmt===0))) tips.push('SIP interest detected without amount — capture expected SIP to improve forecasting.');
  if((lead.products||[]).filter(p=>p.status==='open').length>1) tips.push('Multiple products are open — prioritize one primary close first to reduce decision friction.');
  return tips.slice(0,4);
}

/* ══ DASHBOARD ══ */
function updateDashboard(){
  const t=targets;
  const aumCur=t.aumCurrent||0; const aumTgt=t.aumTarget||0;
  const sipLogNet=sipLogNetAmount();
  const sipCur=(t.sipCurrent||0)+sipLogNet; const sipTgt=t.sipTarget||0;
  const rate=t.trailRate||0.75;
  const mfMonthly=Math.round(aumCur*(rate/100)/12);
  const mfAnnual=Math.round(aumCur*(rate/100));
  const insComm=Math.round((t.insPremium||0)*((t.insRate||5)/100));
  const totalTrail=mfAnnual+insComm;
  const fyStart=t.fyStart!==undefined?t.fyStart:3;
  const now=new Date();
  let fySD=new Date(now.getFullYear(),fyStart,1);
  if(now<fySD) fySD=new Date(now.getFullYear()-1,fyStart,1);
  const fyED=new Date(fySD.getFullYear()+1,fyStart,1);
  const fyEl=$('fyLabel'); if(fyEl) fyEl.textContent=`FY ${fySD.getFullYear()}-${String(fyED.getFullYear()).slice(2)} · ${daysLeft(fyED)}d remaining`;
  const set=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
  set('dash-aum','₹'+fmtCr(aumCur)); set('dash-sip','₹'+fmt(sipCur)+'/mo');
  set('dash-trail','₹'+fmt(totalTrail)); set('dash-ins','₹'+fmtCr(t.insPremium||0));
  set('dash-aum-sub',aumTgt?`Target: ₹${fmtCr(aumTgt)}`:'Set target →');
  set('dash-sip-sub',sipTgt?`Target: ₹${fmt(sipTgt)}/mo`:'Set target →');
  set('dash-trail-sub',`Rate: ${rate}% p.a. of AUM`);
  set('dash-ins-sub',`Commission: ₹${fmt(insComm)}/yr`);
  set('trail-mf-rate',rate+'% p.a.'); set('trail-mf-monthly','₹'+fmt(mfMonthly));
  set('trail-mf-annual','₹'+fmt(mfAnnual)); set('trail-ins-comm','₹'+fmt(insComm));
  set('trail-total','₹'+fmt(totalTrail));
  setProgress('aum',aumCur,aumTgt,'gold');setProgress('sip',sipCur,sipTgt,'teal');setProgress('trail',totalTrail,t.trailTarget||0,'');
  const pm=$('pipeline-metrics');
  if(pm){
    const active=leads.filter(l=>!l.deletedAt && !['col-won','col-lost'].includes(l.stage));
    const won=leads.filter(l=>!l.deletedAt && l.stage==='col-won');
    const lost=leads.filter(l=>!l.deletedAt && l.stage==='col-lost');
    const all=active.length+won.length+lost.length;
    const conversion=all?Math.round((won.length/all)*100):0;
    const avgClose=won.length?Math.round(won.reduce((s,l)=>s+daysSince(l.createdAt),0)/won.length):0;
    const inflow30=leads.filter(l=>!l.deletedAt && daysSince(l.createdAt)<=30).length;
    const bySource={};
    leads.filter(l=>!l.deletedAt).forEach(l=>{bySource[l.source]=bySource[l.source]||{t:0,w:0};bySource[l.source].t++;if(l.stage==='col-won')bySource[l.source].w++;});
    const topSrc=Object.entries(bySource).sort((a,b)=>(b[1].w/(b[1].t||1))-(a[1].w/(a[1].t||1)))[0];
    pm.innerHTML=`<div class="lf-stat"><div class="ls-label">Conversion</div><div class="ls-val">${conversion}%</div></div>
      <div class="lf-stat"><div class="ls-label">Avg Time to Close</div><div class="ls-val">${avgClose}d</div></div>
      <div class="lf-stat"><div class="ls-label">Lead Inflow (30d)</div><div class="ls-val">${inflow30}</div></div>
      <div class="lf-stat"><div class="ls-label">Best Source</div><div class="ls-val">${topSrc?escHtml(topSrc[0]):'—'}</div><div class="ls-sub">Win rate ${topSrc?Math.round((topSrc[1].w/topSrc[1].t)*100):0}%</div></div>`;
  }
  renderSipLogWidget();
}

function setProgress(key,current,target,cls){
  const pct=target>0?Math.min(Math.round((current/target)*100),150):0;
  const bar=$('bar-'+key); const pctEl=$('pct-'+key); const leftEl=$('sub-'+key+'-left');
  if(bar){bar.style.width=Math.min(pct,100)+'%';bar.className='progress-bar-fill'+(cls?' '+cls:'')+(pct>=100?' over':'');}
  if(pctEl) pctEl.textContent=pct+'%';
  if(leftEl){if(target>0){const gap=target-current;leftEl.textContent=gap>0?`₹${fmt(Math.round(gap))} to go`:'🎉 Target exceeded!';}else leftEl.textContent='';}
}

/* ══ SIP LOG ══ */
function sipLogNetAmount(){return sipLog.reduce((s,e)=>{if(e.type==='add'||e.type==='top') return s+e.amount;if(e.type==='stop'||e.type==='reduce') return s-e.amount;return s;},0);}

function renderSipLogWidget(){
  const widget=$('sipLogWidget'); if(!widget) return;
  const last5=[...sipLog].reverse().slice(0,5);
  if(!last5.length){widget.innerHTML='<div style="font-size:.72rem;color:rgba(255,255,255,.3);padding:6px 0;">No entries yet.</div>';return;}
  widget.innerHTML=last5.map(e=>{const isAdd=e.type==='add'||e.type==='top';return `<div class="sip-log-row"><span class="sip-log-date">${e.date}</span><span class="sip-log-desc">${escHtml(SIP_TYPES[e.type]||e.type)}${e.client?' · '+escHtml(e.client):''}</span><span class="sip-log-amt ${isAdd?'add':'sub'}">${isAdd?'+':'-'}₹${fmt(e.amount)}</span></div>`;}).join('');
  const net=sipLogNetAmount();const base=targets.sipCurrent||0;const total=base+net;
  const el=$('sipLogNet');if(el) el.textContent=`Net additions: ${net>=0?'+':''}₹${fmt(net)}/mo | Book total: ₹${fmt(total)}/mo`;
}

function openSipLogModal(){
  const names=[...new Set(leads.map(l=>l.name))].filter(Boolean);
  $('clientNamesList2').innerHTML=names.map(n=>`<option value="${escHtml(n)}">`).join('');
  $('sl-date').value=todayISO();
  renderSipLogFull();
  $('sipLogModal').style.display='flex';
}

function renderSipLogFull(){
  const net=sipLogNetAmount();const base=targets.sipCurrent||0;const total=base+net;const tgt=targets.sipTarget||0;
  const tm=$('sipLogTotalModal'); if(tm) tm.textContent=`₹${fmt(total)} / month`;
  const vt=$('sipVsTarget'); if(vt){vt.textContent=tgt?`${Math.round((total/tgt)*100)}% of ₹${fmt(tgt)} target`:'No target set';vt.style.color=(tgt&&total>=tgt)?'#059669':'#d97706';}
  const list=$('sipLogFull'); if(!list) return;
  if(!sipLog.length){list.innerHTML='<p style="font-size:.78rem;color:var(--text-muted);padding:10px;">No entries yet.</p>';return;}
  list.innerHTML=[...sipLog].reverse().map((e,ri)=>{const i=sipLog.length-1-ri;const isAdd=e.type==='add'||e.type==='top';return `<div class="siplog-row"><span style="font-family:'DM Mono',monospace;font-size:.68rem;color:var(--text-dim);">${e.date}</span><span style="flex:1;padding:0 8px;font-size:.74rem;">${SIP_TYPES[e.type]||e.type}${e.client?' — '+escHtml(e.client):''}${e.note?` <em style="color:var(--text-dim)">${escHtml(e.note)}</em>`:''}</span><span style="font-family:'DM Mono',monospace;font-weight:700;font-size:.74rem;color:${isAdd?'#059669':'#dc2626'}">${isAdd?'+':'-'}₹${fmt(e.amount)}/mo</span><button class="siplog-del-btn" onclick="deleteSipEntry(${i})">🗑</button></div>`;}).join('');
}

function addSipLogEntry(){
  const date=$('sl-date').value;const client=sanitize($('sl-client').value);const type=$('sl-type').value;const amount=parseFloat($('sl-amount').value)||0;const note=sanitize($('sl-note').value);
  if(!date||!amount){alert('Please enter date and amount.');return;}
  sipLog.push({id:genId(),date,client,type,amount,note});
  $('sl-client').value='';$('sl-amount').value='';$('sl-note').value='';
  saveAll();renderSipLogFull();renderSipLogWidget();updateDashboard();updateInsights();
}

function deleteSipEntry(idx){if(!confirm('Delete this SIP entry?'))return;sipLog.splice(idx,1);saveAll();renderSipLogFull();renderSipLogWidget();updateDashboard();updateInsights();}

/* ══ TARGETS MODAL ══ */
function openTargetsModal(){
  $('t-aum-current').value=targets.aumCurrent||'';$('t-aum-target').value=targets.aumTarget||'';
  $('t-sip-current').value=targets.sipCurrent||'';$('t-sip-target').value=targets.sipTarget||'';
  $('t-trail-rate').value=targets.trailRate||0.75;$('t-trail-target').value=targets.trailTarget||'';
  $('t-ins-premium').value=targets.insPremium||'';$('t-ins-rate').value=targets.insRate||5;
  $('t-stale-prospect').value=targets.staleProspect||5;$('t-stale-contacted').value=targets.staleContacted||7;
  $('t-stale-proposal').value=targets.staleProposal||10;$('t-stale-potential').value=targets.stalePotential||21;
  $('t-fy-start').value=targets.fyStart!==undefined?targets.fyStart:3;$('t-name').value=targets.name||'';
  $('targetsModal').style.display='flex';
}

function saveTargets(){
  targets={aumCurrent:parseFloat($('t-aum-current').value)||0,aumTarget:parseFloat($('t-aum-target').value)||0,sipCurrent:parseFloat($('t-sip-current').value)||0,sipTarget:parseFloat($('t-sip-target').value)||0,trailRate:parseFloat($('t-trail-rate').value)||0.75,trailTarget:parseFloat($('t-trail-target').value)||0,insPremium:parseFloat($('t-ins-premium').value)||0,insRate:parseFloat($('t-ins-rate').value)||5,staleProspect:parseInt($('t-stale-prospect').value)||5,staleContacted:parseInt($('t-stale-contacted').value)||7,staleProposal:parseInt($('t-stale-proposal').value)||10,stalePotential:parseInt($('t-stale-potential').value)||21,fyStart:parseInt($('t-fy-start').value),name:$('t-name').value.trim()};
  saveAll();$('targetsModal').style.display='none';
  updateDashboard();updateInsights();updatePriorityIntel();
  addAudit('Targets updated');
}

/* ══ STATS / ANALYTICS ══ */
function updateStats(){
  const active=leads.filter(l=>!['col-won','col-lost'].includes(l.stage));
  const won=leads.filter(l=>l.stage==='col-won');
  const lost=leads.filter(l=>l.stage==='col-lost');
  const pipe=active.reduce((s,c)=>s+c.value,0);
  const wt=leads.reduce((s,c)=>s+c.value*PROBS[c.stage],0);
  const wonRev=won.reduce((s,c)=>s+(c.actualValue||c.value),0);
  const closed=won.length+lost.length;
  const rate=closed?(won.length/closed*100).toFixed(1):0;
  const vel=won.length?Math.floor(won.reduce((s,c)=>s+(c.lastUpdated-c.createdAt),0)/won.length/86400000):0;
  const avg=won.length?Math.round(wonRev/won.length):0;
  const reasons=lost.reduce((a,c)=>{if(c.lossReason)a[c.lossReason]=(a[c.lossReason]||0)+1;return a;},{});
  const topLoss=Object.keys(reasons).length?Object.keys(reasons).reduce((a,b)=>reasons[a]>reasons[b]?a:b):'—';
  const set=(id,v)=>{const el=$(id);if(el)el.innerText=v;};
  set('stat-pipe',`₹${fmt(pipe)}`);set('stat-weighted',`₹${fmt(Math.round(wt))}`);set('stat-won-rev',`₹${fmt(wonRev)}`);
  set('stat-rate',`${rate}%`);set('stat-velocity',`${vel} Days`);set('stat-avg',`₹${fmt(avg)}`);set('stat-loss',topLoss);
  const staleDays=getStaleDays();
  const counts=STAGES.map(s=>leads.filter(l=>l.stage===s).length);
  const maxCount=Math.max(...counts,1);
  const fv=$('funnelVisual');if(fv)fv.innerHTML=STAGES.map((s,i)=>{const drop=i>0&&counts[i-1]?Math.round(((counts[i-1]-counts[i])/counts[i-1])*100):'';return `<div class="funnel-bar-wrap"><div class="funnel-count">${counts[i]}</div><div class="funnel-bar" style="height:${Math.max(6,(counts[i]/maxCount)*70)}px;"></div><div class="funnel-label">${LABELS[s].substring(0,5)}</div>${drop!==''&&i<4?`<div class="funnel-drop">-${drop}%</div>`:''}</div>`;}).join('');
  const srcM=leads.reduce((a,l)=>{if(!a[l.source])a[l.source]={won:0,lost:0,rev:0,wt:0};a[l.source].wt+=l.value*PROBS[l.stage];if(l.stage==='col-won'){a[l.source].won++;a[l.source].rev+=(l.actualValue||l.value);}if(l.stage==='col-lost')a[l.source].lost++;return a;},{});
  const st=document.querySelector('#sourceTable tbody');if(st)st.innerHTML=Object.entries(srcM).sort((a,b)=>b[1].rev-a[1].rev).map(([src,m])=>{const wr=(m.won+m.lost)>0?((m.won/(m.won+m.lost))*100).toFixed(0)+'%':'—';return `<tr><td>${escHtml(src)}</td><td><strong>${wr}</strong></td><td>₹${fmt(m.rev)}</td><td>₹${fmt(Math.round(m.wt))}</td></tr>`;}).join('')||'<tr><td colspan="4" style="color:#94a3b8;text-align:center;padding:12px;">No data yet</td></tr>';
  const at=document.querySelector('#agingTable tbody');if(at)at.innerHTML=STAGES.map(s=>{const sl=leads.filter(l=>l.stage===s);const avgD=sl.length?(sl.reduce((sum,l)=>sum+daysSince(l.stageEntryDate||l.createdAt),0)/sl.length).toFixed(1):0;const limit=staleDays[s]||99;let h='<span style="color:#94a3b8;">—</span>';if(!['col-won','col-lost'].includes(s)){if(avgD>limit*1.5)h='<span class="health-r">🔴 High Risk</span>';else if(avgD>limit*.8)h='<span class="health-y">🟡 Warning</span>';else h='<span class="health-g">🟢 Healthy</span>';}return `<tr><td>${LABELS[s]}</td><td><strong>${avgD}d</strong></td><td>${['col-won','col-lost'].includes(s)?'—':limit+'d'}</td><td>${h}</td></tr>`;}).join('');
  const prodMap={};leads.forEach(l=>{(l.products||[]).filter(p=>p.status==='won').forEach(p=>{if(!prodMap[p.product])prodMap[p.product]={count:0,rev:0,sip:0};prodMap[p.product].count++;prodMap[p.product].rev+=(p.actualValue||p.value||0);prodMap[p.product].sip+=(p.sipAmt||0);});});
  const pmt=document.querySelector('#productMixTable tbody');if(pmt)pmt.innerHTML=Object.entries(prodMap).sort((a,b)=>b[1].rev-a[1].rev).map(([prod,m])=>`<tr><td>${PEMOJI[prod]||''} ${escHtml(prod)}</td><td>${m.count}</td><td>₹${fmt(Math.round(m.rev))}</td><td>₹${fmt(m.count?Math.round(m.rev/m.count):0)}${m.sip?`<br><span style="font-size:.6rem;color:var(--accent-teal);">SIP ₹${fmt(m.sip)}/mo</span>`:''}</td></tr>`).join('')||'<tr><td colspan="4" style="color:#94a3b8;text-align:center;padding:12px;">No won products yet</td></tr>';
  const tempData={};leads.forEach(l=>{if(!tempData[l.temp])tempData[l.temp]={total:0,won:0,rev:0};tempData[l.temp].total++;if(l.stage==='col-won'){tempData[l.temp].won++;tempData[l.temp].rev+=(l.actualValue||l.value);}});
  const twt=document.querySelector('#tempWinTable tbody');if(twt)twt.innerHTML=['hot','warm','cold'].filter(t=>tempData[t]).map(t=>{const d=tempData[t];const wr=d.total?((d.won/d.total)*100).toFixed(0)+'%':'—';return `<tr><td>${{hot:'🔴',warm:'🟠',cold:'🔵'}[t]} ${t}</td><td>${d.total}</td><td>${d.won}</td><td><strong>${wr}</strong></td><td>₹${fmt(d.rev)}</td></tr>`;}).join('')||'<tr><td colspan="5" style="color:#94a3b8;text-align:center;padding:12px;">No data yet</td></tr>';
  const months=[];for(let i=5;i>=0;i--){const d=new Date();d.setMonth(d.getMonth()-i);months.push({label:d.toLocaleString('en-IN',{month:'short',year:'2-digit'}),y:d.getFullYear(),m:d.getMonth()});}
  const wonLeads=leads.filter(l=>l.stage==='col-won');
  const monthlyRevs=months.map(mo=>wonLeads.filter(l=>{const d=new Date(l.lastUpdated||l.createdAt);return d.getFullYear()===mo.y&&d.getMonth()===mo.m;}).reduce((s,l)=>s+(l.actualValue||l.value),0));
  const maxRev=Math.max(...monthlyRevs,1);
  const mc=$('monthlyChart');if(mc)mc.innerHTML=`<div style="display:flex;align-items:flex-end;gap:6px;height:80px;">${months.map((mo,i)=>`<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;"><div style="font-size:.58rem;font-weight:700;color:var(--text);font-family:'DM Mono',monospace;">${monthlyRevs[i]>0?'₹'+fmtCr(monthlyRevs[i]):''}</div><div style="width:100%;background:${monthlyRevs[i]>0?'var(--primary)':'var(--surface3)'};border-radius:4px 4px 0 0;height:${Math.max(4,(monthlyRevs[i]/maxRev)*60)}px;"></div><div style="font-size:.56rem;color:var(--text-muted);text-align:center;">${mo.label}</div></div>`).join('')}</div>`;
}

/* ══ INSIGHTS ══ */
function updateInsights(){
  const el=$('insightItems'); if(!el) return;
  const insights=[];
  const active=leads.filter(l=>!['col-won','col-lost'].includes(l.stage));
  const won=leads.filter(l=>l.stage==='col-won');
  const lost=leads.filter(l=>l.stage==='col-lost');
  const today=todayISO();const staleDays=getStaleDays();
  const overdueLeads=active.filter(l=>l.nextAction&&l.nextAction<today);
  if(overdueLeads.length) insights.push({type:'danger',text:`<strong>${overdueLeads.length} lead${overdueLeads.length>1?'s are':' is'} overdue</strong> for follow-up: ${overdueLeads.slice(0,2).map(l=>l.name).join(', ')}. Act today!`});
  const staleLeads=active.filter(l=>daysSince(l.stageEntryDate||l.createdAt)>=(staleDays[l.stage]||7));
  if(staleLeads.length) insights.push({type:'warn',text:`<strong>${staleLeads.length} lead${staleLeads.length>1?'s are':' is'} stuck</strong> beyond your configured threshold. Push forward or close.`});
  const partialLeads=leads.filter(l=>leadCardStatus(l)==='partial');
  if(partialLeads.length) insights.push({type:'info',text:`<strong>${partialLeads.length} client${partialLeads.length>1?'s have':' has'} partially closed deals</strong>. Review open products.`});
  const potentialLeads=leads.filter(l=>l.stage==='col-potential');
  if(potentialLeads.length){const pv=potentialLeads.reduce((s,l)=>s+l.value,0);insights.push({type:'info',text:`<strong>Potential bucket has ${potentialLeads.length} lead(s)</strong> worth ₹${fmtCr(pv)}. Re-activate 2 every week.`});}
  const closed=won.length+lost.length;
  if(closed>=3){const wr=Math.round((won.length/closed)*100);if(wr>=60)insights.push({type:'good',text:`<strong>Win rate: ${wr}%</strong> — excellent! Top source: ${topSource(won)}.`});else if(wr<30)insights.push({type:'danger',text:`<strong>Win rate only ${wr}%</strong>. Top loss: <strong>${topLossReason()}</strong>. Adjust approach.`});else insights.push({type:'info',text:`<strong>Win rate: ${wr}%</strong>. ${won.length} won, ${lost.length} lost.`});}
  const pipe=active.reduce((s,l)=>s+l.value,0);const weighted=leads.reduce((s,l)=>s+l.value*PROBS[l.stage],0);
  if(pipe>0) insights.push({type:'info',text:`<strong>Live pipeline: ₹${fmtCr(pipe)}</strong> across ${active.length} leads. Weighted: <strong>₹${fmtCr(Math.round(weighted))}</strong>.`});
  if(targets.aumTarget>0&&targets.aumCurrent>0){const gap=targets.aumTarget-targets.aumCurrent;if(gap>0)insights.push({type:'info',text:`<strong>AUM gap: ₹${fmtCr(gap)}</strong> to reach target.`});else insights.push({type:'good',text:'🎉 <strong>AUM target achieved!</strong> Set a higher goal!'});}
  const hotNoDate=active.filter(l=>l.temp==='hot'&&!l.nextAction);
  if(hotNoDate.length) insights.push({type:'warn',text:`<strong>${hotNoDate.length} hot lead(s)</strong> without follow-up date. Set one now!`});
  const sipLogNet=sipLogNetAmount();const sipTotal=(targets.sipCurrent||0)+sipLogNet;const sipTgt=targets.sipTarget||0;
  if(sipLogNet!==0) insights.push({type:sipLogNet>0?'good':'warn',text:`<strong>SIP log net ${sipLogNet>0?'addition':'reduction'}: ₹${fmt(Math.abs(sipLogNet))}/mo</strong>. Book: ₹${fmt(sipTotal)}/mo${sipTgt?` (${Math.round((sipTotal/sipTgt)*100)}% of target)`:''}.`});
  if(!insights.length) insights.push({type:'info',text:'Add leads and set your targets to see personalised insights here.'});
  el.innerHTML=insights.map(i=>`<div class="insight-item ${i.type}">${i.text}</div>`).join('');
}

function topSource(wonLeads){if(!wonLeads.length)return'—';const c=wonLeads.reduce((a,l)=>{a[l.source]=(a[l.source]||0)+1;return a;},{});return Object.keys(c).reduce((a,b)=>c[a]>c[b]?a:b,'—');}
function topLossReason(){const lost=leads.filter(l=>l.stage==='col-lost'&&l.lossReason);if(!lost.length)return'—';const c=lost.reduce((a,l)=>{a[l.lossReason]=(a[l.lossReason]||0)+1;return a;},{});return Object.keys(c).reduce((a,b)=>c[a]>c[b]?a:b,'—');}

/* ══ PORTFOLIO ══ */
function getClientPortfolio(){
  const map={};
  leads.forEach(l=>{const key=l.name.trim().toLowerCase();if(!map[key])map[key]={name:l.name,leads:[],phone:l.phone,email:l.email,id:l.id};map[key].leads.push(l);});
  return Object.values(map).sort((a,b)=>a.name.localeCompare(b.name));
}

function renderPortfolio(){
  const clients=getClientPortfolio();
  const grid=$('portfolioGrid'); if(!grid) return;
  clientDetailIndex={};
  if(!clients.length){grid.innerHTML='<p style="font-size:.78rem;color:var(--text-muted);">Add leads to see client portfolio cards here. Each lead you add becomes a client profile.</p>';return;}
  const search=($('portfolio-search')?.value||'').toLowerCase();
  const filtered=clients.filter(c=>!search||c.name.toLowerCase().includes(search));
  grid.innerHTML=filtered.map(c=>{
    const detailKey=safeId(c.name); clientDetailIndex[detailKey]=c;
    const allProds=[];c.leads.forEach(l=>{(l.products||[]).forEach(p=>{allProds.push({...p,leadId:l.id,leadStage:l.stage});});});
    const openProds=allProds.filter(p=>p.status==='open');const wonProds=allProds.filter(p=>p.status==='won');const lostProds=allProds.filter(p=>p.status==='lost');
    const totalVal=allProds.reduce((s,p)=>s+(p.value||0),0);const wonVal=wonProds.reduce((s,p)=>s+(p.actualValue||p.value||0),0);const sipMonthly=wonProds.filter(p=>p.product==='MF-SIP').reduce((s,p)=>s+(p.sipAmt||0),0);
    let badgeClass='closed',badgeText='Closed';
    if(openProds.length&&(wonProds.length||lostProds.length)){badgeClass='partial';badgeText='Partial';}else if(openProds.length){badgeClass='active';badgeText='Active';}
    const referrals=leads.filter(l=>l.referredBy?.trim().toLowerCase()===c.name.trim().toLowerCase());
    const prodRows=allProds.map(p=>`<div class="portfolio-prod-row"><span class="portfolio-prod-name">${PEMOJI[p.product]||''} ${escHtml(p.product)}</span><span style="font-size:.63rem;color:var(--text-muted);">₹${fmt(p.value)}</span><span class="portfolio-prod-status ${p.status}">${p.status.toUpperCase()}</span></div>`).join('');
    const primaryId=c.leads.sort((a,b)=>a.createdAt-b.createdAt)[0]?.id||'—';
    // Count related log entries
    const logCount=entries.filter(e=>(e.linkedLeadIds||[]).some(lid=>c.leads.find(l=>l.id===lid))||
      (e.tags||[]).some(t=>t.toLowerCase()===c.name.toLowerCase())).length;
    return `<div class="portfolio-card">
      <div class="portfolio-card-header">
        <div>
          <div class="portfolio-client-name">${escHtml(c.name)}</div>
          <div class="portfolio-client-meta">${c.leads.length} deal${c.leads.length!==1?'s':''} · ${allProds.length} product${allProds.length!==1?'s':''}</div>
          <div style="margin-top:4px;"><span class="client-id-badge">🆔 ${escHtml(primaryId)}</span></div>
          ${logCount>0?`<div style="font-size:.63rem;color:var(--accent-teal);margin-top:3px;">📝 ${logCount} log entr${logCount===1?'y':'ies'}</div>`:''}
        </div>
        <span class="portfolio-badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="portfolio-products">${prodRows}</div>
      ${sipMonthly>0?`<div style="font-size:.68rem;background:rgba(5,46,22,.5);border:1px solid #bbf7d044;border-radius:5px;padding:4px 8px;margin:4px 0;color:#6ee7b7;font-weight:600;">🔄 SIP: ₹${fmt(sipMonthly)}/mo</div>`:''}
      ${referrals.length?`<div class="portfolio-ref">🌿 Referred: ${referrals.map(r=>escHtml(r.name)).join(', ')}</div>`:''}
      <div class="portfolio-total"><span class="portfolio-total-label">Total Pipeline</span><span class="portfolio-total-val">₹${fmt(totalVal)}</span></div>
      ${wonVal>0?`<div class="portfolio-total" style="margin-top:2px;"><span class="portfolio-total-label" style="color:#059669;">Won Value</span><span class="portfolio-total-val" style="color:#059669;">₹${fmt(wonVal)}</span></div>`:''}
      <div class="portfolio-actions">
        <button class="portfolio-btn" onclick="openLeadModal('${c.leads[0].id}')">✏️ Edit</button>
        ${c.phone?`<a href="https://wa.me/${c.phone}" target="_blank" class="portfolio-btn" style="text-decoration:none;">🟢 WhatsApp</a>`:''}
        <button class="portfolio-btn" onclick="showClientDetail('${detailKey}')">📋 Details</button>
      </div>
    </div>`;
  }).join('');
}

function renderPortfolioFiltered(){renderPortfolio();}

/* ══ CLIENT DETAIL ══ */
function buildClientIntelligence(clientName){
  const grouped=getClientPortfolio().find(c=>c.name.trim().toLowerCase()===String(clientName||'').trim().toLowerCase());
  const leadsList=grouped?.leads||[];
  const products=[];leadsList.forEach(l=>(l.products||[]).forEach(p=>products.push({...p,stage:l.stage})));
  const summary={sip:products.filter(p=>p.product==='MF-SIP'),lumpsum:products.filter(p=>p.product==='MF-Lumpsum'),life:products.filter(p=>p.product==='Life Insurance'),health:products.filter(p=>p.product==='Health Insurance')};
  const openProducts=products.filter(p=>p.status==='open');const wonProducts=products.filter(p=>p.status==='won');
  const today=todayISO();
  const stalledLeads=leadsList.filter(l=>daysSince(l.stageEntryDate||l.createdAt)>=(getStaleDays()[l.stage]||7)&&!['col-won','col-lost'].includes(l.stage));
  const overdueLeads=leadsList.filter(l=>l.nextAction&&l.nextAction<today);
  const notes=leadsList.flatMap(l=>(l.history||[]).map(h=>String(h.msg||''))).filter(Boolean);
  const noteText=notes.join(' ').toLowerCase();
  const tips=[];
  if(summary.sip.length&&summary.lumpsum.length) tips.push('Client has both SIP and Lumpsum interest — core-satellite strategy.');
  else if(summary.sip.length) tips.push('SIP-only profile — anchor on goal-based monthly discipline and step-up.');
  else if(summary.lumpsum.length) tips.push('Lumpsum-first profile — discuss staggered deployment and risk-managed entry.');
  if(summary.life.length&&!summary.health.length) tips.push('Life insurance interest but health cover missing — propose base mediclaim.');
  if(summary.health.length&&!summary.life.length) tips.push('Health cover interest but life cover missing — review income-protection gap.');
  if(openProducts.length>=2) tips.push('Multiple open products — prioritize one conversion first, then cross-sell.');
  if(overdueLeads.length) tips.push(`${overdueLeads.length} follow-up(s) are overdue — reset commitment date.`);
  if(stalledLeads.length) tips.push(`${stalledLeads.length} lead(s) are stale — decide move forward or close-lost.`);
  if(/tax|80c|saving/.test(noteText)) tips.push('Notes signal: tax-planning intent seen.');
  if(/retire|pension/.test(noteText)) tips.push('Notes signal: retirement planning discussion active.');
  return {leadsList,summary,openProducts,wonProducts,stalledLeads,overdueLeads,noteCount:notes.length,tips:[...new Set(tips)].slice(0,8)};
}

function showClientDetail(clientKey){
  const c=clientDetailIndex[clientKey]||getClientPortfolio().find(x=>safeId(x.name)===clientKey);
  if(!c) return;
  const intel=buildClientIntelligence(c.name);
  const allHist=[...c.leads.flatMap(l=>(l.history||[]).map(h=>({...h,lead:l.name})))].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const primaryId=c.leads.sort((a,b)=>a.createdAt-b.createdAt)[0]?.id||'—';
  // Related log entries
  const relatedLogs=entries.filter(e=>
    (e.linkedLeadIds||[]).some(lid=>c.leads.find(l=>l.id===lid))||
    (e.tags||[]).some(t=>t.toLowerCase()===c.name.toLowerCase())
  ).slice(0,10);
  $('clientModalContent').innerHTML=`
    <div style="font-size:1.05rem;font-weight:700;margin-bottom:2px;">${escHtml(c.name)}</div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
      <span class="client-id-badge">🆔 ${escHtml(primaryId)}</span>
      ${c.phone?`<span style="font-size:.74rem;color:var(--text-muted);">📞 ${c.phone}</span>`:''}
      ${c.email?`<span style="font-size:.74rem;color:var(--text-muted);">📧 ${c.email}</span>`:''}
    </div>
    <div class="form-section" style="margin-top:0">Products &amp; Status</div>
    ${c.leads.map(l=>`
      <div style="background:var(--surface2);border-radius:8px;padding:10px 12px;margin-bottom:8px;">
        <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px;">${LABELS[l.stage]} · ${l.source} · ${l.temp} · <span class="client-id-badge" style="font-size:.6rem;">${l.id}</span></div>
        ${(l.products||[]).map((p,pi)=>`
          <div class="product-row prod-${p.status}">
            <span class="prod-emoji">${PEMOJI[p.product]||''}</span>
            <span class="prod-name">${escHtml(p.product)}</span>
            <span class="prod-val">₹${fmt(p.value)}${p.sipAmt?` · SIP ₹${fmt(p.sipAmt)}/mo`:''}</span>
            <div class="prod-status-btns">
              <button class="prod-status-btn prod-btn-open ${p.status==='open'?'active':''}" onclick="setProdStatus('${l.id}',${pi},'open')">Open</button>
              <button class="prod-status-btn prod-btn-won ${p.status==='won'?'active':''}" onclick="setProdStatus('${l.id}',${pi},'won');document.getElementById('clientModal').style.display='none'">Won</button>
              <button class="prod-status-btn prod-btn-lost ${p.status==='lost'?'active':''}" onclick="setProdStatus('${l.id}',${pi},'lost');document.getElementById('clientModal').style.display='none'">Lost</button>
            </div>
          </div>`).join('')}
      </div>`).join('')}
    <div class="form-section">Client Intelligence</div>
    <div style="background:var(--surface2);border-radius:8px;padding:10px 12px;font-size:.74rem;line-height:1.55;color:var(--text-muted);margin-bottom:10px;">
      <div><strong>Product Mix:</strong> SIP ${intel.summary.sip.length} · Lumpsum ${intel.summary.lumpsum.length} · Life ${intel.summary.life.length} · Health ${intel.summary.health.length}</div>
      <div><strong>Execution:</strong> Open ${intel.openProducts.length} · Won ${intel.wonProducts.length} · Notes ${intel.noteCount} · Log entries ${relatedLogs.length}</div>
      ${intel.tips.length?`<ul style="margin:8px 0 0 16px;">${intel.tips.map(t=>`<li>${escHtml(t)}</li>`).join('')}</ul>`:''}
    </div>
    <div class="form-section">Activity History</div>
    <div style="max-height:140px;overflow-y:auto;background:var(--surface2);border-radius:8px;padding:8px 10px;">
      ${allHist.slice(0,20).map(h=>`<div class="history-item"><span class="h-date">${h.date}:</span> ${escHtml(h.msg)}</div>`).join('')||'<p style="font-size:.75rem;color:var(--text-muted);">No history yet.</p>'}
    </div>
    <div class="form-section">📝 Log Entries (Power Log)</div>
    <div style="max-height:120px;overflow-y:auto;background:var(--surface2);border-radius:8px;padding:8px 10px;">
      ${relatedLogs.length?relatedLogs.map(e=>`<div class="history-item"><span class="h-date">${e.dateShort}:</span> ${escHtml(e.text.slice(0,120))}</div>`).join(''):'<p style="font-size:.75rem;color:var(--text-muted);">No log entries yet. Use #clientname in the Log to link entries.</p>'}
    </div>`;
  $('clientModal').style.display='flex';
}

/* ══ REFERRAL TREE ══ */
function renderReferralTree(){
  const byReferrer={};const referred=new Set();
  leads.forEach(l=>{if(l.referredBy?.trim()){const key=l.referredBy.trim().toLowerCase();if(!byReferrer[key])byReferrer[key]={name:l.referredBy.trim(),children:[]};byReferrer[key].children.push(l);referred.add(l.name.trim().toLowerCase());}});
  const content=$('refTreeContent'); if(!content) return;
  const statsEl=$('refStatsRow');
  if(!Object.keys(byReferrer).length){content.innerHTML='<p style="font-size:.78rem;color:var(--text-muted);">No referral chains yet. Fill in "Referred By" when adding a lead.</p>';if(statsEl)statsEl.innerHTML='';return;}
  const totalReferred=leads.filter(l=>l.referredBy?.trim()).length;
  const refWon=leads.filter(l=>l.referredBy?.trim()&&l.stage==='col-won').length;
  const refRevenue=leads.filter(l=>l.referredBy?.trim()&&l.stage==='col-won').reduce((s,l)=>s+(l.actualValue||l.value),0);
  const topReferrer=Object.values(byReferrer).reduce((a,b)=>b.children.length>a.children.length?b:a,{name:'—',children:[]});
  if(statsEl)statsEl.innerHTML=`<div class="ref-stat"><div class="ref-stat-val">${totalReferred}</div><div class="ref-stat-label">Referred</div></div><div class="ref-stat"><div class="ref-stat-val">${refWon}</div><div class="ref-stat-label">Converted</div></div><div class="ref-stat"><div class="ref-stat-val">₹${fmtCr(refRevenue)}</div><div class="ref-stat-label">Ref Revenue</div></div><div class="ref-stat"><div class="ref-stat-val">${escHtml(topReferrer.name==='—'?'—':topReferrer.name.split(' ')[0])}</div><div class="ref-stat-label">Top Referrer</div></div>`;
  content.innerHTML=Object.values(byReferrer).map(r=>{
    const rootLead=leads.find(l=>l.name.trim().toLowerCase()===r.name.trim().toLowerCase());
    const rootBadge=rootLead?`<span class="ref-badge">${LABELS[rootLead.stage]}</span>`:'<span class="ref-badge" style="background:#f3e8ff22;color:#c4b5fd;">Existing Client</span>';
    const childRows=r.children.map(child=>{const grandKey=child.name.trim().toLowerCase();const grandchildren=(byReferrer[grandKey]||{children:[]}).children;const gcRows=grandchildren.length?`<div class="ref-grandchild">${grandchildren.map(gc=>`<div class="ref-grandchild-row">${escHtml(gc.name)} <span class="ref-badge">${LABELS[gc.stage]}</span></div>`).join('')}</div>`:'';return `<div style="margin-bottom:2px;"><div class="ref-child">${escHtml(child.name)} <span class="ref-badge">${LABELS[child.stage]}</span> <span style="font-size:.6rem;color:var(--text-dim);">₹${fmt(child.value)}</span></div>${gcRows}</div>`;}).join('');
    return `<div style="padding:10px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);margin-bottom:8px;"><div class="ref-node-name">🌟 ${escHtml(r.name)} ${rootBadge}</div><div class="ref-node-meta">Referred ${r.children.length} client${r.children.length!==1?'s':''} · ₹${fmt(r.children.reduce((s,c)=>s+c.value,0))} pipeline</div><div class="ref-children">${childRows}</div></div>`;
  }).join('');
}

/* ══ CLIENTS TAB ══ */
function renderClientsTab(){
  const search=($('clients-search')?.value||'').toLowerCase();
  const el=$('clients-tab-list'); if(!el) return;
  const clients=getClientPortfolio().filter(c=>!search||(c.name.toLowerCase().includes(search)||(c.leads[0]?.id||'').toLowerCase().includes(search)));
  if(!clients.length){el.innerHTML='<div style="text-align:center;padding:24px;color:var(--text-dim);">No clients found.</div>';return;}
  el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">${clients.map(c=>{
    const primaryId=c.leads.sort((a,b)=>a.createdAt-b.createdAt)[0]?.id||'—';
    const allProds=c.leads.flatMap(l=>l.products||[]);
    const wonVal=allProds.filter(p=>p.status==='won').reduce((s,p)=>s+(p.actualValue||p.value||0),0);
    const pipeline=allProds.filter(p=>p.status==='open').reduce((s,p)=>s+(p.value||0),0);
    const detailKey=safeId(c.name); clientDetailIndex[detailKey]=c;
    const logCount=entries.filter(e=>(e.linkedLeadIds||[]).some(lid=>c.leads.find(l=>l.id===lid))||(e.tags||[]).some(t=>t.toLowerCase()===c.name.toLowerCase())).length;
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <div>
          <div style="font-weight:700;font-size:.88rem;">${escHtml(c.name)}</div>
          <div style="margin-top:3px;"><span class="client-id-badge">🆔 ${escHtml(primaryId)}</span></div>
        </div>
        <div style="text-align:right;font-size:.7rem;color:var(--text-muted);">${c.leads.length} deal${c.leads.length!==1?'s':''}</div>
      </div>
      ${c.phone?`<div style="font-size:.72rem;color:var(--text-muted);">📞 ${c.phone}</div>`:''}
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;font-size:.72rem;">
        ${pipeline>0?`<span style="color:var(--accent-amber);">Pipeline: ₹${fmt(pipeline)}</span>`:''}
        ${wonVal>0?`<span style="color:var(--accent-green);">Won: ₹${fmt(wonVal)}</span>`:''}
        ${logCount>0?`<span style="color:var(--accent-teal);">📝 ${logCount} log${logCount===1?'':'s'}</span>`:''}
      </div>
      <div style="display:flex;gap:5px;margin-top:8px;flex-wrap:wrap;">
        ${c.phone?`<a href="https://wa.me/${c.phone}" target="_blank" class="portfolio-btn" style="text-decoration:none;font-size:.68rem;padding:3px 8px;">🟢 WhatsApp</a>`:''}
        <button class="portfolio-btn" onclick="showClientDetail('${detailKey}')" style="font-size:.68rem;padding:3px 8px;">📋 Details</button>
        <button class="portfolio-btn" onclick="openLeadModal('${c.leads[0].id}')" style="font-size:.68rem;padding:3px 8px;">✏️ Edit</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

/* ══ SETTINGS ══ */
function renderSettings(){
  const ts=$('targets-summary');
  const dm=$('darkModeToggle'); if(dm) dm.checked=!!prefs.darkMode;
  if(ts) ts.innerHTML=targets.name?`<strong>${escHtml(targets.name)}</strong> · AUM: ₹${fmtCr(targets.aumCurrent||0)} (Target: ₹${fmtCr(targets.aumTarget||0)}) · SIP: ₹${fmt(targets.sipCurrent||0)}/mo`:'No targets set yet.';
  const al=$('audit-log-display');
  if(al) al.innerHTML=auditLog.slice(0,20).map(a=>`<div class="audit-item">${new Date(a.ts).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})} — ${escHtml(a.msg)}</div>`).join('')||'<div class="audit-item" style="color:var(--text-dim);">No audit events yet.</div>';
  const si=$('storage-info');
  if(si){
    let total=0;
    [PS_KEY,LF_KEY,TGT_KEY,SIP_KEY,GOALS_KEY,REVIEWS_KEY,PREF_KEY].forEach(k=>{const v=localStorage.getItem(k)||'';total+=v.length;});
    si.innerHTML=`Entries: ${entries.length} · Leads: ${leads.filter(l=>!l.deletedAt).length} (Archived: ${leads.filter(l=>l.deletedAt).length}) · SIP Entries: ${sipLog.length} · Goals: ${goals.length} · Reviews: ${reviews.length}<br>Approx storage used: ${(total/1024).toFixed(1)} KB`;
  }
  const ar=$('archived-leads');
  if(ar){
    const archived=leads.filter(l=>l.deletedAt);
    ar.innerHTML=archived.length?archived.map(l=>`<div class="audit-item">${escHtml(l.name)} · ${escHtml(l.clientCode||l.id)} <button class="portfolio-btn" onclick="restoreLead('${escHtml(l.id)}')" style="margin-left:8px;font-size:.66rem;">Restore</button></div>`).join(''):'No archived leads.';
  }
}

/* ══ DRAG & DROP ══ */
let dragId=null;
function dragStart(e){dragId=e.target.closest('[data-lead-id]')?.dataset.leadId;e.target.closest('.lead-card')?.classList.add('dragging');}
function allowDrop(e){e.preventDefault();e.currentTarget.classList.add('drag-over');}
function dropCard(e){
  e.preventDefault();document.querySelectorAll('.column').forEach(c=>c.classList.remove('drag-over'));
  const col=e.currentTarget;
  if(col&&dragId) updateLeadStage(dragId,col.id);
  dragId=null;
}
document.addEventListener('dragend',e=>{e.target.closest('.lead-card')?.classList.remove('dragging');document.querySelectorAll('.column').forEach(c=>c.classList.remove('drag-over'));});

/* ══ SCROLL PIPELINE ══ */
function scrollToStage(stageId,btn){
  document.querySelectorAll('.stage-pill').forEach(p=>p.classList.remove('active'));btn.classList.add('active');
  const el=$(stageId); if(!el) return;
  $('pipelineWrapper')?.scrollTo({left:el.offsetLeft-8,behavior:'smooth'});
}

/* ══ KEYBOARD SHORTCUTS ══ */
document.addEventListener('keydown',e=>{
  const tag=document.activeElement?.tagName||'';
  if(['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
  if(e.key==='n'&&!e.ctrlKey&&!e.metaKey) openLeadModal();
  if(e.key==='Escape'){
    ['leadModal','targetsModal','sipLogModal','lostModal','wonModal','prodWonModal','clientModal','leadInfoModal','goalModal'].forEach(id=>{const el=$(id);if(el)el.style.display='none';});
  }
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&document.activeElement?.id==='content')saveEntry();});

// Close modals on overlay click
['leadModal','targetsModal','sipLogModal','lostModal','wonModal','prodWonModal','clientModal','leadInfoModal','goalModal'].forEach(id=>{
  const el=$(id); if(!el) return;
  el.addEventListener('click',function(e){if(e.target===this)this.style.display='none';});
});

// prodWonAddSip toggle
document.addEventListener('change',function(e){if(e.target.id==='prodWonAddSip'){const grp=$('prodWonSipAmtGroup');if(grp)grp.style.display=e.target.checked?'':'none';}});

/* ══ RENDER ALL ══ */
function renderAll(){
  renderEntries();
  renderStatsPanel();
  updatePriorityIntel();
  updateReminders();
  renderBiKpis();
  updateStrategicInsight();
  renderGoalDisplay();
  updateLogClientOptions();
  renderSettings();
  // Only render the active LeadFlow sub-tab to avoid hidden canvas issues
  const lfTabActive=document.querySelector('#tab-leadflow.active');
  if(lfTabActive) renderLeadFlow();
}

/* ══ INIT ══ */
function init(){
  loadAll();
  applyTheme();
  const rd=$('review-date'); if(rd) rd.value=todayISO();
  renderAll();
  // Also pre-render LeadFlow so data is ready when user navigates there
  renderPipeline();
  updateDashboard();
  renderPortfolio();
  renderReferralTree();
  updateInsights();
  updateStats();
  setInterval(updateReminders,60000);
  scheduleAutoBackup();
  updateBackupUI();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden) updateReminders();});
}

// Delegate tag suggestion click safely
document.addEventListener('click',e=>{
  const btn=e.target.closest('#tag-suggest .tag-chip');
  if(btn) insertTag(btn.dataset.tag||'');
});

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
else init();