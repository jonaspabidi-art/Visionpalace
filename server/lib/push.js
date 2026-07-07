const webpush = require('web-push');
const axios = require('axios');
const supabase = require('./supabase');

webpush.setVapidDetails(
  'mailto:admin@visionpalace.se',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const pushSubs = new Map(); // clientId -> PushSubscription
const onlineClients = new Set(); // clientIds currently connected

// Admin push subscriptions — one per device, keyed by endpoint so several
// devices logged into the admin account all receive notifications.
const adminPushSubs = new Map(); // endpoint -> PushSubscription
// Kept for backwards compatibility with older require() sites
const state = { adminPushSub: null };

async function saveAdminSubs() {
  await supabase.from('app_settings').upsert({
    key: 'admin_push_subs',
    value: JSON.stringify([...adminPushSubs.values()]),
    updated_at: new Date().toISOString()
  });
}

async function addAdminPushSub(sub) {
  adminPushSubs.set(sub.endpoint, sub);
  await saveAdminSubs();
}

// Load admin push subscriptions from DB on startup (including the legacy
// single-subscription key, which is migrated into the list and removed)
(async () => {
  try {
    const { data: rows } = await supabase.from('app_settings').select('key, value').in('key', ['admin_push_subs', 'admin_push_sub']);
    let migrated = false;
    for (const row of rows || []) {
      try {
        const parsed = JSON.parse(row.value);
        const subs = row.key === 'admin_push_subs' ? parsed : [parsed];
        for (const sub of subs) {
          if (isValidPushSub(sub)) adminPushSubs.set(sub.endpoint, sub);
        }
        if (row.key === 'admin_push_sub') migrated = true;
      } catch {}
    }
    if (migrated) {
      await saveAdminSubs();
      await supabase.from('app_settings').delete().eq('key', 'admin_push_sub');
    }
    console.log(`[Push] ${adminPushSubs.size} admin push subscription(s) loaded from DB`);
  } catch (e) { console.error('[Push] Failed to load admin subscriptions:', e.message); }
})();

// Send a push to every admin device; dead subscriptions (410/404) are pruned
async function webPushAdmins(title, body, data = {}) {
  if (!adminPushSubs.size) { console.log('[Push] No admin subscriptions'); return; }
  let pruned = false;
  await Promise.allSettled([...adminPushSubs.entries()].map(([endpoint, sub]) =>
    webpush.sendNotification(sub, JSON.stringify({ title, body, data }))
      .catch(e => {
        console.error(`[Push] Admin push failed: ${e.statusCode} ${e.message}`);
        if (e.statusCode === 410 || e.statusCode === 404) { adminPushSubs.delete(endpoint); pruned = true; }
      })
  ));
  if (pruned) await saveAdminSubs().catch(() => {});
}

function isValidPushSub(sub) {
  return sub
    && typeof sub.endpoint === 'string'
    && sub.endpoint.startsWith('http')
    && sub.keys
    && typeof sub.keys.auth === 'string'
    && typeof sub.keys.p256dh === 'string';
}

function clearSub(clientId) {
  pushSubs.delete(clientId);
  supabase.from('clients').update({ onesignal_player_id: null }).eq('id', clientId).then(() => {});
}

async function webPushClient(clientId, title, body, data = {}) {
  const sub = pushSubs.get(clientId);
  if (!sub) { console.log(`[Push] No subscription for client ${clientId} (total: ${pushSubs.size})`); return; }
  if (!isValidPushSub(sub)) { console.warn(`[Push] Invalid subscription for ${clientId}, removing`); clearSub(clientId); return; }
  console.log(`[Push] Sending to client ${clientId}...`);
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body, data }));
    console.log(`[Push] Delivered OK to ${clientId}`);
  } catch(e) {
    console.error(`[Push] Failed for ${clientId}: ${e.statusCode} ${e.message}`);
    if (e.statusCode === 410 || e.statusCode === 404) { clearSub(clientId); }
  }
}

async function webPushAll(title, body) {
  console.log(`[Push] Broadcasting to ${pushSubs.size} subscribers`);
  const sends = [];
  for (const [clientId, sub] of pushSubs) {
    if (!isValidPushSub(sub)) { pushSubs.delete(clientId); continue; }
    sends.push(
      webpush.sendNotification(sub, JSON.stringify({ title, body }))
        .then(() => console.log(`[Push] Broadcast OK to ${clientId}`))
        .catch(e => {
          console.error(`[Push] Broadcast failed for ${clientId}: ${e.statusCode} ${e.message}`);
          if (e.statusCode === 410 || e.statusCode === 404) clearSub(clientId);
        })
    );
  }
  await Promise.allSettled(sends);
}

async function sendPushToAll(title, body, data = {}) {
  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: process.env.ONESIGNAL_APP_ID,
      included_segments: ['All'],
      headings: { en: title },
      contents: { en: body },
      data
    }, { headers: { Authorization: `Bearer ${process.env.ONESIGNAL_API_KEY}` } });
  } catch (e) { console.error('OneSignal push failed:', e.message); }
}

async function sendPushToPlayer(playerId, title, body, data = {}) {
  if (!playerId) return;
  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: process.env.ONESIGNAL_APP_ID,
      include_player_ids: [playerId],
      headings: { en: title },
      contents: { en: body },
      data
    }, { headers: { Authorization: `Bearer ${process.env.ONESIGNAL_API_KEY}` } });
  } catch (e) { console.error('OneSignal push failed:', e.message); }
}

async function loadPushSubs() {
  const { data } = await supabase.from('clients').select('id, onesignal_player_id').not('onesignal_player_id', 'is', null);
  let count = 0;
  for (const c of data || []) {
    if (c.onesignal_player_id?.startsWith('{')) {
      try { pushSubs.set(c.id, JSON.parse(c.onesignal_player_id)); count++; } catch {}
    }
  }
  console.log(`Loaded ${count} push subscriptions from DB`);
}

module.exports = { pushSubs, onlineClients, state, adminPushSubs, addAdminPushSub, webPushAdmins, isValidPushSub, webPushClient, webPushAll, sendPushToAll, sendPushToPlayer, loadPushSubs };
