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

  // Log the purchase when stock is added. The inventory row is deleted on sale,
  // so this is the only lasting record that the item was ever bought.
  // Fire-and-forget on purpose: bookkeeping must never block adding stock, and
  // it must not fail before the 009 migration has been run.
  function logPurchase({ item, adminId, source = 'manual', qty = 1, documentUrl = null }) {
    supabase.from('purchases').insert({
      admin_id: adminId,
      inventory_id: item.id,
      name: item.name,
      ref_code: item.ref_code || null,
      buy_price: item.buy_price ?? null,
      qty,
      source,
      document_url: documentUrl,
      purchased_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.error(`[Purchase] Kunde inte logga inköp av "${item.name}": ${error.message}`);
    }, e => console.error('[Purchase] Logging kastade:', e?.message || e));
  }

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
    logPurchase({ item: data, adminId: req.adminId });
    res.json({ item: data });
  });

  // Purchase log (bookkeeping). Optional ?from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get('/purchases', adminAuth, async (req, res) => {
    let q = supabase.from('purchases')
      .select('id, name, ref_code, buy_price, qty, source, document_url, purchased_at, admin_id')
      .order('purchased_at', { ascending: false });
    if (req.query.from) q = q.gte('purchased_at', `${req.query.from}T00:00:00Z`);
    if (req.query.to) q = q.lte('purchased_at', `${req.query.to}T23:59:59Z`);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ purchases: data || [] });
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

  // Fyll på lagret med fler exemplar av en modell som redan finns. Tidigare
  // fick man skapa om produkten från början för att få 3 → 4, med risk att
  // namn eller pris skrevs olika och högen delade upp sig i två kort.
  router.post('/inventory/:id/restock', adminAuth, async (req, res) => {
    try {
      const qty = Math.max(1, Math.min(50, parseInt(req.body.qty, 10) || 1));
      const { data: src, error: srcErr } = await supabase.from('inventory')
        .select('*').eq('id', req.params.id).maybeSingle();
      if (srcErr) return res.status(500).json({ error: srcErr.message });
      if (!src) return res.status(404).json({ error: 'Varan finns inte i lagret' });

      const now = new Date().toISOString();
      const rows = Array.from({ length: qty }, () => ({
        ref_code: src.ref_code, name: src.name,
        buy_price: src.buy_price, sell_price: src.sell_price,
        notes: src.notes, image: src.image,
        added_at: now,
      }));
      const { data: created, error } = await supabase.from('inventory').insert(rows).select();
      if (error) return res.status(500).json({ error: error.message });

      // Samma bokföringsspår som när varan skapas — de nya paren har ju kommit
      // in i lagret. En rad per exemplar, precis som logPurchase gör annars.
      for (const row of created || []) logPurchase({ item: row, adminId: req.adminId });

      console.log(`[Inventory] +${qty} av "${src.name}" (${src.ref_code || 'utan ref'})`);
      res.json({ items: created || [], added: (created || []).length });
    } catch (e) {
      console.error('[Inventory] Restock misslyckades:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Kunde inte fylla på lagret' });
    }
  });

  // Update every pair of the same model at once. Lagret har en rad per par, så
  // ett namn- eller prisbyte måste gälla hela högen — annars delar den upp sig
  // i flera kort i vyn.
  router.patch('/inventory', adminAuth, async (req, res) => {
    const { ids, ref_code, name, buy_price, sell_price, notes, image } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids krävs' });
    if (!name) return res.status(400).json({ error: 'Namn krävs' });
    const update = { ref_code: ref_code || null, name, buy_price: buy_price || null,
      sell_price: sell_price || null, notes: notes || null };
    if (image !== undefined) update.image = image || null;
    const { data, error } = await supabase.from('inventory').update(update).in('id', ids).select();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [], updated: (data || []).length });
  });

  // Delete several pairs at once (hela högen). DELETE tar ingen kropp, därav POST.
  router.post('/inventory/delete', adminAuth, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids krävs' });
    const { error } = await supabase.from('inventory').delete().in('id', ids);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, deleted: ids.length });
  });

  // Delete inventory item
  router.delete('/inventory/:id', adminAuth, async (req, res) => {
    const { error } = await supabase.from('inventory').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  return router;
};
