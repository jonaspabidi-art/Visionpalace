const { adminAuth } = require('../lib/auth');
const { pushSubs, onlineClients } = require('../lib/push');
const supabase = require('../lib/supabase');

module.exports = (io) => {
  const router = require('express').Router();

  // Get all clients for this admin
  router.get('/clients', adminAuth, async (req, res) => {
    const { data: clients } = await supabase.from('clients')
      .select('*')
      .eq('admin_id', req.adminId)
      .order('last_seen_at', { ascending: false });

    const clientIds = (clients || []).map(c => c.id);
    let unread = {};
    if (clientIds.length) {
      const { data: unreadData } = await supabase.from('messages')
        .select('client_id')
        .eq('sender', 'client')
        .eq('read', false)
        .in('client_id', clientIds);
      (unreadData || []).forEach(m => { unread[m.client_id] = (unread[m.client_id] || 0) + 1; });
    }

    const result = (clients || []).map(c => ({ ...c, unread_count: unread[c.id] || 0, is_online: onlineClients.has(c.id) }));
    res.json({ clients: result });
  });

  // Update client label
  router.patch('/clients/:id/label', adminAuth, async (req, res) => {
    const { admin_label } = req.body;
    const { data } = await supabase.from('clients').update({ admin_label }).eq('id', req.params.id).eq('admin_id', req.adminId).select().single();
    if (!data) return res.status(404).json({ error: 'Klient hittades inte' });
    io.to(`admin-${req.adminId}`).emit('client:updated', { client: data });
    res.json({ client: data });
  });

  // Toggle inactive
  router.patch('/clients/:id/inactive', adminAuth, async (req, res) => {
    const { data: current } = await supabase.from('clients').select('is_inactive').eq('id', req.params.id).eq('admin_id', req.adminId).single();
    if (!current) return res.status(404).json({ error: 'Klient hittades inte' });
    const { data } = await supabase.from('clients').update({ is_inactive: !current.is_inactive }).eq('id', req.params.id).select().single();
    io.to(`admin-${req.adminId}`).emit('client:updated', { client: data });
    res.json({ client: data });
  });

  // Delete client entirely
  router.delete('/clients/:id', adminAuth, async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('clients').delete().eq('id', id).eq('admin_id', req.adminId);
    if (error) return res.status(500).json({ error: error.message });
    pushSubs.delete(id);
    io.to(`admin-${req.adminId}`).emit('client:deleted', { client_id: id });
    res.json({ ok: true });
  });

  return router;
};
