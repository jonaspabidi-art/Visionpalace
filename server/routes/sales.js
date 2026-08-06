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
      // Köparen är antingen en klient i appen eller bara ett namn — ibland
      // säljs det till någon som inte är inbjuden. Ett av dem krävs.
      const { client_id, customer_name, items, notes, is_preorder } = req.body;
      const buyerName = String(customer_name || '').trim();
      const preorder = !!is_preorder;
      if (!client_id && !buyerName) {
        return res.status(400).json({ error: 'Välj en klient eller skriv namnet på köparen' });
      }
      if (!items?.length) return res.status(400).json({ error: 'items krävs' });
      const invoice_number = await generateInvoiceNumber();
      step('nr');
      const createdAtIso = new Date().toISOString();
      // customer_name skickas BARA när det behövs. Kolumnen tillkommer i
      // migration 010, och tas den med på varje sälj avvisar databasen även
      // helt vanliga försäljningar tills SQL:en är körd.
      const saleRow = {
        client_id: client_id || null,
        invoice_number, notes: notes || null,
        admin_id: req.adminId,
        created_at: createdAtIso,
      };
      if (!client_id) saleRow.customer_name = buyerName;
      // Förbeställningsfälten skickas bara för förbeställningar, av samma skäl
      // som customer_name: vanliga sälj ska aldrig bero på migration 011.
      if (preorder) {
        const weeks = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n <= 104 ? n : null; };
        const min = weeks(req.body.eta_weeks_min);
        const max = weeks(req.body.eta_weeks_max);
        saleRow.is_preorder = true;
        saleRow.eta_weeks_min = min;
        // Bakvänt spann skulle avvisas av databasen — vänd det i stället
        saleRow.eta_weeks_max = min != null && max != null && max < min ? min : max;
      }
      let { data: sale, error } = await supabase.from('sales').insert(saleRow)
        .select().abortSignal(dbTimeout()).single();
      if (error) {
        // The insert may have reached the database even though the response
        // was lost on a stalled connection — verify before failing
        const { data: existing } = await retryRead('säljverifiering', () => {
          let q = supabase.from('sales').select().eq('invoice_number', invoice_number);
          q = client_id ? q.eq('client_id', client_id) : q.eq('customer_name', buyerName);
          return q.gte('created_at', createdAtIso).abortSignal(dbTimeout()).maybeSingle();
        });
        if (!existing) {
          // Säger databasen att kolumnen inte finns är det SQL-steget som
          // saknas, inte något fel på försäljningen — säg det rakt ut
          if (/is_preorder|eta_weeks/.test(error.message || '')) {
            console.error(`[Sale] Migration 011 saknas: ${error.message}`);
            return res.status(503).json({
              error: 'Förbeställningar kräver att SQL-steget körs i Supabase (011_preorders.sql).',
            });
          }
          if (/customer_name|client_id/.test(error.message || '')) {
            console.error(`[Sale] Migration 010 saknas: ${error.message}`);
            return res.status(503).json({
              error: 'Försäljning till kund utanför appen kräver att SQL-steget körs i Supabase (010_walkin_customers.sql). Välj en klient så länge.',
            });
          }
          return res.status(500).json({ error: `försäljning: ${error.message}` });
        }
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
      // must never affect the sale itself). En köpare utanför appen har ingen
      // enhet att pinga.
      if (client_id) {
        webPushClient(client_id, 'Vision Palace', 'Ett nytt köp har registrerats på ditt konto', { url: '/client', tab: 'purchases' }).catch(() => {});
      }
    } catch (e) {
      console.error(`[Sale] POST /sales avbröts efter ${Date.now() - t0}ms (${steps.join(', ')}):`, e.stack || e.message);
      const done = steps.length ? steps.map(s => s.split(' ')[0]).join(', ') : 'inga';
      if (!res.headersSent) res.status(500).json({ error: `Serverfel vid skapande av försäljning (klarade steg: ${done})` });
    }
  });

  // ── Förbeställningar ──
  // Varan har kommit in från leverantören. Lagret rörs inte — ett förbeställt
  // par går från Cartier rakt till kunden och passerar aldrig lagret i appen.
  router.post('/sales/:id/arrived', adminAuth, async (req, res) => {
    try {
      const { data: sale, error } = await supabase.from('sales')
        .update({ arrived_at: new Date().toISOString() })
        .eq('id', req.params.id).eq('admin_id', req.adminId)
        .select('id, client_id, arrived_at, invoice_number').abortSignal(dbTimeout()).single();
      if (error) {
        if (/arrived_at/.test(error.message || '')) {
          return res.status(503).json({ error: 'Förbeställningar kräver att SQL-steget körs i Supabase (011_preorders.sql).' });
        }
        return res.status(500).json({ error: error.message });
      }
      if (!sale) return res.status(404).json({ error: 'Hittades inte' });
      if (sale.client_id) {
        webPushClient(sale.client_id, 'Din förbeställning har kommit!',
          'Varan är inne hos oss och skickas snart.', { url: '/client', tab: 'purchases' }).catch(() => {});
      }
      console.log(`[Sale] ${sale.invoice_number}: förbeställning inkommen`);
      res.json({ sale });
    } catch (e) {
      console.error('[Sale] POST /sales/:id/arrived:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Serverfel' });
    }
  });

  // Leverantörsfakturan för förbeställningen. Den är bokföringens underlag för
  // inköpet, eftersom paret aldrig går genom lagret och alltså aldrig loggas
  // av fakturaimporten. Inköpsraden skrivs en gång per sälj.
  router.post('/sales/:id/supplier-doc', adminAuth, async (req, res) => {
    try {
      const url = String(req.body.document_url || '').trim();
      if (!url) return res.status(400).json({ error: 'Ingen fil' });
      const { data: sale, error } = await supabase.from('sales')
        .update({ supplier_doc_url: url })
        .eq('id', req.params.id).eq('admin_id', req.adminId)
        .select('*, sale_items(*)').abortSignal(dbTimeout()).single();
      if (error) {
        if (/supplier_doc_url/.test(error.message || '')) {
          return res.status(503).json({ error: 'Förbeställningar kräver att SQL-steget körs i Supabase (011_preorders.sql).' });
        }
        return res.status(500).json({ error: error.message });
      }
      if (!sale) return res.status(404).json({ error: 'Hittades inte' });

      // Bokföringen ska inte kunna dubblera inköpet om fakturan byts ut
      const { data: already } = await supabase.from('purchases')
        .select('id').eq('sale_id', sale.id).abortSignal(dbTimeout());
      if (!already?.length) {
        const rows = (sale.sale_items || [])
          .filter(i => i.buy_price != null)
          .map(i => ({
            admin_id: req.adminId, inventory_id: null, sale_id: sale.id,
            name: i.name, ref_code: i.ref_code || null,
            buy_price: i.buy_price, qty: i.qty || 1,
            source: 'preorder', document_url: url,
            purchased_at: new Date().toISOString(),
          }));
        if (rows.length) {
          const { error: pErr } = await supabase.from('purchases').insert(rows).abortSignal(dbTimeout());
          if (pErr) console.error(`[Sale] Inköpslogg för förbeställning misslyckades: ${pErr.message}`);
        }
      }
      res.json({ sale, logged: !already?.length });
    } catch (e) {
      console.error('[Sale] POST /sales/:id/supplier-doc:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Serverfel' });
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
    // Säljet kan sakna klient (köpare utanför appen) — då finns ingen att nå
    if (sale.client_id) {
      if (status === 'shipped') {
        const trackText = tracking_number ? ` Spårning: ${tracking_number}` : '';
        webPushClient(sale.client_id, 'Ditt paket är på väg!', `Ditt köp har skickats.${trackText}`, { url: '/client', tab: 'purchases' }).catch(() => {});
      }
      io.to(`client:${sale.client_id}`).emit('sale:status_updated', { sale_id: sale.id, status, shipping_carrier: sale.shipping_carrier, tracking_number: sale.tracking_number });
    }
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

  // Kontoutdrag till kunden för deras egen bokföring. OBS: kunderna sitter i
  // UK och Dubai, inte i Sverige — deras Excel vill ha komma som avgränsare
  // och punkt som decimaltecken, tvärtom mot bokföringsexporten.
  router.get('/purchases/me/statement', clientAuth, async (req, res) => {
    try {
      const year = String(req.query.year || '').trim();
      let q = supabase.from('sales').select('*, sale_items(*)')
        .eq('client_id', req.client.id).order('created_at', { ascending: true });
      if (/^\d{4}$/.test(year)) {
        q = q.gte('created_at', `${year}-01-01T00:00:00Z`).lt('created_at', `${Number(year) + 1}-01-01T00:00:00Z`);
      }
      const { data: sales, error } = await q.abortSignal(dbTimeout());
      if (error) return res.status(500).json({ error: error.message });

      const cell = v => {
        if (v == null) return '';
        const s = String(v);
        return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const num = v => (v == null || v === '' ? '' : (Number(v) || 0).toFixed(2));
      const row = (...v) => v.map(cell).join(',');
      const STATUS_EN = { unpaid: 'Unpaid', paid: 'Paid', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };

      const lines = [
        row('Vision Palace — statement of purchases'),
        row('Customer', req.client.full_name || req.client.display_name || ''),
        row('Period', /^\d{4}$/.test(year) ? year : 'All time'),
        row('Generated', new Date().toISOString().substring(0, 10)),
        row('Currency', 'EUR'),
        '',
        row('Date', 'Invoice', 'Status', 'Item', 'Ref', 'Qty', 'Unit price', 'Amount'),
      ];
      let total = 0, outstanding = 0;
      for (const s of sales || []) {
        if (s.status === 'cancelled') continue;
        const date = String(s.created_at || '').substring(0, 10);
        for (const it of s.sale_items || []) {
          const qty = it.qty || 1;
          const amount = (parseFloat(it.sell_price) || 0) * qty;
          total += amount;
          if ((s.status || 'unpaid') === 'unpaid') outstanding += amount;
          lines.push(row(date, s.invoice_number || '', STATUS_EN[s.status || 'unpaid'] || '',
            it.name || '', it.ref_code || '', qty, num(it.sell_price), num(amount)));
        }
      }
      lines.push(row('Total', '', '', '', '', '', '', num(total)));
      lines.push(row('Outstanding', '', '', '', '', '', '', num(outstanding)));

      const name = `vision-palace-statement-${/^\d{4}$/.test(year) ? year : 'all'}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      // Explicit \uFEFF, inte ett osynligt tecken i koden
      res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
    } catch (e) {
      console.error('[Statement] Misslyckades:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Could not build the statement' });
    }
  });

  return router;
};
