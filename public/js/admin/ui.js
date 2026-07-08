// ── Tab switching ──
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById(tab + '-view').classList.add('active');
  const titles = { broadcast: 'Sändningar', clients: 'Klienter', inventory: 'Lager', invoice: 'Faktura', historik: 'Historik' };
  document.getElementById('header-title').textContent = titles[tab] || tab;
  document.getElementById('search-toggle-btn').style.display = tab === 'broadcast' ? '' : 'none';
  if (tab !== 'broadcast' && searchVisible) toggleSearch();
  if (tab === 'broadcast') requestAnimationFrame(pinFeedToBottom);
  if (tab === 'inventory') loadInventory();
  if (tab === 'invoice') populateInvClientPicker();
  if (tab === 'historik') loadSalesHistory();
}

// ── Search toggle ──
document.getElementById('search-toggle-btn').onclick = toggleSearch;
function toggleSearch() {
  searchVisible = !searchVisible;
  document.getElementById('search-bar').style.display = searchVisible ? '' : 'none';
  if (!searchVisible) {
    document.getElementById('search-input').value = '';
    loadBroadcasts();
  }
}
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(window._st);
  window._st = setTimeout(() => loadBroadcasts(e.target.value), 300);
});

// ── Extras toggle (price + pin) ──
document.getElementById('bc-extras-btn').onclick = () => {
  extrasOpen = !extrasOpen;
  document.getElementById('bc-extras').style.display = extrasOpen ? 'flex' : 'none';
  document.getElementById('bc-extras-btn').classList.toggle('active', extrasOpen);
};

// ── Broadcast composer listeners ──
document.getElementById('bc-send-btn').onclick = () => postBroadcast();
document.getElementById('bc-text').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postBroadcast(); }
});
document.getElementById('bc-text').addEventListener('input', function () { autoResize(this); });

// ── Invites ──
document.getElementById('invite-open-btn').onclick = () => {
  document.getElementById('invite-links').innerHTML = '';
  document.getElementById('invite-modal').classList.add('open');
};
document.getElementById('gen-invites-btn').onclick = async () => {
  const count = parseInt(document.getElementById('invite-count').value) || 1;
  const r = await api('/api/invite', { method: 'POST', body: JSON.stringify({ count }) });
  const d = await r.json();
  const container = document.getElementById('invite-links');
  container.innerHTML = '';
  for (const t of d.tokens) {
    const url = `${location.origin}/join/${t}`;
    const div = document.createElement('div');
    div.className = 'invite-row';
    div.innerHTML = `<span class="invite-url">${url}</span><button class="copy-btn" onclick="copyLink('${url}',this)">Kopiera</button>`;
    container.appendChild(div);
  }
};

async function copyLink(url, btn) {
  await navigator.clipboard.writeText(url);
  btn.textContent = '✓ Kopierat';
  setTimeout(() => btn.textContent = 'Kopiera', 2000);
}

// ── Modal close on backdrop ──
document.querySelectorAll('.modal-bg').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

// ── Lightbox ──
function openLightbox(src) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}
document.getElementById('lightbox').onclick = e => {
  if (e.target === e.currentTarget || e.target.id === 'lb-close')
    document.getElementById('lightbox').classList.remove('open');
};

// Save/share the image shown in the lightbox. Web Share (with file) gives the
// native share sheet on mobile ("Spara bild" → photo library); falls back to a
// blob download, and as a last resort opens the image in a new tab.
async function saveMedia(url) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const name = url.split('/').pop().split('?')[0] || 'bild.jpg';
    if (navigator.canShare) {
      const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch {
    window.open(url, '_blank');
  }
}
document.getElementById('lb-save').onclick = () => {
  const src = document.getElementById('lb-img').src;
  if (src) saveMedia(src);
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('lightbox').classList.remove('open');
});

// ── Broadcast strip directional scroll lock ──
(function() {
  let startX, startY, stripScroll, feedScroll, strip, locked;
  document.addEventListener('touchstart', e => {
    strip = e.target.closest('.bc-media-strip-admin');
    if (!strip) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    stripScroll = strip.scrollLeft;
    const feed = document.querySelector('.bc-feed');
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
      const feed = document.querySelector('.bc-feed');
      if (feed) feed.scrollTop = feedScroll - dy;
    }
  }, { passive: false });
  document.addEventListener('touchend', () => { strip = null; locked = null; }, { passive: true });
})();

// ── Auto-resize textareas ──
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Utils ──
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function timeAgo(iso) {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 60) return 'just nu';
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}t`;
  return `${Math.floor(d / 86400)}d`;
}

// ── Push / Notifications ──
async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission === 'denied') return;
  if (Notification.permission === 'default') {
    document.getElementById('notif-btn').style.display = '';
    return;
  }
  await registerAdminPushSub();
}

async function enableNotifs() {
  const perm = await Notification.requestPermission();
  document.getElementById('notif-btn').style.display = 'none';
  if (perm !== 'granted') return;
  await registerAdminPushSub();
}

function showToast(msg, type) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);
    background:${type==='error'?'#3d1a1a':'#1a3d2a'};color:${type==='error'?'#ff8888':'#66dd99'};
    border:1px solid ${type==='error'?'rgba(255,80,80,.4)':'rgba(80,200,120,.4)'};
    padding:10px 18px;border-radius:12px;font-size:13px;z-index:999;
    max-width:90vw;text-align:center;pointer-events:none;white-space:pre-wrap;word-break:break-all;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 8000 : 3000);
}

function _b64urlNorm(s) {
  return String(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function _keyToB64url(buf) {
  return _b64urlNorm(btoa(String.fromCharCode(...new Uint8Array(buf))));
}

let _pushToastShown = false;

async function registerAdminPushSub() {
  try {
    const kr = await fetch('/api/push/vapid-key');
    if (!kr.ok) throw new Error('vapid-key ' + kr.status);
    const { publicKey } = await kr.json();
    if (!publicKey) throw new Error('no publicKey');

    const sw = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('SW timeout')), 10000))
    ]);

    // Reuse this device's existing subscription — but only if it was created
    // with OUR VAPID key. A subscription under another key can never receive
    // our pushes (the push service rejects sends with 403, which is not one
    // of the prune codes), so a mismatch must be re-subscribed.
    let sub = await sw.pushManager.getSubscription();
    if (sub && sub.options?.applicationServerKey) {
      const existingKey = _keyToB64url(sub.options.applicationServerKey);
      if (existingKey !== _b64urlNorm(publicKey)) {
        console.warn('[Push] VAPID key mismatch — re-subscribing');
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) {
      sub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      if (!sub) throw new Error('subscribe returned null');
    }

    const r = await fetch('/api/push/admin-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    if (!r.ok) throw new Error('server ' + r.status);
    const d = await r.json().catch(() => ({}));
    console.log('[Push] Admin subscription saved', d);
    if (!_pushToastShown) {
      _pushToastShown = true;
      showToast(`Notiser aktiva på denna enhet${d.devices ? ` · ${d.devices} enhet(er) registrerade` : ''}`, 'success');
    }
  } catch(e) {
    console.error('[Push] Admin setup failed:', e);
    showToast('Notiser: ' + e.message, 'error');
  }
}

function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
