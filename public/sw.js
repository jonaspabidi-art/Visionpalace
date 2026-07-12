const CACHE = 'vp-v19';
const SHELL = ['/client', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/admin')) return;

  e.respondWith(
    fetch(e.request)
      .then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  const title = data.title || 'Vision Palace';
  const body = data.body || 'Nytt meddelande';
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: data.data || {}
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = data.url || '/client'; // '/admin' for admin notifications
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      // Focus a window of the RIGHT app (admin vs client), never the other one
      const win = wins.find(w => {
        try { return new URL(w.url).pathname.startsWith(target); } catch { return false; }
      });
      if (win) {
        win.postMessage({ type: 'notification-click', ...data });
        return win.focus();
      }
      // Fresh open: pass the navigation target in the hash so the app can
      // land on the right chat/tab after boot
      let url = target;
      if (data.client_id) url += `#client=${data.client_id}`;
      else if (data.tab) url += `#tab=${data.tab}`;
      return clients.openWindow(url);
    })
  );
});
