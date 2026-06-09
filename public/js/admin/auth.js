document.getElementById('login-btn').onclick = login;
document.getElementById('username-input').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('pw-input').focus());
document.getElementById('pw-input').addEventListener('keydown', e => e.key === 'Enter' && login());

async function login() {
  const username = document.getElementById('username-input').value.trim();
  const pw = document.getElementById('pw-input').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  if (!username) { err.textContent = 'Ange användarnamn'; return; }
  try {
    const r = await fetch('/api/auth/admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: pw })
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Fel inloggningsuppgifter'; return; }
    token = d.token;
    localStorage.setItem('vp_admin_token', token);
    initApp();
  } catch { err.textContent = 'Anslutningsfel'; }
}

document.getElementById('logout-btn').onclick = () => {
  localStorage.removeItem('vp_admin_token');
  location.reload();
};

function api(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) }
  });
}
