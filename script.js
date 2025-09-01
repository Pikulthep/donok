/* ========================= script.js (GitHub Pages mode) =========================
   - อ่าน channels.json
   - จัด player ให้อยู่กึ่งกลาง (อาศัย CSS ใหม่)
   - ตัดหมวด "ทั้งหมด" ออกไปจากระบบ (ไม่มีการสร้าง/อ้างอิง)
================================================================================= */

const CHANNELS_URL = 'channels.json';
const TIMEZONE = 'Asia/Bangkok';
const PROXY_BASE = (window.PROXY_BASE || '').replace(/\/$/, '');

const tabsEl   = document.getElementById('tabs');
const listEl   = document.getElementById('channel-list');
const videoEl  = document.getElementById('player');
const statusEl = document.getElementById('player-status');
const nowEl    = document.getElementById('now-playing');
const clockEl  = document.getElementById('clock');
const refreshBtn = document.getElementById('refresh-btn');

let channelsRaw = null;
let channels    = [];
let categories  = [];     // ไม่มี "ทั้งหมด" แล้ว
let currentIdx  = -1;
let hls = null;
let lastRefreshTs = 0;

// ---------- Utils ----------
const sleep   = (ms)=> new Promise(r=>setTimeout(r, ms));
const fmtTime = (d)=> d.toLocaleString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:TIMEZONE});
function tickClock(){ if (clockEl) clockEl.textContent = fmtTime(new Date()); }
setInterval(tickClock, 1000); tickClock();

function showStatus(msg, isError=false){
  if (!statusEl) return;
  statusEl.textContent = msg || '';
  statusEl.hidden = !msg;
  statusEl.classList.toggle('error', !!isError);
}
function bust(url){ const u = new URL(url, location.href); u.searchParams.set('_', Date.now().toString(36)); return u.toString(); }
function wrapIfProxy(u){
  if (!PROXY_BASE) return u;
  const v = new URL(PROXY_BASE);
  v.pathname = v.pathname.replace(/\/+$/,'') + '/api/p';
  v.searchParams.set('u', u);
  return v.toString();
}
function extractBackups(o){
  const cand = o.backups || o.backup || o.alts || o.sources || [];
  return Array.isArray(cand) ? cand.map(s => (typeof s==='string'?{url:s}:s)).filter(Boolean) : [];
}
function normalizeOne(id, o){
  const url = o.src || o.url || '';
  return { id,
    name:o.name || id, logo:o.logo||'', category:o.category||'อื่นๆ',
    url, type:o.type || (String(url).endsWith('.mpd')?'dash':'hls'),
    drm:o.drm||null, backups:extractBackups(o), badge:o.badge||'' };
}
function normalizeAll(raw){
  const out = [];
  if (Array.isArray(raw)) raw.forEach((o,i)=> out.push(normalizeOne(o.id||String(i), o)));
  else if (raw && typeof raw==='object') Object.keys(raw).forEach(k=> out.push(normalizeOne(k, raw[k])));
  return out;
}
function buildCategories(){
  const set = new Set(channels.map(c => c.category || 'อื่นๆ'));
  categories = Array.from(set).sort((a,b)=>a.localeCompare(b,'th')); // ไม่มี 'ทั้งหมด'
}
function tileHTML(c){
  const badge = c.badge ? `<span class="badge">${c.badge}</span>` : '';
  const logo  = c.logo ? `<img loading="lazy" src="${c.logo}" alt="">` : '<div class="no-logo"></div>';
  return `<div class="channel-tile" data-id="${c.id}">
    <div class="channel-logo-wrapper">${logo}${badge}</div>
    <div class="channel-name">${c.name}</div>
  </div>`;
}
function renderTabs(){
  tabsEl.innerHTML = '';
  categories.forEach((cat, i) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.textContent = cat;
    b.dataset.cat = cat;
    if (i === 0) b.classList.add('active');
    b.addEventListener('click', () => {
      tabsEl.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      renderList(cat);
    });
    tabsEl.appendChild(b);
  });
}
function renderList(cat){
  const useCat = cat || categories[0] || null;
  const filtered = useCat ? channels.filter(c => c.category === useCat) : channels;
  listEl.innerHTML = filtered.map(tileHTML).join('');
  listEl.querySelectorAll('.channel-tile').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const idx = channels.findIndex(x => x.id === id);
      playByIndex(idx, true);
    });
  });
  // auto play ช่องแรกของหมวดแรก
  if (filtered.length && currentIdx < 0) {
    const firstIdx = channels.findIndex(x => x.id === filtered[0].id);
    playByIndex(firstIdx, false);
  }
}
async function fetchChannels(){
  if (!listEl.dataset.loading){
    listEl.dataset.loading='1';
    listEl.innerHTML = Array.from({length:18}).map(()=>(
      `<div class="channel-tile skeleton">
        <div class="channel-logo-wrapper"><div class="no-logo" style="width:70%;height:38px"></div></div>
        <div class="channel-name muted">loading…</div>
      </div>`
    )).join('');
  }
  const res = await fetch(bust(CHANNELS_URL), { cache:'no-store' });
  if (!res.ok) throw new Error('โหลด channels.json ไม่สำเร็จ');
  channelsRaw = await res.json();
  channels    = normalizeAll(channelsRaw).filter(c => c.type !== 'dash'); // เน้น HLS
  listEl.removeAttribute('data-loading');
}
function updateNowPlaying(c){
  nowEl.textContent = `กำลังเล่น: ${c.name} (${c.category})`;
  document.title = `▶ ${c.name} - Flow TV`;
}

