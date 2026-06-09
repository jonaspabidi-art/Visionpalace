const { adminAuth, clientAuth, anyAuth, verifyPassword, hashPassword } = require('../lib/auth');
const { state, isValidPushSub, webPushClient, sendPushToPlayer } = require('../lib/push');
const supabase = require('../lib/supabase');
const webpush = require('web-push');

module.exports = (io) => {
  const router = require('express').Router();

  // Get messages for client thread
  router.get('/messages/:clientId', adminAuth, async (req, res) => {
    const { data } = await supabase.from('messages')
      .select('*, message_media(*)')
      .eq('client_id', req.params.clientId)
      .order('created_at', { ascending: true });
    res.json({ messages: data || [] });
  });

  // Client gets own messages
  router.get('/messages/me/thread', clientAuth, async (req, res) => {
    const { data } = await supabase.from('messages')
      .select('*, message_media(*)')
      .eq('client_id', req.client.id)
      .order('created_at', { ascending: true });
    res.json({ messages: data || [] });
  });

  // Admin sends message to client
  router.post('/messages/:clientId', adminAuth, async (req, res) => {
    const { clientId } = req.params;
    const { text, media, message_type, metadata } = req.body;

    const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
    if (!client) return res.status(404).json({ error: 'Klient hittades inte' });

    console.log('[msg] type=%s metadata=%j', message_type, metadata);
    const { data: msg, error } = await supabase.from('messages').insert({
      client_id: clientId, sender: 'admin', text: text || null,
      message_type: message_type || 'text',
      metadata: metadata || null,
      created_at: new Date().toISOString()
    }).select().single();
    if (error) { console.error('[msg] insert error:', error); return res.status(500).json({ error: error.message }); }

    if (media && media.length > 0) {
      const rows = media.map(m => ({ message_id: msg.id, storage_url: m.url, thumbnail_url: m.thumbUrl, type: m.type }));
      await supabase.from('message_media').insert(rows);
    }

    const full = await supabase.from('messages').select('*, message_media(*)').eq('id', msg.id).single();

    io.to(`client:${clientId}`).emit('admin:new_message', { message: full.data });
    io.to(`admin-${req.adminId}`).emit('message:sent', { message: full.data });

    webPushClient(clientId, 'Vision Palace', 'Nytt meddelande').catch(() => {});
    if (client.onesignal_player_id) {
      await sendPushToPlayer(client.onesignal_player_id, 'Vision Palace', 'Nytt meddelande från admin', { type: 'message', client_id: clientId });
    }

    res.json({ message: full.data });
  });

  // Client sends message
  router.post('/messages/me/send', clientAuth, async (req, res) => {
    const { text, media } = req.body;
    const { data: msg, error } = await supabase.from('messages').insert({
      client_id: req.client.id, sender: 'client', text, created_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    if (media && media.length > 0) {
      const rows = media.map(m => ({ message_id: msg.id, storage_url: m.url, thumbnail_url: m.thumbUrl, type: m.type }));
      await supabase.from('message_media').insert(rows);
    }

    const full = await supabase.from('messages').select('*, message_media(*)').eq('id', msg.id).single();
    const adminRoom = req.client.admin_id ? `admin-${req.client.admin_id}` : 'admins';
    io.to(adminRoom).emit('client:new_message', { message: full.data, client: req.client });

    if (state.adminPushSub && isValidPushSub(state.adminPushSub)) {
      webpush.sendNotification(state.adminPushSub, JSON.stringify({
        title: req.client.admin_label || req.client.display_name,
        body: text || 'Skickade ett media'
      })).catch(e => {
        console.error(`[Push] Admin push failed: ${e.statusCode} ${e.message}`);
        if (e.statusCode === 410 || e.statusCode === 404) { state.adminPushSub = null; supabase.from('app_settings').delete().eq('key', 'admin_push_sub').then(() => {}); }
      });
    }

    res.json({ message: full.data });
  });

  // Client updates own profile
  router.patch('/me/profile', clientAuth, async (req, res) => {
    const { display_name, full_name, address, phone, new_password, current_password } = req.body;
    if (!current_password) return res.status(400).json({ error: 'Current password is required.' });
    if (!verifyPassword(current_password, req.client.password_hash))
      return res.status(401).json({ error: 'Current password is incorrect.' });
    const updates = {};
    if (display_name && display_name.trim()) updates.display_name = display_name.trim();
    if (full_name !== undefined) updates.full_name = full_name.trim() || null;
    if (address !== undefined) updates.address = address.trim() || null;
    if (phone !== undefined) updates.phone = phone.trim() || null;
    if (new_password) {
      if (new_password.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters.' });
      updates.password_hash = hashPassword(new_password);
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });
    const { data, error } = await supabase.from('clients').update(updates).eq('id', req.client.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, display_name: data.display_name, full_name: data.full_name, address: data.address, phone: data.phone });
  });

  // Get own profile (client)
  router.get('/me', clientAuth, async (req, res) => {
    res.json({
      client_id: req.client.id,
      display_name: req.client.display_name,
      full_name: req.client.full_name || null,
      address: req.client.address || null,
      phone: req.client.phone || null
    });
  });

  // Mark messages as read
  router.post('/messages/:clientId/read', anyAuth, async (req, res) => {
    const { clientId } = req.params;
    const sender = req.isAdmin ? 'client' : 'admin';
    await supabase.from('messages')
      .update({ read: true, read_at: new Date().toISOString() })
      .eq('client_id', clientId)
      .eq('sender', sender)
      .eq('read', false);

    if (req.isAdmin) {
      io.to(`admin-${req.adminId}`).emit('messages:read', { client_id: clientId });
    } else {
      const adminRoom = req.client.admin_id ? `admin-${req.client.admin_id}` : 'admins';
      io.to(adminRoom).emit('client:read_receipt', { client_id: clientId });
    }

    res.json({ ok: true });
  });

  // Admin: unread counts per client (own clients only)
  router.get('/messages/unread', adminAuth, async (req, res) => {
    const { data: adminClients } = await supabase.from('clients').select('id').eq('admin_id', req.adminId);
    const clientIds = (adminClients || []).map(c => c.id);
    if (!clientIds.length) return res.json({ unread: {} });

    const { data } = await supabase.from('messages')
      .select('client_id')
      .eq('sender', 'client')
      .eq('read', false)
      .in('client_id', clientIds);

    const counts = {};
    (data || []).forEach(m => { counts[m.client_id] = (counts[m.client_id] || 0) + 1; });
    res.json({ unread: counts });
  });

  return router;
};
