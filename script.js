/* ========================= script.js (GitHub Pages mode) =========================
   - อ่าน channels.json (รองรับ object keyed และ array)
   - ไม่มีหมวด "ทั้งหมด" (ใช้เฉพาะหมวดจริง) + จัดเรียงหมวดด้วย CATEGORY_ORDER
   - คลิก "ช่อง" / เปลี่ยน "หมวด" → เลื่อนไปยังตัวเล่นวิดีโอเสมอ
   - Overlay โหลด/บัฟเฟอร์ พื้นหลังดำ + เว้าไม่บังคอนโทรล (progress/เวลา)
   - Toast มุมซ้ายบน (ซ้อนหลายอันได้) + player-status ขวาบน
================================================================================= */

const CHANNELS_URL = 'channels.json';
const TIMEZONE = 'Asia/Bangkok';
const PROXY_BASE = (window.PROXY_BASE || '').replace(/\/$/, '');

// ลำดับหมวด (ปรับชื่อให้ตรงกับใน channels.json)
const CATEGORY_ORDER = ['กีฬา', 'หนัง', 'การศึกษา', 'IPTV'];

const tabsEl   = document.getElementById('tabs');
const listEl   = document.getElementById('channel-list');
const videoEl  = document.getElementById('player');
const statusEl = document.getElementById('player-status'); // กล่องสถานะขวาบน
const nowEl    = document.getElementById('now-playing');
const clockEl  = document.getElementById('clock');
const refreshBtn = document.getElementById('refresh-btn');

let channelsRaw = null;
let channels    = [];
let categories  = [];           // ไม่มี "ทั้งหมด"
let currentIdx  = -1;
let hls = null;
let lastRefreshTs = 0;
let statusTimer = null;

/* ========================= HUD / Overlay ========================= */
// เว้นพื้นที่ overlay ไม่ให้บังคอนโทรล (px)
const OVERLAY_SAFE = { top: 28, bottom: 64, side: 0 };

let toastStackEl = null;   // stack ซ้ายบน
let loadOverlayEl = null;  // overlay โหลด/บัฟเฟอร์
let bufferingTimer = null;

function ensureHUD(){
  const wrap = document.querySelector('.player-wrap');
  if (!wrap) return;

  // Container สำหรับ toast ซ้ายบน (ซ้อนกันได้)
  if (!toastStackEl){
    toastStackEl = document.createElement('div');
    Object.assign(toastStackEl.style, {
      position:'absolute', left:'12px', top:'12px', zIndex:'3',
      display:'flex', flexDirection:'column', gap:'6px',
      alignItems:'flex-start', pointerEvents:'none',
      maxWidth:'min(92%, 420px)'
    });
    wrap.appendChild(toastStackEl);
  }

  // Overlay โหลด/บัฟเฟอร์ (พื้นหลังดำ + เว้าด้านบน/ล่าง)
  if (!loadOverlayEl){
    loadOverlayEl = document.createElement('div');
    loadOverlayEl.innerHTML = `
      <div style="
        display:flex;flex-direction:column;align-items:center;gap:10px;
        padding:14px 16px;border-radius:12px;background:#111418e6;border:1px solid #ffffff22;
        backdrop-filter:saturate(120%) blur(2px);">
        <div style="width:36px;height:36px;border:3px solid #9aa0a6;border-top-color:transparent;border-radius:50%;animation:spin .9s linear infinite"></div>
        <div id="plo-text" style="color:#e9eef3;font-size:14px;">กำลังโหลด…</div>
      </div>`;
    Object.assign(loadOverlayEl.style, {
      position:'absolute', inset:'0',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:'2', background:'#000', opacity:'0', pointerEvents:'none',
      transition:'opacity .18s ease',
      clipPath: `inset(${OVERLAY_SAFE.top}px 0 calc(${OVERLAY_SAFE.bottom}px + env(safe-area-inset-bottom, 0px)) 0)`
    });
    loadOverlayEl.hidden = true;
    wrap.appendChild(loadOverlayEl);

    // keyframes สำหรับสปินเนอร์ (inline)
    const kf = document.createElement('style');
    kf.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(kf);
  }
}

function showToastLeft(msg, durationMs=1200){
  ensureHUD(); if (!toastStackEl || !msg) return;

  const t = document.createElement('div');
  Object.assign(t.style, {
    padding:'6px 10px', borderRadius:'8px', color:'#fff',
    background:'#000c', border:'1px solid #ffffff22',
    fontSize:'14px', lineHeight:'1.35', backdropFilter:'saturate(120%) blur(2px)',
    boxShadow:'0 6px 18px #0006', opacity:'0', transform:'translateY(-6px)',
    transition:'opacity .18s ease, transform .18s ease', pointerEvents:'none'
  });
  t.textContent = msg;

  const MAX = 3;
  while (toastStackEl.children.length >= MAX) {
    const first = toastStackEl.firstElementChild;
    if (first){ first.style.opacity='0'; first.style.transform='translateY(-6px)'; setTimeout(()=>first.remove(),160); }
    else break;
  }
  toastStackEl.appendChild(t);
  requestAnimationFrame(()=>{ t.style.opacity='1'; t.style.transform='translateY(0)'; });
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateY(-6px)'; setTimeout(()=>t.remove(),180); }, durationMs);
}

