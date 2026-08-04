const { adminAuth } = require('../lib/auth');
const supabase = require('../lib/supabase');

// Swedish Excel expects semicolons and decimal commas; the BOM is what stops it
// from mangling åäö. Without both, the file opens as one column of mojibake.
const SEP = ';';
const BOM = '\uFEFF';

function cell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function num(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '';
}
function row(...values) { return values.map(cell).join(SEP); }
function date(iso) { return iso ? String(iso).substring(0, 10) : ''; }

const STATUS_SV = {
  unpaid: 'Obetald', paid: 'Betald', shipped: 'Skickad',
  delivered: 'Levererad', cancelled: 'Avbruten',
};

module.exports = () => {
  const router = require('express').Router();

  router.get('/export/bookkeeping', adminAuth, async (req, res) => {
    try {
      const month = String(req.query.month || '');
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Ange månad som YYYY-MM' });
      const [y, m] = month.split('-').map(Number);
      const from = new Date(Date.UTC(y, m - 1, 1)).toISOString();
      const to = new Date(Date.UTC(y, m, 1)).toISOString();

      const lines = [];
      const push = (...v) => lines.push(row(...v));

      // Vilket konto filen kommer från — annars går två månadsfiler inte att
      // skilja åt när de ligger bredvid varandra hos redovisningen
      const { data: me } = await supabase.from('admins')
        .select('display_name, username').eq('id', req.adminId).maybeSingle();
      const adminName = me?.display_name || me?.username || '';

      // ── Försäljningar ────────────────────────────────────────────────────
      const { data: sales, error: salesErr } = await supabase.from('sales')
        .select('*, sale_items(*), clients(display_name, admin_label)')
        .eq('admin_id', req.adminId)
        .gte('created_at', from).lt('created_at', to)
        .order('created_at', { ascending: true });
      if (salesErr) return res.status(500).json({ error: salesErr.message });

      push('FÖRSÄLJNINGAR — endast detta admin-kontos försäljningar');
      push('Datum', 'Betaldatum', 'Fakturanr', 'Kund', 'Status', 'Vara', 'Ref',
        'Antal', 'Á-pris (EUR)', 'Belopp (EUR)', 'Inköpspris (EUR)', 'Vinst (EUR)');
      let revTotal = 0, profitTotal = 0;
      for (const s of sales || []) {
        const client = s.clients?.admin_label || s.clients?.display_name || '';
        for (const it of s.sale_items || []) {
          const qty = it.qty || 1;
          const sell = parseFloat(it.sell_price) || 0;
          const amount = sell * qty;
          const hasBuy = it.buy_price != null;
          const buy = hasBuy ? (parseFloat(it.buy_price) || 0) : null;
          const profit = hasBuy ? (sell - buy) * qty : null;
          revTotal += amount;
          if (profit != null) profitTotal += profit;
          push(date(s.created_at), date(s.paid_at), s.invoice_number || '', client,
            STATUS_SV[s.status || 'unpaid'] || s.status || '', it.name || '', it.ref_code || '',
            qty, num(sell), num(amount), hasBuy ? num(buy) : '', profit == null ? '' : num(profit));
        }
      }
      push('Summa', '', '', '', '', '', '', '', '', num(revTotal), '', num(profitTotal));
      lines.push('');

      // ── Inköp ────────────────────────────────────────────────────────────
      // Inköpen görs gemensamt för bolaget och filtreras därför inte per konto.
      // De står alltså likadant i båda admin-kontonas filer — därav kolumnen
      // "Inlagt av" och varningen i rubriken, så inget bokförs två gånger.
      // "Inlagt av" hämtas genom en koppling till admins. Skulle den kopplingen
      // inte gå att läsa är inköpen ändå det viktiga — då hämtas de utan namn
      // i stället för att sektionen faller bort.
      const purchaseQuery = cols => supabase.from('purchases').select(cols)
        .gte('purchased_at', from).lt('purchased_at', to)
        .order('purchased_at', { ascending: true });
      let { data: purchases, error: pErr } = await purchaseQuery('*, admins(display_name, username)');
      if (pErr) {
        console.warn(`[Export] Inköp med "inlagt av" misslyckades (${pErr.message}) — hämtar utan`);
        ({ data: purchases, error: pErr } = await purchaseQuery('*'));
      }

      push('INKÖP — gemensamma för bolaget, bokförs endast en gång');
      if (pErr) {
        push(`Kunde inte läsas: ${pErr.message}`);
      } else {
        push('Datum', 'Vara', 'Ref', 'Antal', 'Inköpspris (EUR)', 'Summa (EUR)', 'Källa', 'Inlagt av', 'Dokument');
        let buyTotal = 0;
        for (const p of purchases || []) {
          const qty = p.qty || 1;
          const unit = parseFloat(p.buy_price) || 0;
          buyTotal += unit * qty;
          push(date(p.purchased_at), p.name || '', p.ref_code || '', qty, num(unit), num(unit * qty),
            p.source === 'order_import' ? 'Fakturaimport' : 'Manuell',
            p.admins?.display_name || p.admins?.username || '', p.document_url || '');
        }
        push('Summa', '', '', '', '', num(buyTotal));
      }
      lines.push('');

      // ── Betalningar (kvitton) ────────────────────────────────────────────
      const saleIds = (sales || []).map(s => s.id);
      push('BETALNINGAR');
      if (saleIds.length) {
        const { data: payments, error: payErr } = await supabase.from('sale_payments')
          .select('*').in('sale_id', saleIds).order('paid_at', { ascending: true });
        if (payErr) {
          push(`Kunde inte läsas: ${payErr.message}`);
        } else {
          push('Datum', 'Fakturanr', 'Kund', 'Belopp (EUR)', 'Kommentar', 'Kvitto');
          const byId = Object.fromEntries((sales || []).map(s => [s.id, s]));
          for (const pay of payments || []) {
            const s = byId[pay.sale_id] || {};
            push(date(pay.paid_at), s.invoice_number || '',
              s.clients?.admin_label || s.clients?.display_name || '',
              pay.amount == null ? '' : num(pay.amount), pay.note || '', pay.image_url || '');
          }
        }
      } else {
        push('Inga försäljningar denna månad');
      }
      lines.push('');

      // Avräkningen mellan säljarna och bolaget hör inte hemma här — ägaren
      // bokför utbetalningarna separat. Saldot finns kvar i appen som förut.

      const header = [
        row('Vision Palace — bokföringsunderlag'),
        row('Månad', month),
        row('Genererad', new Date().toISOString().substring(0, 10)),
        row('Konto', adminName),
        row('Valuta', 'EUR där inget annat anges. Ingen moms (export utanför EU).'),
        row('Obs', 'Försäljningar och betalningar gäller endast detta konto. Inköpen är bolagets gemensamma och står likadant i det andra kontots fil — bokför dem endast en gång.'),
        '',
      ].join('\r\n');

      const csv = BOM + header + lines.join('\r\n') + '\r\n';
      console.log(`[Export] ${month}: ${(sales || []).length} sälj, ${(purchases || []).length} inköp`);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="bokforing-${month}.csv"`);
      res.send(csv);
    } catch (e) {
      console.error('[Export] Misslyckades:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Kunde inte skapa exporten' });
    }
  });

  return router;
};
