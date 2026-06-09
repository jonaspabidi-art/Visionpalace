const { adminAuth, clientAuth } = require('../lib/auth');
const { webPushClient } = require('../lib/push');
const supabase = require('../lib/supabase');

module.exports = (io) => {
  const router = require('express').Router();

  async function generateInvoiceNumber() {
    const mm = String(new Date().getMonth() + 1).padStart(2, '0');
    const prefix = `VP${mm}-`;
    const { data } = await supabase.from('sales').select('invoice_number').ilike('invoice_number', `${prefix}%`);
    let max = 0;
    (data || []).forEach(row => {
      const n = parseInt((row.invoice_number || '').slice(prefix.length)) || 0;
      if (n > max) max = n;
    });
    return `${prefix}${String(max + 1).padStart(3, '0')}`;
  }

  // Create a sale (admin records items sold to a client)
  router.post('/sales', adminAuth, async (req, res) => {
    const { client_id, items, notes } = req.body;
    if (!client_id || !items?.length) return res.status(400).json({ error: 'client_id och items krävs' });
    const invoice_number = await generateInvoiceNumber();
    const { data: sale, error } = await supabase.from('sales').insert({
      client_id, invoice_number, notes: notes || null,
      created_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    const rows = items.map(i => ({
      sale_id: sale.id,
      inventory_id: i.inventory_id || null,
      name: i.name, ref_code: i.ref_code || null,
      sell_price: i.sell_price ?? null, buy_price: i.buy_price ?? null,
      qty: i.qty || 1, image: i.image || null
    }));
    const { error: itemErr } = await supabase.from('sale_items').insert(rows);
    if (itemErr) return res.status(500).json({ error: itemErr.message });

    // Remove sold items from inventory
    const inventoryIds = items.map(i => i.inventory_id).filter(Boolean);
    if (inventoryIds.length) {
      await supabase.from('inventory').delete().in('id', inventoryIds);
      io.to('admins').emit('inventory:sold', { ids: inventoryIds });
    }

    const { data: full } = await supabase.from('sales').select('*, sale_items(*)').eq('id', sale.id).single();
    res.json({ sale: full });
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
      .update(updates).eq('id', req.params.id)
      .select('*, sale_items(*)').single();
    if (error) return res.status(500).json({ error: error.message });
    if (status === 'shipped') {
      const trackText = tracking_number ? ` Spårning: ${tracking_number}` : '';
      webPushClient(sale.client_id, 'Ditt paket är på väg!', `Ditt köp har skickats.${trackText}`).catch(() => {});
    }
    io.to(`client:${sale.client_id}`).emit('sale:status_updated', { sale_id: sale.id, status, shipping_carrier: sale.shipping_carrier, tracking_number: sale.tracking_number });
    res.json({ ok: true, sale });
  });

  // Delete a sale (admin)
  router.delete('/sales/:id', adminAuth, async (req, res) => {
    const { error } = await supabase.from('sales').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  });

  // List all sales (admin)
  router.get('/sales', adminAuth, async (req, res) => {
    const { data } = await supabase.from('sales')
      .select('*, sale_items(*), clients(display_name, admin_label)')
      .order('created_at', { ascending: false });
    res.json({ sales: data || [] });
  });

  // Sales for one client (admin)
  router.get('/sales/client/:clientId', adminAuth, async (req, res) => {
    const { data } = await supabase.from('sales')
      .select('*, sale_items(*)')
      .eq('client_id', req.params.clientId)
      .order('created_at', { ascending: false });
    res.json({ sales: data || [] });
  });

  // Client: own purchase history (grouped by sale)
  router.get('/purchases/me', clientAuth, async (req, res) => {
    const { data } = await supabase.from('sales')
      .select('*, sale_items(*)')
      .eq('client_id', req.client.id)
      .order('created_at', { ascending: false });
    res.json({ sales: data || [] });
  });

  return router;
};
