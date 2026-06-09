// ── Settings ──
async function openSettings() {
  document.getElementById('settings-name').value = session?.display_name || '';
  document.getElementById('settings-fullname').value = session?.full_name || '';
  document.getElementById('settings-address').value = session?.address || '';
  document.getElementById('settings-phone').value = session?.phone || '';
  document.getElementById('settings-newpw').value = '';
  document.getElementById('settings-curpw').value = '';
  document.getElementById('settings-err').textContent = '';
  document.getElementById('settings-ok').textContent = '';
  document.getElementById('settings-modal').classList.add('open');
  try {
    const r = await fetch('/api/me', { headers: { 'x-session-token': session.session_token } });
    if (r.ok) {
      const d = await r.json();
      document.getElementById('settings-name').value = d.display_name || '';
      document.getElementById('settings-fullname').value = d.full_name || '';
      document.getElementById('settings-address').value = d.address || '';
      document.getElementById('settings-phone').value = d.phone || '';
      session.full_name = d.full_name;
      session.address = d.address;
      session.phone = d.phone;
    }
  } catch {}
}
function closeSettings() { document.getElementById('settings-modal').classList.remove('open'); }
async function saveProfile() {
  const btn = document.getElementById('settings-save-btn');
  const err = document.getElementById('settings-err');
  const ok  = document.getElementById('settings-ok');
  err.textContent = ''; ok.textContent = '';
  const display_name = document.getElementById('settings-name').value.trim();
  const full_name = document.getElementById('settings-fullname').value.trim();
  const address = document.getElementById('settings-address').value.trim();
  const phone = document.getElementById('settings-phone').value.trim();
  const new_password = document.getElementById('settings-newpw').value;
  const current_password = document.getElementById('settings-curpw').value;
  if (!current_password) { err.textContent = 'Current password is required.'; return; }
  btn.textContent = 'Saving…'; btn.disabled = true;
  try {
    const r = await fetch('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-session-token': session.session_token },
      body: JSON.stringify({ display_name, full_name, address, phone, new_password: new_password || undefined, current_password })
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Something went wrong.'; return; }
    if (d.display_name) session.display_name = d.display_name;
    if (d.full_name !== undefined) session.full_name = d.full_name;
    if (d.address !== undefined) session.address = d.address;
    if (d.phone !== undefined) session.phone = d.phone;
    localStorage.setItem('vp_session', JSON.stringify(session));
    ok.textContent = 'Saved!';
    setTimeout(closeSettings, 1200);
  } catch { err.textContent = 'Connection error.'; }
  finally { btn.textContent = 'Save changes'; btn.disabled = false; }
}
