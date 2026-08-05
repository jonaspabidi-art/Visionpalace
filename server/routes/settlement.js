const { adminAuth } = require('../lib/auth');
const supabase = require('../lib/supabase');

// A sale only counts towards the commission once the money is actually in.
// 'cancelled' never counts; 'unpaid' is reported separately as pending.
const PAID_STATUSES = ['paid', 'shipped', 'delivered'];
const DEFAULT_COMMISSION_PCT = 70;
// Sales are priced in EUR; the settlement between the partners is paid in SEK,
// so everything in the ledger (payouts, opening balance, balance) is in kronor.
const DEFAULT_EUR_SEK_RATE = 11;

module.exports = () => {
  const router = require('express').Router();
  const dbTimeout = () => AbortSignal.timeout(10000);

  async function loadConfig() {
    const { data, error } = await supabase.from('app_settings')
      .select('value').eq('key', 'settlement_config').abortSignal(dbTimeout()).maybeSingle();
    if (error || !data?.value) return null;
    try {
      const cfg = JSON.parse(data.value);
      if (!cfg.seller_admin_id || !cfg.payer_admin_id) return null;
      // Same account on both sides means the two usernames in the SQL step
      // resolved to one admin — surface it instead of showing nonsense figures
      if (cfg.seller_admin_id === cfg.payer_admin_id) return { invalid: 'same_account' };
      return cfg;
    } catch { return null; }
  }

  // Only the two configured parties may see or touch the settlement — this is
  // money between them. Responds and returns null when the caller isn't one.
  async function requireParty(req, res) {
    const cfg = await loadConfig();
    if (!cfg) {
      // Not set up yet — flagged so the UI can stay completely silent instead
      // of showing an error to admins before the SQL step has been run
      res.status(503).json({ not_configured: true, error: 'Avräkningen är inte uppsatt än. Kör SQL-steget i Supabase först.' });
      return null;
    }
    if (cfg.invalid === 'same_account') {
      res.status(500).json({ error: 'Avräkningen är felkonfigurerad: säljare och betalare pekar på samma konto. Rätta användarnamnen i SQL-steget.' });
      return null;
    }
    const role = req.adminId === cfg.seller_admin_id ? 'seller'
      : req.adminId === cfg.payer_admin_id ? 'payer' : null;
    if (!role) { res.status(403).json({ error: 'Ingen avräkning kopplad till detta konto' }); return null; }
    return { cfg, role };
  }

  // Margin on one sale. Rows without a buy price (shipping, ad-hoc lines) are
  // skipped — they are pass-through, not profit, so they aren't shared.
  function saleProfit(sale) {
    return (sale.sale_items || []).reduce((sum, i) => {
      if (i.buy_price == null) return sum;
      const qty = i.qty || 1;
      return sum + ((parseFloat(i.sell_price) || 0) - (parseFloat(i.buy_price) || 0)) * qty;
    }, 0);
  }

  // The balance is derived, never stored: a corrected price or a deleted sale
  // flows straight through instead of leaving a stale ledger row behind.
  router.get('/settlement', adminAuth, async (req, res) => {
    try {
      const party = await requireParty(req, res);
      if (!party) return;
      const { cfg, role } = party;
      const defaultPct = cfg.commission_pct ?? DEFAULT_COMMISSION_PCT;
      const rate = cfg.eur_sek_rate ?? DEFAULT_EUR_SEK_RATE;

      // Kursen läses per försäljning. Euron rör sig under året, så ett sälj
      // från mars ska växlas till mars kurs — inte till den som råkar gälla
      // den dag saldot visas. Saknas den (sälj äldre än migration 010)
      // används konfigurationens kurs, precis som förut.
      const rateFallbackQuery = cols => supabase.from('sales').select(cols)
        .eq('admin_id', cfg.seller_admin_id).abortSignal(dbTimeout());
      let { data: sales, error: salesErr } =
        await rateFallbackQuery('id, created_at, status, commission_pct, eur_sek_rate, sale_items(sell_price, buy_price, qty)');
      if (salesErr) {
        console.warn(`[Settlement] Kunde inte läsa eur_sek_rate (${salesErr.message}) — läser utan`);
        ({ data: sales, error: salesErr } =
          await rateFallbackQuery('id, created_at, status, commission_pct, sale_items(sell_price, buy_price, qty)'));
      }
      if (salesErr) return res.status(500).json({ error: `Kunde inte läsa försäljningar: ${salesErr.message}` });

      // Andelen räknas i euro per sälj och växlas direkt med säljets egen kurs
      let earnedEur = 0, pendingEur = 0, earned = 0, pending = 0;
      let missingBuyPrice = 0, mixedRates = new Set();
      const months = {};
      for (const s of sales || []) {
        const status = s.status || 'unpaid';
        if (status === 'cancelled') continue;
        const pct = s.commission_pct != null ? parseFloat(s.commission_pct) : defaultPct;
        const saleRate = s.eur_sek_rate != null && parseFloat(s.eur_sek_rate) > 0
          ? parseFloat(s.eur_sek_rate) : rate;
        mixedRates.add(saleRate);
        const shareEur = saleProfit(s) * pct / 100;
        const shareSek = shareEur * saleRate;
        // Warn about sales where no row carries a buy price — those silently
        // yield zero commission, which would quietly cost the sellers money
        const items = s.sale_items || [];
        if (items.length && !items.some(i => i.buy_price != null)) missingBuyPrice++;
        if (PAID_STATUSES.includes(status)) {
          earnedEur += shareEur;
          earned += shareSek;
          const key = (s.created_at || '').substring(0, 7);
          months[key] = (months[key] || 0) + shareSek;
        } else {
          pendingEur += shareEur;
          pending += shareSek;
        }
      }

      const { data: entries, error: entErr } = await supabase.from('settlements')
        .select('*').eq('seller_admin_id', cfg.seller_admin_id)
        .order('occurred_at', { ascending: false })
        .abortSignal(dbTimeout());
      if (entErr) return res.status(503).json({ error: `Kunde inte läsa utbetalningar: ${entErr.message}` });

      const sumOf = type => (entries || [])
        .filter(e => e.type === type)
        .reduce((a, e) => a + (parseFloat(e.amount) || 0), 0);
      // Ledger entries are already in SEK; earnings are converted per sale above
      const opening = sumOf('opening');
      const paidOut = sumOf('payout');

      res.json({
        role,
        commission_pct: defaultPct,
        eur_sek_rate: rate,             // kursen som gäller för NYA sälj
        rates_used: [...mixedRates].sort((a, b) => a - b),
        earned,
        earned_eur: earnedEur,
        pending,
        pending_eur: pendingEur,
        opening,
        paid_out: paidOut,
        balance: opening + earned - paidOut,
        missing_buy_price: missingBuyPrice,
        months,
        entries: entries || [],
      });
    } catch (e) {
      console.error('[Settlement] GET /settlement:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Serverfel vid hämtning av avräkning' });
    }
  });

  // Ändra kursen som gäller framåt. Historiken rörs inte — varje sälj bär sin
  // egen kurs sedan migration 010, vilket är hela poängen med den här knappen.
  router.patch('/settlement/rate', adminAuth, async (req, res) => {
    try {
      const party = await requireParty(req, res);
      if (!party) return;
      const value = parseFloat(req.body.eur_sek_rate);
      if (!Number.isFinite(value) || value <= 0 || value > 100) {
        return res.status(400).json({ error: 'Ange en kurs mellan 0 och 100 kr per euro' });
      }
      const next = { ...party.cfg, eur_sek_rate: value };
      const { error } = await supabase.from('app_settings')
        .update({ value: JSON.stringify(next), updated_at: new Date().toISOString() })
        .eq('key', 'settlement_config').abortSignal(dbTimeout());
      if (error) return res.status(500).json({ error: error.message });

      // Utan frysningen skulle historiken räknas om här — säg till om den saknas
      const { count } = await supabase.from('sales')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', party.cfg.seller_admin_id).is('eur_sek_rate', null)
        .abortSignal(dbTimeout());
      console.log(`[Settlement] Kursen satt till ${value} kr/€ av admin ${req.adminId}`);
      res.json({ eur_sek_rate: value, unfrozen_sales: count || 0 });
    } catch (e) {
      console.error('[Settlement] PATCH /settlement/rate:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Serverfel vid kursändring' });
    }
  });

  // Register a payout (or an opening balance). Both parties may register —
  // agreed with the owner: the same figures are visible to both accounts.
  router.post('/settlement/entry', adminAuth, async (req, res) => {
    try {
      const party = await requireParty(req, res);
      if (!party) return;
      const { type, amount, occurred_at, note } = req.body;
      const entryType = type === 'opening' ? 'opening' : 'payout';
      const amt = parseFloat(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: 'Ange ett belopp större än noll' });
      }
      const when = occurred_at && /^\d{4}-\d{2}-\d{2}$/.test(occurred_at)
        ? new Date(`${occurred_at}T12:00:00`).toISOString()
        : new Date().toISOString();

      const { data, error } = await supabase.from('settlements').insert({
        seller_admin_id: party.cfg.seller_admin_id,
        type: entryType,
        amount: amt,
        occurred_at: when,
        note: (note || '').trim() || null,
        created_by: req.adminId,
      }).select().abortSignal(dbTimeout()).single();
      if (error) return res.status(500).json({ error: error.message });

      console.log(`[Settlement] ${entryType} ${amt} kr registrerad av admin ${req.adminId}`);
      res.json({ entry: data });
    } catch (e) {
      console.error('[Settlement] POST /settlement/entry:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Serverfel vid registrering' });
    }
  });

  router.delete('/settlement/entry/:id', adminAuth, async (req, res) => {
    try {
      const party = await requireParty(req, res);
      if (!party) return;
      const { error } = await supabase.from('settlements').delete()
        .eq('id', req.params.id)
        .eq('seller_admin_id', party.cfg.seller_admin_id)
        .abortSignal(dbTimeout());
      if (error) return res.status(500).json({ error: error.message });
      res.json({ ok: true });
    } catch (e) {
      console.error('[Settlement] DELETE entry:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Serverfel vid borttagning' });
    }
  });

  return router;
};
