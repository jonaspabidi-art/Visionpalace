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

  // Look up previous product data by ref code (current inventory, then past sales)
  router.get('/inventory/ref-lookup', adminAuth, async (req, res) => {
    const code = (req.query.code || '').trim();
    if (!code) return res.status(400).json({ error: 'code krävs' });

    const { data: invMatches } = await supabase.from('inventory')
      .select('name, ref_code, sell_price, buy_price, image, added_at')
      .ilike('ref_code', code)
      .order('added_at', { ascending: false })
      .limit(1);
    if (invMatches?.length) {
      const { name, ref_code, sell_price, buy_price, image } = invMatches[0];
      return res.json({ match: { name, ref_code, sell_price, buy_price, image }, source: 'inventory' });
    }

    const { data: soldMatches } = await supabase.from('sale_items')
      .select('name, ref_code, sell_price, buy_price, image, sales(created_at)')
      .ilike('ref_code', code)
      .limit(50);
    if (soldMatches?.length) {
      soldMatches.sort((a, b) =>
        new Date(b.sales?.created_at || 0) - new Date(a.sales?.created_at || 0));
      const { name, ref_code, sell_price, buy_price, image } = soldMatches[0];
      return res.json({ match: { name, ref_code, sell_price, buy_price, image }, source: 'sales' });
    }

    res.json({ match: null });
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
