const { adminAuth, clientAuth, anyAuth } = require('../lib/auth');
const { pushSubs, isValidPushSub } = require('../lib/push');
const supabase = require('../lib/supabase');
const webpush = require('web-push');

module.exports = (io) => {
  const router = require('express').Router();

  // Get broadcasts
  router.get('/broadcasts', anyAuth, async (req, res) => {
    const { data } = await supabase
      .from('broadcasts')
      .select('*, broadcast_media(*), broadcast_reactions(*)')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    res.json({ broadcasts: data || [] });
  });

  // Search broadcasts
  router.get('/broadcasts/search', adminAuth, async (req, res) => {
    const q = req.query.q || '';
    const { data } = await supabase
      .from('broadcasts')
      .select('*, broadcast_media(*), broadcast_reactions(*)')
      .ilike('text', `%${q}%`)
      .order('created_at', { ascending: false });
    res.json({ broadcasts: data || [] });
  });

  // Post broadcast
  router.post('/broadcasts', adminAuth, async (req, res) => {
    const { text, price, is_pinned, media, client_temp_id } = req.body;
    if (!text && (!media || media.length === 0)) return res.status(400).json({ error: 'Text eller media krävs' });

    const { data: broadcast, error } = await supabase.from('broadcasts').insert({
      text, price, is_pinned: !!is_pinned, created_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    let broadcastMedia = [];
    if (media && media.length > 0) {
      const mediaRows = media.map(m => ({
        broadcast_id: broadcast.id,
        storage_url: m.url,
        thumbnail_url: m.thumbUrl,
        type: m.type
      }));
      const { data: insertedMedia } = await supabase.from('broadcast_media').insert(mediaRows).select();
      broadcastMedia = insertedMedia || [];
    }

    // Build full object in memory — avoids a third round-trip to Supabase
    const full = { ...broadcast, broadcast_media: broadcastMedia, broadcast_reactions: [] };

    io.emit('admin:new_broadcast', { broadcast: full, client_temp_id: client_temp_id || null });
    res.json({ broadcast: full, client_temp_id: client_temp_id || null });

    // Push notifications fire in background — never block the response
    const pushText = text ? text.substring(0, 80) : 'Ny uppdatering';
    // Query DB directly so push works even after server restart (in-memory map may be stale)
    supabase.from('clients').select('id, onesignal_player_id').eq('is_inactive', false)
      .then(({ data: allClients }) => {
        for (const c of allClients || []) {
          if (c.onesignal_player_id?.startsWith('{')) {
            try {
              const sub = JSON.parse(c.onesignal_player_id);
              if (isValidPushSub(sub)) {
                pushSubs.set(c.id, sub);
                webpush.sendNotification(sub, JSON.stringify({ title: 'Vision Palace', body: pushText }))
                  .catch(e => { if (e.statusCode === 410 || e.statusCode === 404) pushSubs.delete(c.id); });
              }
            } catch {}
          }
        }
      });
  });

  // Delete broadcast
  router.delete('/broadcasts/:id', adminAuth, async (req, res) => {
    const { id } = req.params;

    const { data: media } = await supabase.from('broadcast_media').select('storage_url, thumbnail_url').eq('broadcast_id', id);
    if (media && media.length > 0) {
      const files = [];
      for (const m of media) {
        if (m.storage_url) files.push(m.storage_url.split('/').pop());
        if (m.thumbnail_url && m.thumbnail_url !== m.storage_url) files.push(m.thumbnail_url.split('/').pop());
      }
      if (files.length > 0) await supabase.storage.from('media').remove(files);
    }

    await supabase.from('broadcast_media').delete().eq('broadcast_id', id);
    await supabase.from('broadcast_reactions').delete().eq('broadcast_id', id);
    await supabase.from('broadcasts').delete().eq('id', id);

    io.emit('broadcast:deleted', { id });
    res.json({ ok: true });
  });

  // Toggle pin
  router.patch('/broadcasts/:id/pin', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { data: current } = await supabase.from('broadcasts').select('is_pinned').eq('id', id).single();
    if (!current) return res.status(404).json({ error: 'Hittades inte' });
    const { data } = await supabase.from('broadcasts').update({ is_pinned: !current.is_pinned }).eq('id', id).select().single();
    io.emit('broadcast:pin_updated', { id, is_pinned: data.is_pinned });
    res.json({ broadcast: data });
  });

  // React to broadcast
  router.post('/reactions/:broadcastId', clientAuth, async (req, res) => {
    const { broadcastId } = req.params;
    const { reaction } = req.body;
    if (!['interested', 'not_interested'].includes(reaction)) return res.status(400).json({ error: 'Ogiltig reaktion' });

    await supabase.from('broadcast_reactions')
      .upsert({ broadcast_id: broadcastId, client_id: req.client.id, reaction }, { onConflict: 'broadcast_id,client_id' });

    const { data: reactions } = await supabase.from('broadcast_reactions')
      .select('*, clients(display_name, admin_label)')
      .eq('broadcast_id', broadcastId);

    io.to('admins').emit('broadcast:new_reaction', { broadcast_id: broadcastId, reactions });
    res.json({ reactions });
  });

  // Get reactions for broadcast
  router.get('/reactions/:broadcastId', adminAuth, async (req, res) => {
    const { data } = await supabase.from('broadcast_reactions')
      .select('*, clients(display_name, admin_label)')
      .eq('broadcast_id', req.params.broadcastId);
    res.json({ reactions: data || [] });
  });

  return router;
};
