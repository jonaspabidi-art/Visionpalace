const { adminAuth, clientAuth } = require('../lib/auth');
const { pushSubs, state, isValidPushSub } = require('../lib/push');
const supabase = require('../lib/supabase');

module.exports = (io) => {
  const router = require('express').Router();

  // Get VAPID public key
  router.get('/push/vapid-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
  });

  // Save web push subscription (client)
  router.post('/push/subscribe', clientAuth, async (req, res) => {
    const { subscription } = req.body;
    console.log(`[Push] Subscribe request from ${req.client.display_name}, endpoint present: ${!!subscription?.endpoint}`);
    if (!isValidPushSub(subscription)) {
      console.warn(`[Push] Invalid subscription body from ${req.client.display_name}:`, JSON.stringify(subscription)?.substring(0, 200));
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    pushSubs.set(req.client.id, subscription);
    const { error: dbErr } = await supabase.from('clients').update({ onesignal_player_id: JSON.stringify(subscription) }).eq('id', req.client.id);
    if (dbErr) console.error(`[Push] DB save failed for ${req.client.display_name}:`, dbErr.message);
    else console.log(`[Push] Subscription saved to DB for ${req.client.display_name}`);
    res.json({ ok: true });
  });

  // Save web push subscription (admin)
  router.post('/push/admin-subscribe', adminAuth, async (req, res) => {
    const { subscription } = req.body;
    console.log(`[Push] Admin subscribe request, endpoint present: ${!!subscription?.endpoint}`);
    if (!isValidPushSub(subscription)) {
      console.warn('[Push] Invalid admin subscription body');
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    state.adminPushSub = subscription;
    await supabase.from('app_settings').upsert({ key: 'admin_push_sub', value: JSON.stringify(subscription), updated_at: new Date().toISOString() });
    console.log('[Push] Admin push subscription registered and saved to DB');
    res.json({ ok: true });
  });

  // Save OneSignal player ID for client
  router.post('/onesignal/register', clientAuth, async (req, res) => {
    const { player_id } = req.body;
    await supabase.from('clients').update({ onesignal_player_id: player_id }).eq('id', req.client.id);
    res.json({ ok: true });
  });

  return router;
};
