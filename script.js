// ===== HUD (overlay ที่ "ซ้อน" กับแถบคอนโทรลได้) =====
let toastStackEl = null;   // stack ซ้ายบน
let loadOverlayEl = null;  // overlay ตอนโหลด/บัฟเฟอร์
let bufferingTimer = null;

// ปรับพื้นที่เว้นไม่ให้บังคอนโทรล (px)
const OVERLAY_SAFE = { top: 28, bottom: 64, side: 0 };

function ensureHUD(){
  const wrap = document.querySelector('.player-wrap');
  if (!wrap) return;

  // Stack ทางซ้ายบน (ข้อความสั้น ๆ)
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

  // Overlay กลางจอ — พื้นหลัง "ดำ" แต่เว้าด้านบน/ล่างไม่ให้ทับคอนโทรล
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
    // พื้นหลังดำ + เว้าช่องไว้ด้านบน/ล่าง
    Object.assign(loadOverlayEl.style, {
      position:'absolute', inset:'0',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:'2', background:'#000', opacity:'0', pointerEvents:'none',
      transition:'opacity .18s ease',
      // เว้าด้านบน 28px ด้านล่าง 64px (+ safe-area iOS)
      clipPath: `inset(${OVERLAY_SAFE.top}px 0 calc(${OVERLAY_SAFE.bottom}px + env(safe-area-inset-bottom, 0px)) 0)`
    });
    loadOverlayEl.hidden = true;
    wrap.appendChild(loadOverlayEl);

    const kf = document.createElement('style');
    kf.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(kf);
  }
}

// Toast ซ้อนกันได้ (ซ้ายบน)
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

// Overlay โหลด/บัฟเฟอร์
function showLoadingOverlay(text='กำลังโหลด…'){
  ensureHUD(); if (!loadOverlayEl) return;
  const tx = loadOverlayEl.querySelector('#plo-text'); if (tx) tx.textContent = text;
  loadOverlayEl.hidden = false; requestAnimationFrame(()=> loadOverlayEl.style.opacity = '1');
}
function hideLoadingOverlay(){
  if (!loadOverlayEl) return; loadOverlayEl.style.opacity='0'; setTimeout(()=>{ loadOverlayEl.hidden=true; },180);
}

// แสดง/ซ่อน “กำลังบัฟเฟอร์…” จากอีเวนต์ของ <video>
function attachBufferingListeners(){
  if (!videoEl) return;
  const showSoon = ()=>{ clearTimeout(bufferingTimer); bufferingTimer = setTimeout(()=> showLoadingOverlay('กำลังบัฟเฟอร์…'), 250); };
  const hideNow  = ()=>{ clearTimeout(bufferingTimer); bufferingTimer=null; hideLoadingOverlay(); };

  videoEl.addEventListener('waiting', showSoon);  // เริ่มรอ data
  videoEl.addEventListener('seeking', showSoon);  // กำลังลาก/ข้าม
  ['playing','canplay','seeked'].forEach(ev=> videoEl.addEventListener(ev, hideNow));
  // กันค้าง: ถ้าเริ่มมีภาพเดิน ให้ซ่อน
  videoEl.addEventListener('timeupdate', ()=>{ if (!videoEl.paused) hideNow(); });
}