function showLoadingOverlay(text='กำลังโหลด…'){
  ensureHUD(); if (!loadOverlayEl) return;
  const tx = loadOverlayEl.querySelector('#plo-text'); if (tx) tx.textContent = text;
  loadOverlayEl.hidden = false; requestAnimationFrame(()=> loadOverlayEl.style.opacity = '1');
}
function hideLoadingOverlay(){
  if (!loadOverlayEl) return; loadOverlayEl.style.opacity='0'; setTimeout(()=>{ loadOverlayEl.hidden=true; },180);
}

// โชว์/ซ่อนสถานะบัฟเฟอร์จากอีเวนต์ของ <video>
function attachBufferingListeners(){
  if (!videoEl) return;
  const showSoon = ()=>{ clearTimeout(bufferingTimer); bufferingTimer = setTimeout(()=> showLoadingOverlay('กำลังบัฟเฟอร์…'), 250); };
  const hideNow  = ()=>{ clearTimeout(bufferingTimer); bufferingTimer=null; hideLoadingOverlay(); };

  videoEl.addEventListener('waiting', showSoon);
  videoEl.addEventListener('seeking', showSoon);
  ['playing','canplay','seeked','loadeddata'].forEach(ev=> videoEl.addEventListener(ev, hideNow));
  videoEl.addEventListener('timeupdate', ()=>{ if (!videoEl.paused) hideNow(); });
}

/* ========================= Utils ========================= */
const fmtTime = (d)=> d.toLocaleString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:TIMEZONE});
function tickClock(){ if (clockEl) clockEl.textContent = fmtTime(new Date()); }
setInterval(tickClock, 1000); tickClock();

function showStatus(msg, isError=false, durationMs){
  if (!statusEl) return;
  if (statusTimer){ clearTimeout(statusTimer); statusTimer = null; }

  if (!msg){
    statusEl.hidden = true;
    statusEl.textContent = '';
    statusEl.classList.remove('error');
    return;
  }
  statusEl.textContent = msg;
  statusEl.hidden = false;
  statusEl.classList.toggle('error', !!isError);

  // default: ทั่วไป 1800ms, error 4000ms (durationMs=0 ⇒ ค้างไว้)
  const ms = typeof durationMs === 'number' ? durationMs : (isError ? 4000 : 1800);
  if (ms > 0){ statusTimer = setTimeout(() => { statusEl.hidden = true; }, ms); }
}

function bust(url){ const u = new URL(url, location.href); u.searchParams.set('_', Date.now().toString(36)); return u.toString(); }

function wrapIfProxy(u){
  if (!PROXY_BASE) return u;
  const v = new URL(PROXY_BASE);
  v.pathname = v.pathname.replace(/\/+$/,'') + '/api/p';
  v.searchParams.set('u', u);
  return v.toString();
}

// เลื่อนหน้าไปหาตัวเล่น (เว้น header sticky)
function scrollToPlayer(){
  const playerWrap = document.querySelector('.player-wrap');
  if (!playerWrap) return;
  const header = document.querySelector('.h-wrap');
  const headerH = header ? header.getBoundingClientRect().height : 0;
  const y = playerWrap.getBoundingClientRect().top + window.scrollY - (headerH + 8);
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

/* ========================= Normalize channels ========================= */
function extractBackups(o){
  const cand = o.backups || o.backup || o.alts || o.sources || [];
  return Array.isArray(cand) ? cand.map(s => (typeof s==='string'?{url:s}:s)).filter(Boolean) : [];
}
function normalizeOne(id, o){
  const url = o.src || o.url || '';
  return {
    id,
    name:o.name || id,
    logo:o.logo || '',
    category:o.category || 'อื่นๆ',
    url,
    type:o.type || (String(url).endsWith('.mpd') ? 'dash' : 'hls'),
    drm:o.drm || null,
    backups:extractBackups(o),
    badge:o.badge || ''
  };
}
function normalizeAll(raw){
  const out = [];
  if (Array.isArray(raw)) raw.forEach((o,i)=> out.push(normalizeOne(o.id||String(i), o)));
  else if (raw && typeof raw==='object') Object.keys(raw).forEach(k=> out.push(normalizeOne(k, raw[k])));
  return out;
}

/* ========================= Categories (ordering) ========================= */
function buildCategories(){
  const set = new Set(channels.map(c => c.category || 'อื่นๆ'));
  const all = Array.from(set);
  const known = CATEGORY_ORDER.filter(cat => set.has(cat));
  const rest  = all.filter(cat => !CATEGORY_ORDER.includes(cat))
                   .sort((a,b)=>a.localeCompare(b,'th'));
  categories = [...known, ...rest];
}

/* ========================= Render ========================= */
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
      setTimeout(scrollToPlayer, 0);
      showToastLeft(`หมวด: ${cat}`, 900);
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
      playByIndex(idx, true); // คลิกช่อง → เด้งไปยังวิดีโอ
    });
  });
  // เล่นช่องแรกของหมวดแรกอัตโนมัติ (ครั้งแรกไม่เลื่อน)
  if (filtered.length && currentIdx < 0) {
    const firstIdx = channels.findIndex(x => x.id === filtered[0].id);
    playByIndex(firstIdx, false);
  }
}

