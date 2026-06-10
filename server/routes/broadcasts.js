const { adminAuth, clientAuth, anyAuth } = require('../lib/auth');
const { pushSubs, isValidPushSub } = require('../lib/push');
const supabase = require('../lib/supabase');
const webpush = require('web-push');

module.exports = (io) => {
  const router = require('express').Router();

  // Get broadcasts (admin: own; client: their admin's)
  router.get('/broadcasts', anyAuth, async (req, res) => {
    let query = supabase
      .from('broadcasts')
      .select('*, broadcast_media(*), broadcast_reactions(*)')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (req.isAdmin) {
      query = query.eq('admin_id', req.adminId);
    } else if (req.client?.admin_id) {
      query = query.eq('admin_id', req.client.admin_id);
    }

    const { data } = await query;
    res.json({ broadcasts: data || [] });
  });

  // Search broadcasts (admin only, own)
  router.get('/broadcasts/search', adminAuth, async (req, res) => {
    const q = req.query.q || '';
    const { data } = await supabase
      .from('broadcasts')
      .select('*, broadcast_media(*), broadcast_reactions(*)')
      .ilike('text', `%${q}%`)
      .eq('admin_id', req.adminId)
      .order('created_at', { ascending: false });
    res.json({ broadcasts: data || [] });
  });

  // Post broadcast
  router.post('/broadcasts', adminAuth, async (req, res) => {
    const { text, price, is_pinned, media, client_temp_id } = req.body;
    if (!text && (!media || media.length === 0)) return res.status(400).json({ error: 'Text eller media krävs' });

    const { data: broadcast, error } = await supabase.from('broadcasts').insert({
      text, price, is_pinned: !!is_pinned,
      admin_id: req.adminId,
      created_at: new Date().toISOString()
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

    const full = { ...broadcast, broadcast_media: broadcastMedia, broadcast_reactions: [] };

    // Notify this admin's tab(s) and this admin's clients
    io.to(`admin-${req.adminId}`).emit('admin:new_broadcast', { broadcast: full, client_temp_id: client_temp_id || null });
    io.to(`admin-clients-${req.adminId}`).emit('admin:new_broadcast', { broadcast: full, client_temp_id: null });

    res.json({ broadcast: full, client_temp_id: client_temp_id || null });

    // Push notifications to this admin's clients via in-memory pushSubs
    const pushText = text ? text.substring(0, 80) : 'Ny uppdatering';
    supabase.from('clients').select('id').eq('admin_id', req.adminId).eq('is_inactive', false)
      .then(({ data: adminClients }) => {
        const adminIds = new Set((adminClients || []).map(c => c.id));
        // If no clients have admin_id yet (seeding pending), push to all subscribers as fallback
        const targets = adminIds.size > 0
          ? [...pushSubs.entries()].filter(([id]) => adminIds.has(id))
          : [...pushSubs.entries()];
        for (const [clientId, sub] of targets) {
          if (!isValidPushSub(sub)) continue;
          webpush.sendNotification(sub, JSON.stringify({ title: 'Vision Palace', body: pushText }))
            .catch(e => { if (e.statusCode === 410 || e.statusCode === 404) pushSubs.delete(clientId); });
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
    await supabase.from('broadcasts').delete().eq('id', id).eq('admin_id', req.adminId);

    io.to(`admin-${req.adminId}`).emit('broadcast:deleted', { id });
    io.to(`admin-clients-${req.adminId}`).emit('broadcast:deleted', { id });
    res.json({ ok: true });
  });

  // Toggle pin
  router.patch('/broadcasts/:id/pin', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { data: current } = await supabase.from('broadcasts').select('is_pinned').eq('id', id).eq('admin_id', req.adminId).single();
    if (!current) return res.status(404).json({ error: 'Hittades inte' });
    const { data } = await supabase.from('broadcasts').update({ is_pinned: !current.is_pinned }).eq('id', id).select().single();
    io.to(`admin-${req.adminId}`).emit('broadcast:pin_updated', { id, is_pinned: data.is_pinned });
    io.to(`admin-clients-${req.adminId}`).emit('broadcast:pin_updated', { id, is_pinned: data.is_pinned });
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

    const { data: bc } = await supabase.from('broadcasts').select('admin_id').eq('id', broadcastId).single();
    const adminRoom = bc?.admin_id ? `admin-${bc.admin_id}` : 'admins';
    io.to(adminRoom).emit('broadcast:new_reaction', { broadcast_id: broadcastId, reactions });
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
