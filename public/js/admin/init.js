// ── Init ──
function initApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  connectSocket();
  loadBroadcasts();
  loadClients();
  setTimeout(setupPush, 2000);
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
