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

// Use a plain object so mutation works via reference across modules
const state = { adminPushSub: null };

// Load admin push subscription from DB on startup so it survives server restarts
supabase.from('app_settings').select('value').eq('key', 'admin_push_sub').single()
  .then(({ data }) => {
    if (data?.value) {
      try {
        const sub = JSON.parse(data.value);
        if (isValidPushSub(sub)) { state.adminPushSub = sub; console.log('[Push] Admin push subscription loaded from DB'); }
      } catch {}
    }
  });

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

async function webPushClient(clientId, title, body) {
  const sub = pushSubs.get(clientId);
  if (!sub) { console.log(`[Push] No subscription for client ${clientId} (total: ${pushSubs.size})`); return; }
  if (!isValidPushSub(sub)) { console.warn(`[Push] Invalid subscription for ${clientId}, removing`); clearSub(clientId); return; }
  console.log(`[Push] Sending to client ${clientId}...`);
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body }));
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

module.exports = { pushSubs, onlineClients, state, isValidPushSub, webPushClient, webPushAll, sendPushToAll, sendPushToPlayer, loadPushSubs };
