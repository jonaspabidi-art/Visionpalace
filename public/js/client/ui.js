if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPWA = e;
  if (!localStorage.getItem('vp_pwa_dismissed')) document.getElementById('pwa-banner').classList.add('show');
});
document.getElementById('pwa-install').onclick = async () => {
  if (deferredPWA) { deferredPWA.prompt(); await deferredPWA.userChoice; deferredPWA = null; }
  document.getElementById('pwa-banner').classList.remove('show');
};
document.getElementById('pwa-dismiss').onclick = () => {
  localStorage.setItem('vp_pwa_dismissed','1');
  document.getElementById('pwa-banner').classList.remove('show');
};

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById(tab + '-view').classList.add('active');
  const subs = { broadcast: 'Stock updates', messages: 'Messages', purchases: 'Purchases' };
  document.getElementById('header-sub').textContent = subs[tab] || '';
  chatOpen = (tab === 'messages');
  if (tab === 'messages') {
    chatUnread = 0; updateUnread();
    markRead();
    if (renderedMsgIds.size === 0) loadMessages();
    else scrollChat();
  }
  if (tab === 'purchases') loadPurchases();
  if (tab === 'broadcast') scrollFeedBottom();
}

// ── Broadcast strip directional scroll lock ──
// Horizontal → scroll strip. Vertical → manually scroll feed.
(function() {
  let startX, startY, stripScroll, feedScroll, strip, locked;
  document.addEventListener('touchstart', e => {
    strip = e.target.closest('.bc-media-strip');
    if (!strip) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    stripScroll = strip.scrollLeft;
    const feed = document.getElementById('feed-scroll');
    feedScroll = feed ? feed.scrollTop : 0;
    locked = null;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!strip) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!locked) locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    e.preventDefault();
    if (locked === 'x') {
      strip.scrollLeft = stripScroll - dx;
    } else {
      const feed = document.getElementById('feed-scroll');
      if (feed) feed.scrollTop = feedScroll - dy;
    }
  }, { passive: false });
  document.addEventListener('touchend', () => { strip = null; locked = null; }, { passive: true });
})();

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function formatDatePill(dateStr) {
  const d = new Date(dateStr);
  const today = new Date(); today.setHours(0,0,0,0);
  const msgDay = new Date(d); msgDay.setHours(0,0,0,0);
  const diff = Math.round((today - msgDay) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function showToast(msg, type) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:calc(var(--safe-bot)+80px);left:50%;transform:translateX(-50%);
    background:${type==='error'?'#3d1a1a':'#1a3d2a'};color:${type==='error'?'#ff8888':'#66dd99'};
    border:1px solid ${type==='error'?'rgba(255,80,80,.4)':'rgba(80,200,120,.4)'};
    padding:10px 18px;border-radius:12px;font-size:13px;z-index:999;
    max-width:90vw;text-align:center;pointer-events:none;white-space:pre-wrap;word-break:break-all;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 8000 : 3000);
}
