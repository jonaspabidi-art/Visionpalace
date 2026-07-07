// ── Service worker (push notifications; fetch caching skips /admin) ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Notification tapped while the app is open in the background
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'notification-click' && e.data.client_id && token) {
      switchTab('clients');
      openChat(e.data.client_id);
    }
  });
}

// ── Init ──
function initApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  connectSocket();
  loadBroadcasts();
  loadClients().then(openChatFromHash);
  setTimeout(setupPush, 2000);
}

// Land in the right chat when the app was opened from a notification
function openChatFromHash() {
  const m = location.hash.match(/^#client=([\w-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  switchTab('clients');
  openChat(m[1]);
}

// ── Boot ──
const splashStart = Date.now();
const MIN_SPLASH = 1400;

function hideSplash(cb) {
  const wait = Math.max(0, MIN_SPLASH - (Date.now() - splashStart));
  setTimeout(() => {
    const s = document.getElementById('splash');
    s.classList.add('fade-out');
    setTimeout(() => { s.style.display = 'none'; cb && cb(); }, 500);
  }, wait);
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
}

if (token) {
  fetch('/api/clients', { headers: { Authorization: `Bearer ${token}` } })
    .then(r => {
      if (r.ok) hideSplash(initApp);
      else { localStorage.removeItem('vp_admin_token'); token = null; hideSplash(showLogin); }
    })
    .catch(() => hideSplash(showLogin));
} else {
  hideSplash(showLogin);
}
