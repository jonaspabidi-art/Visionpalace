const { adminAuth } = require('../lib/auth');
const supabase = require('../lib/supabase');

module.exports = (io) => {
  const router = require('express').Router();

  // Get inventory items
  router.get('/inventory', adminAuth, async (req, res) => {
    const { data, error } = await supabase.from('inventory')
      .select('id, ref_code, name, buy_price, sell_price, notes, image, added_at')
      .order('added_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [] });
  });

  // Add inventory item
  router.post('/inventory', adminAuth, async (req, res) => {
    const { ref_code, name, buy_price, sell_price, notes, image } = req.body;
    if (!name) return res.status(400).json({ error: 'Namn krävs' });
    const { data, error } = await supabase.from('inventory').insert({
      ref_code: ref_code || null, name, buy_price: buy_price || null,
      sell_price: sell_price || null, notes: notes || null,
      image: image || null, added_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
  });

  // Update inventory item
  router.patch('/inventory/:id', adminAuth, async (req, res) => {
    const { ref_code, name, buy_price, sell_price, notes, image } = req.body;
    const update = { ref_code: ref_code || null, name, buy_price: buy_price || null,
      sell_price: sell_price || null, notes: notes || null };
    if (image !== undefined) update.image = image || null;
    const { data, error } = await supabase.from('inventory').update(update)
      .eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ item: data });
  });

  // Delete inventory item
  router.delete('/inventory/:id', adminAuth, async (req, res) => {
    const { error } = await supabase.from('inventory').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  return router;
};
