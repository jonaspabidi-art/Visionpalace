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
      // Samma underlag oavsett format. CSV går till redovisningsprogrammet,
      // PDF byggs i appen ur JSON och är den man mailar eller skriver ut.
      const asJson = String(req.query.format || '').toLowerCase() === 'json';
      const report = { month, admin: '', sales: [], purchases: [], payments: [], inventory: [],
        stock_as_of: new Date().toISOString().substring(0, 10),
        totals: { revenue: 0, profit: 0, purchases: 0, stock_count: 0, stock_value: 0, stock_retail: 0 } };

      const lines = [];
      const push = (...v) => lines.push(row(...v));

      // Vilket konto filen kommer från — annars går två månadsfiler inte att
      // skilja åt när de ligger bredvid varandra hos redovisningen
      const { data: me } = await supabase.from('admins')
        .select('display_name, username').eq('id', req.adminId).maybeSingle();
      const adminName = me?.display_name || me?.username || '';
      report.admin = adminName;

      // ── Försäljningar ────────────────────────────────────────────────────
      // Båda admin-kontonas försäljningar i samma fil (ägarens besked
      // 2026-08-04) — bokföringen görs på ett bolag, så en fil ska räcka.
      // Kolumnen "Sålt av" håller ändå isär vem som sålt vad.
      const salesQuery = cols => supabase.from('sales').select(cols)
        .gte('created_at', from).lt('created_at', to)
        .order('created_at', { ascending: true });
      let { data: sales, error: salesErr } =
        await salesQuery('*, sale_items(*), clients(display_name, admin_label), admins(display_name, username)');
      if (salesErr) {
        console.warn(`[Export] Försäljningar med "sålt av" misslyckades (${salesErr.message}) — hämtar utan`);
        ({ data: sales, error: salesErr } =
          await salesQuery('*, sale_items(*), clients(display_name, admin_label)'));
      }
      if (salesErr) return res.status(500).json({ error: salesErr.message });

      push('FÖRSÄLJNINGAR — båda admin-kontonas försäljningar');
      push('Datum', 'Betaldatum', 'Fakturanr', 'Kund', 'Sålt av', 'Status', 'Vara', 'Ref',
        'Antal', 'Á-pris (EUR)', 'Belopp (EUR)', 'Inköpspris (EUR)', 'Vinst (EUR)');
      const soldBy = s => s.admins?.display_name || s.admins?.username || '';
      let revTotal = 0, profitTotal = 0;
      for (const s of sales || []) {
        const client = s.clients?.admin_label || s.clients?.display_name || s.customer_name || '';
        for (const it of s.sale_items || []) {
          const qty = it.qty || 1;
          const sell = parseFloat(it.sell_price) || 0;
          const amount = sell * qty;
          const hasBuy = it.buy_price != null;
          const buy = hasBuy ? (parseFloat(it.buy_price) || 0) : null;
          const profit = hasBuy ? (sell - buy) * qty : null;
          revTotal += amount;
          if (profit != null) profitTotal += profit;
          push(date(s.created_at), date(s.paid_at), s.invoice_number || '', client, soldBy(s),
            STATUS_SV[s.status || 'unpaid'] || s.status || '', it.name || '', it.ref_code || '',
            qty, num(sell), num(amount), hasBuy ? num(buy) : '', profit == null ? '' : num(profit));
          report.sales.push({
            // Raderna grupperas per köp i PDF:en. Fakturanumret duger inte som
            // nyckel — kontantköp utan faktura skulle då slås ihop.
            sale_id: s.id,
            date: date(s.created_at), paid_at: date(s.paid_at), invoice: s.invoice_number || '',
            client, sold_by: soldBy(s), status: STATUS_SV[s.status || 'unpaid'] || s.status || '',
            name: it.name || '', ref: it.ref_code || '', qty,
            sell, amount, buy, profit, preorder: !!s.is_preorder,
          });
        }
      }
      report.totals.revenue = revTotal;
      report.totals.profit = profitTotal;
      push('Summa', '', '', '', '', '', '', '', '', '', num(revTotal), '', num(profitTotal));
      lines.push('');

      // ── Inköp ────────────────────────────────────────────────────────────
      // Inköpen görs gemensamt för bolaget. "Inlagt av" hämtas genom en koppling
      // till admins; skulle den kopplingen inte gå att läsa är inköpen ändå det
      // viktiga — då hämtas de utan namn i stället för att sektionen faller bort.
      const purchaseQuery = cols => supabase.from('purchases').select(cols)
        .gte('purchased_at', from).lt('purchased_at', to)
        .order('purchased_at', { ascending: true });
      let { data: purchases, error: pErr } = await purchaseQuery('*, admins(display_name, username)');
      if (pErr) {
        console.warn(`[Export] Inköp med "inlagt av" misslyckades (${pErr.message}) — hämtar utan`);
        ({ data: purchases, error: pErr } = await purchaseQuery('*'));
      }

      push('INKÖP — gemensamma för bolaget');
      if (pErr) {
        push(`Kunde inte läsas: ${pErr.message}`);
      } else {
        push('Datum', 'Vara', 'Ref', 'Antal', 'Inköpspris (EUR)', 'Summa (EUR)', 'Källa', 'Inlagt av', 'Dokument');
        let buyTotal = 0;
        for (const p of purchases || []) {
          const qty = p.qty || 1;
          const unit = parseFloat(p.buy_price) || 0;
          buyTotal += unit * qty;
          const source = p.source === 'order_import' ? 'Fakturaimport'
            : p.source === 'preorder' ? 'Förbeställning' : 'Manuell';
          push(date(p.purchased_at), p.name || '', p.ref_code || '', qty, num(unit), num(unit * qty),
            source, p.admins?.display_name || p.admins?.username || '', p.document_url || '');
          report.purchases.push({
            date: date(p.purchased_at), name: p.name || '', ref: p.ref_code || '',
            qty, unit, amount: unit * qty, source,
            added_by: p.admins?.display_name || p.admins?.username || '',
            document: p.document_url || '',
          });
        }
        report.totals.purchases = buyTotal;
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
          push('Datum', 'Fakturanr', 'Kund', 'Sålt av', 'Belopp (EUR)', 'Kommentar', 'Kvitto');
          const byId = Object.fromEntries((sales || []).map(s => [s.id, s]));
          for (const pay of payments || []) {
            const s = byId[pay.sale_id] || {};
            const payer = s.clients?.admin_label || s.clients?.display_name || s.customer_name || '';
            push(date(pay.paid_at), s.invoice_number || '', payer, soldBy(s),
              pay.amount == null ? '' : num(pay.amount), pay.note || '', pay.image_url || '');
            report.payments.push({
              date: date(pay.paid_at), invoice: s.invoice_number || '', client: payer,
              sold_by: soldBy(s), amount: pay.amount == null ? null : Number(pay.amount),
              note: pay.note || '', receipt: pay.image_url || '',
            });
          }
        }
      } else {
        push('Inga försäljningar denna månad');
      }
      lines.push('');

      // ── Lagerstatus ──────────────────────────────────────────────────────
      // Vad som står i lagret just nu, inte vid månadens slut. Lagret har en
      // rad per fysiskt par och sparar ingen historik, så en månad bakåt går
      // inte att rekonstruera. Datumet skrivs ut så att det inte kan misstas
      // för en månadssiffra.
      const { data: stock, error: stockErr } = await supabase.from('inventory')
        .select('ref_code, name, buy_price, sell_price');
      push('LAGERSTATUS');
      if (stockErr) {
        console.warn(`[Export] Lagret kunde inte läsas: ${stockErr.message}`);
        push(`Kunde inte läsas: ${stockErr.message}`);
      } else {
        push('Läget per', report.stock_as_of);
        push('Ref', 'Modell', 'Antal', 'Inköpspris (EUR)', 'Lagervärde (EUR)', 'Utpris (EUR)');
        // Ett kort per modell — lagret har en rad per par, och en lista med
        // samma modell 12 gånger går inte att stämma av mot en inventering
        const groups = new Map();
        for (const it of stock || []) {
          const buy = it.buy_price == null ? null : parseFloat(it.buy_price) || 0;
          const sell = it.sell_price == null ? null : parseFloat(it.sell_price) || 0;
          const key = `${it.ref_code || ''}|${it.name || ''}|${buy ?? ''}|${sell ?? ''}`;
          const g = groups.get(key) || { ref: it.ref_code || '', name: it.name || '', buy, sell, qty: 0 };
          g.qty++;
          groups.set(key, g);
        }
        const rows = [...groups.values()].sort((a, b) =>
          (a.name || '').localeCompare(b.name || '', 'sv') || (a.ref || '').localeCompare(b.ref || ''));
        for (const g of rows) {
          const value = g.buy == null ? null : g.buy * g.qty;
          report.totals.stock_count += g.qty;
          if (value != null) report.totals.stock_value += value;
          if (g.sell != null) report.totals.stock_retail += g.sell * g.qty;
          push(g.ref, g.name, g.qty, g.buy == null ? '' : num(g.buy),
            value == null ? '' : num(value), g.sell == null ? '' : num(g.sell));
          report.inventory.push({ ref: g.ref, name: g.name, qty: g.qty,
            buy: g.buy, value, sell: g.sell });
        }
        push('Summa', '', report.totals.stock_count, '', num(report.totals.stock_value));
      }
      lines.push('');

      // Avräkningen mellan säljarna och bolaget hör inte hemma här — ägaren
      // bokför utbetalningarna separat. Saldot finns kvar i appen som förut.

      const header = [
        row('Vision Palace — bokföringsunderlag'),
        row('Månad', month),
        row('Genererad', new Date().toISOString().substring(0, 10)),
        row('Omfattning', 'Hela bolaget — båda admin-kontonas försäljningar och de gemensamma inköpen. En fil räcker, oavsett vilket konto den laddas ner från.'),
        row('Nedladdad av', adminName),
        row('Valuta', 'EUR där inget annat anges. Ingen moms (export utanför EU).'),
        '',
      ].join('\r\n');

      if (asJson) {
        console.log(`[Export] ${month} som JSON: ${report.sales.length} rader`);
        return res.json(report);
      }

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
