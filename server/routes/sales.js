const { adminAuth, clientAuth } = require('../lib/auth');
const { webPushClient } = require('../lib/push');
const supabase = require('../lib/supabase');

module.exports = (io) => {
  const router = require('express').Router();

  // A stalled keep-alive socket towards Supabase can otherwise hang a query
  // for minutes with the sale half-created and the app stuck on "Skapar…"
  const dbTimeout = () => AbortSignal.timeout(15000);

  async function generateInvoiceNumber() {
    const mm = String(new Date().getMonth() + 1).padStart(2, '0');
    const prefix = `VP${mm}-`;
    const { data, error } = await supabase.from('sales').select('invoice_number').ilike('invoice_number', `${prefix}%`).abortSignal(dbTimeout());
    if (error) throw new Error(`fakturanummer: ${error.message}`);
    let max = 0;
    (data || []).forEach(row => {
      const n = parseInt((row.invoice_number || '').slice(prefix.length)) || 0;
      if (n > max) max = n;
    });
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }

  // Create a sale
  router.post('/sales', adminAuth, async (req, res) => {
    const t0 = Date.now();
    const steps = [];
    let t = t0;
    const step = (label) => { const now = Date.now(); steps.push(`${label} ${now - t}ms`); t = now; };
    try {
      const { client_id, items, notes } = req.body;
      if (!client_id || !items?.length) return res.status(400).json({ error: 'client_id och items krävs' });
      const invoice_number = await generateInvoiceNumber();
      step('nr');
      const { data: sale, error } = await supabase.from('sales').insert({
        client_id, invoice_number, notes: notes || null,
        admin_id: req.adminId,
        created_at: new Date().toISOString()
      }).select().abortSignal(dbTimeout()).single();
      if (error) return res.status(500).json({ error: error.message });
      step('sale');

      // Look up product images server-side. Legacy inventory/lens rows store
      // base64 images — shipping those through the sale request (and back in
      // the response) made createSale hang for minutes on mobile connections.
      const imgInvIds = [...new Set(items.filter(i => i.inventory_id).map(i => i.inventory_id))];
      const imgLensIds = [...new Set(items.filter(i => i.lens_id).map(i => i.lens_id))];
      const imageByInv = {}, imageByLens = {};
      if (imgInvIds.length) {
        const { data } = await supabase.from('inventory').select('id, image').in('id', imgInvIds).abortSignal(dbTimeout());
        (data || []).forEach(r => { imageByInv[r.id] = r.image; });
      }
      if (imgLensIds.length) {
        const { data } = await supabase.from('lenses').select('id, image').in('id', imgLensIds).abortSignal(dbTimeout());
        (data || []).forEach(r => { imageByLens[r.id] = r.image; });
      }
      step('bilder');

      const rows = items.map(i => ({
        sale_id: sale.id,
        inventory_id: i.inventory_id || null,
        lens_id: i.lens_id || null,
        lens_variant_id: i.lens_variant_id || null,
        lens_color: i.lens_color || null,
        name: i.name, ref_code: i.ref_code || null,
        sell_price: i.sell_price ?? null, buy_price: i.buy_price ?? null,
        qty: i.qty || 1,
        // DB image first; i.image kept as fallback for older cached clients
        image: (i.inventory_id ? imageByInv[i.inventory_id] : i.lens_id ? imageByLens[i.lens_id] : null) ?? i.image ?? null
      }));
      const { error: itemErr } = await supabase.from('sale_items').insert(rows).abortSignal(dbTimeout());
      if (itemErr) return res.status(500).json({ error: itemErr.message });
      step('rader');

      // Remove sold glasses from inventory (shared across all admins)
      const inventoryIds = items.filter(i => i.inventory_id).map(i => i.inventory_id);
      if (inventoryIds.length) {
        const { error: delErr } = await supabase.from('inventory').delete().in('id', inventoryIds).abortSignal(dbTimeout());
        if (delErr) console.error(`[Sale] ${invoice_number}: lagerborttagning misslyckades: ${delErr.message}`);
        io.emit('inventory:sold', { ids: inventoryIds });
      }
      step('lager');

      // Decrement lens variant stock (shared across all admins)
      const lensItems = items.filter(i => i.lens_variant_id);
      for (const item of lensItems) {
        const { data: variant } = await supabase.from('lens_variants').select('stock_count').eq('id', item.lens_variant_id).abortSignal(dbTimeout()).single();
        if (variant) {
          await supabase.from('lens_variants').update({
            stock_count: Math.max(0, (variant.stock_count || 0) - (item.qty || 1))
          }).eq('id', item.lens_variant_id).abortSignal(dbTimeout());
        }
      }
      step('linser');

      console.log(`[Sale] ${invoice_number} skapad på ${Date.now() - t0}ms (${steps.join(', ')})`);
      // Slim response — createSale only checks r.ok, and re-fetching the sale
      // with its items would ship any legacy base64 images back over the wire
      res.json({ sale });
    } catch (e) {
      console.error(`[Sale] POST /sales avbröts efter ${Date.now() - t0}ms (${steps.join(', ')}):`, e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Serverfel vid skapande av försäljning' });
    }
  });

  // Update sale status (admin)
  router.patch('/sales/:id/status', adminAuth, async (req, res) => {
    const { status, shipping_carrier, tracking_number } = req.body;
    const valid = ['unpaid', 'paid', 'shipped', 'delivered', 'cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Ogiltig status' });
    const updates = { status };
    if (status === 'shipped') {
      updates.shipping_carrier = shipping_carrier || null;
      updates.tracking_number = tracking_number || null;
      updates.shipped_at = new Date().toISOString();
    }
    const { data: sale, error } = await supabase.from('sales')
      .update(updates).eq('id', req.params.id).eq('admin_id', req.adminId)
      .select('*, sale_items(*)').single();
    if (error || !sale) return res.status(error ? 500 : 404).json({ error: error?.message || 'Hittades inte' });
    if (status === 'shipped') {
      const trackText = tracking_number ? ` Spårning: ${tracking_number}` : '';
      webPushClient(sale.client_id, 'Ditt paket är på väg!', `Ditt köp har skickats.${trackText}`, { url: '/client', tab: 'purchases' }).catch(() => {});
    }
    io.to(`client:${sale.client_id}`).emit('sale:status_updated', { sale_id: sale.id, status, shipping_carrier: sale.shipping_carrier, tracking_number: sale.tracking_number });
    res.json({ ok: true, sale });
  });

  // Delete a sale (admin)
  router.delete('/sales/:id', adminAuth, async (req, res) => {
    const { error } = await supabase.from('sales').delete().eq('id', req.params.id).eq('admin_id', req.adminId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // List all sales for this admin
  router.get('/sales', adminAuth, async (req, res) => {
    const { data } = await supabase.from('sales')
      .select('*, sale_items(*), clients(display_name, admin_label)')
      .eq('admin_id', req.adminId)
      .order('created_at', { ascending: false });
    res.json({ sales: data || [] });
  });

  // Sales for one client (admin, ownership checked)
  router.get('/sales/client/:clientId', adminAuth, async (req, res) => {
    const { data } = await supabase.from('sales')
      .select('*, sale_items(*)')
      .eq('client_id', req.params.clientId)
      .eq('admin_id', req.adminId)
      .order('created_at', { ascending: false });
    res.json({ sales: data || [] });
  });

  // Client: own purchase history
  router.get('/purchases/me', clientAuth, async (req, res) => {
    const { data } = await supabase.from('sales')
      .select('*, sale_items(*)')
      .eq('client_id', req.client.id)
      .order('created_at', { ascending: false });
    res.json({ sales: data || [] });
  });

  return router;
};