// ---------- Player ----------
function ensureHls(){
  if (hls){ try{ hls.destroy(); }catch{} hls = null; }
  if (window.Hls && Hls.isSupported()){
    hls = new Hls({
      enableWorker:true, backBufferLength:30, maxBufferLength:30,
      fragLoadingMaxRetry:2, manifestLoadingMaxRetry:2, lowLatencyMode:false
    });
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.ERROR, (ev, data) => { if (data?.fatal) showStatus(`เล่นไม่สำเร็จ (${data.type})`, true); });
  }
}
async function playUrl(url){
  const finalUrl = wrapIfProxy(url);
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')){
    videoEl.src = finalUrl;
    try{ await videoEl.play(); }catch{}
    return true;
  }
  ensureHls();
  if (!hls){ showStatus('เบราว์เซอร์นี้ไม่รองรับ HLS', true); return false; }
  hls.loadSource(finalUrl);
  try{ await videoEl.play(); }catch{}
  return true;
}
async function playByIndex(idx, scrollIntoView){
  if (idx < 0 || idx >= channels.length) return;
  const c = channels[idx];
  currentIdx = idx;

  listEl.querySelectorAll('.channel-tile').forEach(el => {
    el.classList.toggle('active', el.dataset.id === c.id);
  });

  updateNowPlaying(c);
  showStatus(`กำลังโหลด: ${c.name} ...`);

  const candidates = [c.url, ...c.backups.map(b => b.url || b.src).filter(Boolean)];
  let ok = false;
  for (const u of candidates){
    try{
      ok = await playUrl(u);
      if (ok){ showStatus(''); break; }
    }catch{}
  }
  if (!ok) showStatus('ไม่สามารถเล่นช่องนี้ได้', true);
  if (scrollIntoView){
    document.querySelector(`.channel-tile[data-id="${c.id}"]`)?.scrollIntoView({behavior:'smooth', block:'center'});
  }
}

// ---------- Refresh / Init ----------
async function doRefresh(){
  showStatus('รีเฟรช/ล้างแคช...');
  const activeTab = tabsEl.querySelector('.tab.active')?.dataset?.cat || categories[0] || null;
  await fetchChannels();
  buildCategories();
  renderTabs();
  const keep = categories.includes(activeTab) ? activeTab : (categories[0] || null);
  tabsEl.querySelectorAll('.tab').forEach(x => { if (x.dataset.cat === keep) x.classList.add('active'); });
  renderList(keep);
  showStatus('');
}
refreshBtn?.addEventListener('click', async () => {
  if (Date.now() - lastRefreshTs < 700) return;
  lastRefreshTs = Date.now();
  try{ await doRefresh(); }catch(e){ showStatus('รีเฟรชไม่สำเร็จ', true); }
});

async function init(){
  showStatus('กำลังโหลดรายการช่อง...');
  try{
    await fetchChannels();
    buildCategories();
    renderTabs();
    renderList(categories[0] || null);
    showStatus('');
  }catch(e){
    console.error(e);
    showStatus('โหลดรายการช่องไม่สำเร็จ', true);
  }
  ['click','touchend','keydown'].forEach(evt=>{
    window.addEventListener(evt, ()=> { if (videoEl.muted) videoEl.muted = false; }, { once:true, passive:true });
  });
}
document.addEventListener('DOMContentLoaded', init);
