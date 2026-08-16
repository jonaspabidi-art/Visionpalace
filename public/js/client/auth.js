function getInviteToken() {
  const p = location.pathname.split('/');
  const last = p[p.length - 1];
  return (last && last !== 'client') ? last : null;
}

const inviteToken = getInviteToken();
if (inviteToken) {
  document.getElementById('join-screen').style.display = 'none';
  document.getElementById('register-screen').style.display = 'flex';
}

// Register flow
document.getElementById('reg-btn').onclick = register;
document.getElementById('reg-name').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('reg-address').focus());
document.getElementById('reg-address').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('reg-phone').focus());
document.getElementById('reg-phone').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('reg-username').focus());
document.getElementById('reg-username').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('reg-password').focus());
document.getElementById('reg-password').addEventListener('keydown', e => e.key === 'Enter' && register());

async function register() {
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const err = document.getElementById('reg-err');
  err.textContent = '';
  if (!username) { err.textContent = 'Please choose a username.'; return; }
  if (password.length < 4) { err.textContent = 'Password must be at least 4 characters.'; return; }
  const btn = document.getElementById('reg-btn');
  btn.textContent = 'Creating account…'; btn.disabled = true;
  let created = false;
  try {
    const r = await fetch(`/api/join/${inviteToken}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        username,
        full_name: document.getElementById('reg-name').value.trim() || null,
        address: document.getElementById('reg-address').value.trim() || null,
        phone: document.getElementById('reg-phone').value.trim() || null,
        password
      })
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Something went wrong.'; return; }
    created = true;
    history.replaceState(null, '', '/client');
    document.getElementById('register-screen').style.display = 'none';
    document.getElementById('success-screen').style.display = 'flex';
    // If Android install prompt is ready, make the button trigger it directly
    if (deferredPWA) {
      const ab = document.getElementById('dl-android-btn');
      ab.innerHTML = ab.innerHTML.replace('Download for Android', 'Install on Android');
    }
  } catch (e) {
    // Kontot kan redan vara skapat när felet kommer efter svaret — då är
    // inbjudan förbrukad och "försök igen" ger "already been used". Säg det
    // rakt ut i stället för att låta honom fastna.
    err.textContent = created
      ? 'Your account was created, but something went wrong here. Try signing in.'
      : e?.name === 'TimeoutError'
        ? 'The server did not respond. Check your connection and try again.'
        : 'Could not create the account. Please try again.';
    console.error('[VP] Registrering misslyckades:', e);
  } finally {
    if (!created) { btn.textContent = 'Create account'; btn.disabled = false; }
  }
}

function toggleDLGuide(platform) {
  const guide = document.getElementById('dl-guide-' + platform);
  guide.classList.toggle('open');
}

async function installAndroid() {
  if (deferredPWA) {
    deferredPWA.prompt();
    await deferredPWA.userChoice;
    deferredPWA = null;
  } else {
    toggleDLGuide('android');
  }
}

function goToLogin() {
  document.getElementById('success-screen').style.display = 'none';
  document.getElementById('join-screen').style.display = 'flex';
}

// Login flow
document.getElementById('action-btn').onclick = loginClient;
document.getElementById('name-input').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('password-input').focus());
document.getElementById('password-input').addEventListener('keydown', e => e.key === 'Enter' && loginClient());

async function loginClient() {
  const name = document.getElementById('name-input').value.trim();
  const password = document.getElementById('password-input').value;
  const err = document.getElementById('join-err');
  err.textContent = '';
  if (!name) { err.textContent = 'Please enter your username.'; return; }
  if (!password) { err.textContent = 'Please enter your password.'; return; }
  const btn = document.getElementById('action-btn');
  btn.textContent = 'Signing in…'; btn.disabled = true;
  let signedIn = false;
  try {
    // Utan tidsgräns kan knappen fastna på "Signing in…" för alltid om svaret
    // aldrig kommer — och eftersom knappen är avstängd går det inte ens att
    // försöka igen utan att ladda om sidan.
    const r = await fetch('/api/auth/client', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: name, password }),
      signal: AbortSignal.timeout(20000),
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.error || 'Incorrect username or password.'; return; }
    session = d;
    vpStore.setItem('vp_session', JSON.stringify(d));
    signedIn = true;
    initApp();
  } catch (e) {
    err.textContent = e?.name === 'TimeoutError'
      ? 'The server did not respond. Check your connection and try again.'
      : 'Could not sign in. Please try again.';
    console.error('[VP] Inloggning misslyckades:', e);
  } finally {
    // Knappen ska alltid gå att trycka på igen, vad som än gick fel
    if (!signedIn) { btn.textContent = 'Sign in'; btn.disabled = false; }
  }
}
