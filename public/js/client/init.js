function initApp() {
  document.getElementById('join-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  connectSocket();
  loadBroadcasts();
  loadMessages();
  setTimeout(setupPush, 2000);
}

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
  document.getElementById('join-screen').style.display = 'flex';
}

if (session?.session_token) {
  fetch('/api/messages/me/thread', { headers:{'x-session-token':session.session_token} })
    .then(r => {
      if (r.ok) hideSplash(initApp);
      else { session = null; localStorage.removeItem('vp_session'); hideSplash(showLogin); }
    })
    .catch(() => hideSplash(showLogin));
} else {
  hideSplash(showLogin);
}
