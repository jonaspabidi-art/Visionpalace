async function setupPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission === 'denied') return;
  if (Notification.permission === 'default') {
    document.getElementById('notif-banner').style.display = 'flex';
    return;
  }
  await registerClientPushSub();
}

async function enableNotifs() {
  const perm = await Notification.requestPermission();
  document.getElementById('notif-banner').style.display = 'none';
  if (perm !== 'granted') return;
  await registerClientPushSub();
}

async function registerClientPushSub() {
  try {
    const sw = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('SW timeout')), 10000))
    ]);

    let sub = await sw.pushManager.getSubscription();
    if (!sub) {
      // No subscription yet — create one
      const kr = await fetch('/api/push/vapid-key');
      if (!kr.ok) throw new Error('vapid-key ' + kr.status);
      const { publicKey } = await kr.json();
      if (!publicKey) throw new Error('no publicKey');
      sub = await sw.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      if (!sub) throw new Error('subscribe returned null');
    }

    // Always save to server so DB stays in sync after server restarts
    const r = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': session.session_token },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    if (!r.ok) throw new Error('server ' + r.status);
    console.log('[Push] subscription saved');
  } catch(e) {
    console.error('[Push] setup failed:', e);
  }
}

function urlBase64ToUint8Array(b64) {
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
