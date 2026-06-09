const { adminAuth } = require('../lib/auth');
const supabase = require('../lib/supabase');

module.exports = (io) => {
  const router = require('express').Router();

  // List all lenses with variants
  router.get('/lenses', adminAuth, async (req, res) => {
    const { data, error } = await supabase.from('lenses')
      .select('*, lens_variants(*)')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ lenses: data || [] });
  });

  // Create lens + variants
  router.post('/lenses', adminAuth, async (req, res) => {
    const { name, ref_code, sell_price, buy_price, notes, image, variants } = req.body;
    if (!name) return res.status(400).json({ error: 'Namn krävs' });
    const { data: lens, error } = await supabase.from('lenses').insert({
      name, ref_code: ref_code || null,
      sell_price: sell_price || null, buy_price: buy_price || null,
      notes: notes || null, image: image || null
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    if (variants?.length) {
      const rows = variants.map(v => ({ lens_id: lens.id, color_name: v.color_name, stock_count: v.stock_count || 0 }));
      await supabase.from('lens_variants').insert(rows);
    }

    const { data: full } = await supabase.from('lenses').select('*, lens_variants(*)').eq('id', lens.id).single();
    res.json({ lens: full });
  });

  // Update lens + replace variants
  router.patch('/lenses/:id', adminAuth, async (req, res) => {
    const { name, ref_code, sell_price, buy_price, notes, image, variants } = req.body;
    const update = { name, ref_code: ref_code || null, sell_price: sell_price || null, buy_price: buy_price || null, notes: notes || null };
    if (image !== undefined) update.image = image || null;

    const { error } = await supabase.from('lenses').update(update).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });

    if (variants !== undefined) {
      // Delete old variants then re-insert
      await supabase.from('lens_variants').delete().eq('lens_id', req.params.id);
      if (variants.length) {
        const rows = variants.map(v => ({ lens_id: req.params.id, color_name: v.color_name, stock_count: v.stock_count || 0 }));
        await supabase.from('lens_variants').insert(rows);
      }
    }

    const { data: full } = await supabase.from('lenses').select('*, lens_variants(*)').eq('id', req.params.id).single();
    res.json({ lens: full });
  });

  // Delete lens (variants cascade)
  router.delete('/lenses/:id', adminAuth, async (req, res) => {
    const { error } = await supabase.from('lenses').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  return router;
};