/* ========================= Data ========================= */
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
  channels    = normalizeAll(channelsRaw).filter(c => c.type !== 'dash'); // GH pages: เน้น HLS
  listEl.removeAttribute('data-loading');
}

/* ========================= Player ========================= */
function updateNowPlaying(c){
  nowEl.textContent = `กำลังเล่น: ${c.name} (${c.category})`;
  document.title = `▶ ${c.name} - Flow TV`;
}

function ensureHls(){
  if (hls){ try{ hls.destroy(); }catch{} hls = null; }
  if (window.Hls && Hls.isSupported()){
    hls = new Hls({
      enableWorker:true, backBufferLength:30, maxBufferLength:30,
      fragLoadingMaxRetry:2, manifestLoadingMaxRetry:2, lowLatencyMode:false
    });
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.ERROR, (ev, data) => {
      if (data?.fatal) showStatus(`เล่นไม่สำเร็จ (${data.type})`, true, 4000);
    });
  }
}

async function playUrl(url){
  const finalUrl = wrapIfProxy(url);
  if (videoEl) videoEl.style.background = '#000'; // พื้นหลังดำก่อนเริ่มเล่น

  if (videoEl.canPlayType('application/vnd.apple.mpegurl')){ // Safari
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

/**
 * @param {number} idx
 * @param {boolean} jumpToPlayer - ถ้า true จะเลื่อนไปหาวิดีโอเสมอ (ตอนคลิกช่อง)
 */
async function playByIndex(idx, jumpToPlayer){
  if (idx < 0 || idx >= channels.length) return;
  const c = channels[idx];
  currentIdx = idx;

  listEl.querySelectorAll('.channel-tile').forEach(el => {
    el.classList.toggle('active', el.dataset.id === c.id);
  });

  updateNowPlaying(c);
  showLoadingOverlay(`กำลังโหลด: ${c.name} ...`);
  showStatus('', false); // ซ่อนกล่องขวาบนถ้ามี

  const candidates = [c.url, ...c.backups.map(b => b.url || b.src).filter(Boolean)];
  let ok = false;
  for (const u of candidates){
    try{
      ok = await playUrl(u);
      if (ok){ break; }
    }catch{}
  }

  hideLoadingOverlay();
  if (!ok) showStatus('ไม่สามารถเล่นช่องนี้ได้', true, 4000);

  if (jumpToPlayer) setTimeout(scrollToPlayer, 0);
}

/* ========================= Refresh / Init ========================= */
async function doRefresh(){
  showToastLeft('กำลังรีเฟรช...', 800);
  showStatus('รีเฟรช/ล้างแคช...', false, 0);
  const activeTab = tabsEl.querySelector('.tab.active')?.dataset?.cat || categories[0] || null;

  await fetchChannels();
  buildCategories();
  renderTabs();

  const keep = categories.includes(activeTab) ? activeTab : (categories[0] || null);
  tabsEl.querySelectorAll('.tab').forEach(x => { if (x.dataset.cat === keep) x.classList.add('active'); });
  renderList(keep);

  showStatus('');
  showToastLeft('อัปเดตรายการแล้ว', 900);
}

refreshBtn?.addEventListener('click', async () => {
  if (Date.now() - lastRefreshTs < 700) return;
  lastRefreshTs = Date.now();
  try{ await doRefresh(); }
  catch(e){ showStatus('รีเฟรชไม่สำเร็จ', true, 4000); showToastLeft('รีเฟรชไม่สำเร็จ', 1200); }
});

async function init(){
  ensureHUD();
  showStatus('กำลังโหลดรายการช่อง...', false, 0);
  try{
    await fetchChannels();
    buildCategories();
    renderTabs();
    renderList(categories[0] || null);   // ครั้งแรกไม่เลื่อน
    showStatus('');
  }catch(e){
    console.error(e);
    showStatus('โหลดรายการช่องไม่สำเร็จ', true, 4500);
  }

  attachBufferingListeners();

  // ยกเลิก mute อัตโนมัติหลังมี gesture แรก
  ['click','touchend','keydown'].forEach(evt=>{
    window.addEventListener(evt, ()=> { if (videoEl.muted) videoEl.muted = false; }, { once:true, passive:true });
  });
}

document.addEventListener('DOMContentLoaded', init);
