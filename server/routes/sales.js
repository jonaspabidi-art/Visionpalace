const { adminAuth, clientAuth } = require('../lib/auth');
const { webPushClient } = require('../lib/push');
const supabase = require('../lib/supabase');

module.exports = (io) => {
  const router = require('express').Router();

  // A stalled keep-alive socket towards Supabase can otherwise hang a query
  // for minutes with the sale half-created and the app stuck on "Skapar…"
  const dbTimeout = () => AbortSignal.timeout(10000);

  // Reads that fail (typically a dead keep-alive connection after the server
  // has been idle) get one retry on a fresh attempt. Reads only — a write
  // that timed out may still have reached the database and must not be rerun.
  async function retryRead(label, queryFn) {
    let res = await queryFn();
    if (res.error) {
      console.warn(`[Sale] ${label} misslyckades (${res.error.message}) — försöker igen`);
      res = await queryFn();
    }
    return res;
  }

  // Villkoren som gäller just nu. Bäst-möjligt: kan de inte läsas skapas säljet
  // ändå, och avräkningen faller tillbaka på konfigurationen som förut.
  async function settlementTerms() {
    try {
      const { data } = await supabase.from('app_settings')
        .select('value').eq('key', 'settlement_config').abortSignal(dbTimeout()).maybeSingle();
      const cfg = data?.value ? JSON.parse(data.value) : null;
      const pct = Number(cfg?.commission_pct);
      const rate = Number(cfg?.eur_sek_rate);
      return {
        commission_pct: Number.isFinite(pct) && pct > 0 ? pct : null,
        eur_sek_rate: Number.isFinite(rate) && rate > 0 ? rate : null,
      };
    } catch (e) {
      console.warn('[Sale] Kunde inte läsa avräkningsvillkoren:', e?.message || e);
      return { commission_pct: null, eur_sek_rate: null };
    }
  }

  async function generateInvoiceNumber() {
    const mm = String(new Date().getMonth() + 1).padStart(2, '0');
    const prefix = `VP${mm}-`;
    const { data, error } = await retryRead('fakturanummer', () =>
      supabase.from('sales').select('invoice_number').ilike('invoice_number', `${prefix}%`).abortSignal(dbTimeout()));
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
      const createdAtIso = new Date().toISOString();
      // Kursen och provisionssatsen fryses på säljet. Euron rör sig under året,
      // och utan det här skulle en kursändring i augusti räkna om ett sälj från
      // mars. Misslyckas uppslaget lämnas de tomma — då används konfigurationens
      // värden som förut, och ett sälj får aldrig falla på det här.
      const terms = await settlementTerms();
      let { data: sale, error } = await supabase.from('sales').insert({
        client_id, invoice_number, notes: notes || null,
        admin_id: req.adminId,
        commission_pct: terms.commission_pct,
        eur_sek_rate: terms.eur_sek_rate,
        created_at: createdAtIso
      }).select().abortSignal(dbTimeout()).single();
      if (error) {
        // The insert may have reached the database even though the response
        // was lost on a stalled connection — verify before failing
        const { data: existing } = await retryRead('säljverifiering', () =>
          supabase.from('sales').select().eq('invoice_number', invoice_number).eq('client_id', client_id)
            .gte('created_at', createdAtIso).abortSignal(dbTimeout()).maybeSingle());
        if (!existing) return res.status(500).json({ error: `försäljning: ${error.message}` });
        console.warn(`[Sale] ${invoice_number}: insert-svar förlorat men raden fanns — fortsätter`);
        sale = existing;
      }
      step('sale');

      // Look up product images server-side. Legacy inventory/lens rows store
      // base64 images — shipping those through the sale request (and back in
      // the response) made createSale hang for minutes on mobile connections.
      // A glasses line can carry several physical pairs. Lagret har en rad per
      // par, så tre sålda par måste peka ut tre rader — annars ligger de kvar.
      const lineIds = i => (Array.isArray(i.inventory_ids) && i.inventory_ids.length
        ? i.inventory_ids.filter(Boolean)
        : i.inventory_id ? [i.inventory_id] : []);
      const imgInvIds = [...new Set(items.flatMap(lineIds))];
      const imgLensIds = [...new Set(items.filter(i => i.lens_id).map(i => i.lens_id))];
      const imageByInv = {}, buyByInv = {}, imageByLens = {};
      if (imgInvIds.length) {
        const { data } = await retryRead('bilduppslag lager', () =>
          supabase.from('inventory').select('id, image, buy_price').in('id', imgInvIds).abortSignal(dbTimeout()));
        (data || []).forEach(r => { imageByInv[r.id] = r.image; buyByInv[r.id] = r.buy_price; });
      }
      if (imgLensIds.length) {
        const { data } = await retryRead('bilduppslag linser', () =>
          supabase.from('lenses').select('id, image').in('id', imgLensIds).abortSignal(dbTimeout()));
        (data || []).forEach(r => { imageByLens[r.id] = r.image; });
      }
      step('bilder');

      // Varje par har sitt eget inköpspris. Raden delas därför per inköpspris:
      // är de lika blir det en rad med antal 3 (kort faktura), skiljer de sig
      // blir det en rad per pris (rätt vinst i bokföring och avräkning).
      const expanded = [];
      for (const i of items) {
        const ids = Array.isArray(i.inventory_ids) ? i.inventory_ids.filter(Boolean) : [];
        if (!ids.length) { expanded.push(i); continue; }
        const byPrice = new Map();
        for (const id of ids) {
          const buy = buyByInv[id] ?? i.buy_price ?? null;
          const key = buy == null ? 'null' : String(buy);
          if (!byPrice.has(key)) byPrice.set(key, { buy, ids: [] });
          byPrice.get(key).ids.push(id);
        }
        for (const g of byPrice.values()) {
          expanded.push({ ...i, inventory_id: g.ids[0], buy_price: g.buy, qty: g.ids.length });
        }
      }

      const rows = expanded.map(i => ({
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
      if (itemErr) {
        // Same ambiguity as above: the rows may have landed despite the error.
        // A single insert statement is atomic — either all rows exist or none.
        const { data: existingRows } = await retryRead('radverifiering', () =>
          supabase.from('sale_items').select('id').eq('sale_id', sale.id).abortSignal(dbTimeout()));
        if ((existingRows || []).length < rows.length) {
          // Genuine failure — remove the empty sale so Historik stays clean
          const { error: cleanupErr } = await supabase.from('sales').delete().eq('id', sale.id).abortSignal(dbTimeout());
          if (cleanupErr) console.error(`[Sale] ${invoice_number}: kunde inte städa bort tomt sälj: ${cleanupErr.message}`);
          return res.status(500).json({ error: `varurader: ${itemErr.message}` });
        }
        console.warn(`[Sale] ${invoice_number}: varurads-svar förlorat men raderna fanns — fortsätter`);
      }
      step('rader');

      // From here on the sale and its rows are safely stored — everything
      // below is housekeeping (inventory cleanup, socket broadcast, lens
      // stock) and must NEVER fail the request. Failures are logged loudly.
      try {
        // Remove sold glasses from inventory (shared across all admins)
        const inventoryIds = [...new Set(items.flatMap(lineIds))];
        // En äldre klient (cachad JS) skickar bara ett id med antal 3. Då pekas
        // resten ut här på ref-koden, annars blir kvarvarande par kvar i lagret
        // som spöken. Görs bara i städningen, som aldrig får fälla ett sälj.
        for (const i of items) {
          const qty = i.qty || 1;
          const already = lineIds(i).length;
          if (already >= qty || !i.inventory_id || !i.ref_code) continue;
          const { data: extra } = await retryRead('extra lagerrader', () =>
            supabase.from('inventory').select('id').eq('ref_code', i.ref_code)
              .not('id', 'in', `(${inventoryIds.join(',')})`)
              .limit(qty - already).abortSignal(dbTimeout()));
          for (const row of extra || []) if (!inventoryIds.includes(row.id)) inventoryIds.push(row.id);
          if (extra?.length) console.warn(`[Sale] ${invoice_number}: äldre klient sålde ${qty} av ${i.ref_code} — plockade ${extra.length} extra lagerrader`);
        }
        if (inventoryIds.length) {
          const { error: delErr } = await supabase.from('inventory').delete().in('id', inventoryIds).abortSignal(dbTimeout());
          if (delErr) console.error(`[Sale] ${invoice_number}: lagerborttagning misslyckades: ${delErr.message}`);
          try { io.emit('inventory:sold', { ids: inventoryIds }); }
          catch (emitErr) { console.error(`[Sale] ${invoice_number}: socket-utskick misslyckades:`, emitErr.stack || emitErr.message); }
        }
        step('lager');

        // Decrement lens variant stock (shared across all admins)
        const lensItems = items.filter(i => i.lens_variant_id);
        for (const item of lensItems) {
          const { data: variant } = await retryRead('linslager', () =>
            supabase.from('lens_variants').select('stock_count').eq('id', item.lens_variant_id).abortSignal(dbTimeout()).single());
          if (variant) {
            await supabase.from('lens_variants').update({
              stock_count: Math.max(0, (variant.stock_count || 0) - (item.qty || 1))
            }).eq('id', item.lens_variant_id).abortSignal(dbTimeout());
          }
        }
        step('linser');
      } catch (tailErr) {
        console.error(`[Sale] ${invoice_number}: efterarbete misslyckades (säljet är sparat, svarar OK):`, tailErr.stack || tailErr.message);
      }

      console.log(`[Sale] ${invoice_number} skapad på ${Date.now() - t0}ms (${steps.join(', ')})`);
      // Slim response — createSale only checks r.ok, and re-fetching the sale
      // with its items would ship any legacy base64 images back over the wire
      res.json({ sale });
      // Notify the client that a purchase was registered (fire-and-forget —
      // must never affect the sale itself)
      webPushClient(client_id, 'Vision Palace', 'Ett nytt köp har registrerats på ditt konto', { url: '/client', tab: 'purchases' }).catch(() => {});
    } catch (e) {
      console.error(`[Sale] POST /sales avbröts efter ${Date.now() - t0}ms (${steps.join(', ')}):`, e.stack || e.message);
      const done = steps.length ? steps.map(s => s.split(' ')[0]).join(', ') : 'inga';
      if (!res.headersSent) res.status(500).json({ error: `Serverfel vid skapande av försäljning (klarade steg: ${done})` });
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
    // For bookkeeping the date the money arrived is what counts, not the order
    // date. Only stamped the first time so a later status change can't move it.
    if (['paid', 'shipped', 'delivered'].includes(status)) {
      const { data: existing } = await supabase.from('sales')
        .select('paid_at').eq('id', req.params.id).maybeSingle();
      if (existing && !existing.paid_at) updates.paid_at = new Date().toISOString();
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

  // ── Betalningar (kvitton på banköverföringar) ───────────────────────────────
  // One row per payment so part payments work; amount may be null when the
  // point is just to attach the receipt.

  // Ownership check — a payment may only be touched on the caller's own sale
  async function ownsSale(saleId, adminId) {
    const { data } = await supabase.from('sales')
      .select('id').eq('id', saleId).eq('admin_id', adminId).abortSignal(dbTimeout()).maybeSingle();
    return !!data;
  }

  router.get('/sales/:id/payments', adminAuth, async (req, res) => {
    if (!await ownsSale(req.params.id, req.adminId)) return res.status(404).json({ error: 'Hittades inte' });
    const { data, error } = await supabase.from('sale_payments')
      .select('*').eq('sale_id', req.params.id).order('paid_at', { ascending: false })
      .abortSignal(dbTimeout());
    if (error) return res.status(500).json({ error: error.message });
    res.json({ payments: data || [] });
  });

  router.post('/sales/:id/payments', adminAuth, async (req, res) => {
    try {
      if (!await ownsSale(req.params.id, req.adminId)) return res.status(404).json({ error: 'Hittades inte' });
      const { amount, paid_at, image_url, note } = req.body;
      const amt = amount === '' || amount == null ? null : parseFloat(amount);
      if (amt != null && (!Number.isFinite(amt) || amt < 0)) {
        return res.status(400).json({ error: 'Ogiltigt belopp' });
      }
      const when = paid_at && /^\d{4}-\d{2}-\d{2}$/.test(paid_at)
        ? new Date(`${paid_at}T12:00:00`).toISOString()
        : new Date().toISOString();
      const { data, error } = await supabase.from('sale_payments').insert({
        sale_id: req.params.id,
        amount: amt,
        paid_at: when,
        image_url: image_url || null,
        note: (note || '').trim() || null,
        created_by: req.adminId,
      }).select().abortSignal(dbTimeout()).single();
      if (error) return res.status(500).json({ error: error.message });
      res.json({ payment: data });
    } catch (e) {
      console.error('[Payments] POST:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Serverfel vid registrering av betalning' });
    }
  });

  router.delete('/sales/:saleId/payments/:id', adminAuth, async (req, res) => {
    if (!await ownsSale(req.params.saleId, req.adminId)) return res.status(404).json({ error: 'Hittades inte' });
    const { error } = await supabase.from('sale_payments').delete()
      .eq('id', req.params.id).eq('sale_id', req.params.saleId).abortSignal(dbTimeout());
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
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
