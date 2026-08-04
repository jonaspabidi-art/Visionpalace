const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { adminAuth } = require('../lib/auth');
const supabase = require('../lib/supabase');

// Invoices are a page or two — no need for the 100 MB the media route allows
const upload = multer({
  storage: multer.memoryStorage(),
  // Base64 inflates by ~4/3 and the API caps a request at 32 MB
  limits: { fileSize: 10 * 1024 * 1024 },
});
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

// Haiku read the real invoice's prices and quantities correctly but turned the
// letter S in "CT0582S-005" into a 5. A wrong ref doesn't just create a wrong
// product — it poisons the ref lookup for years. Sonnet is markedly better at
// character-level transcription on photos; the difference is ~6 öre an invoice.
const MODEL = 'claude-sonnet-5';
const DEFAULT_EUR_SEK_RATE = 11;

// One row per article line on the invoice. Only what is printed is asked for —
// the arithmetic is done here, not by the model.
const ROW_SCHEMA = {
  type: 'object',
  properties: {
    currency: {
      type: 'string',
      description: 'Valutakod från fakturans summering, t.ex. SEK eller EUR',
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref_code: { type: 'string', description: 'Artikelns referenskod, t.ex. CT0582S-005' },
          lens_size: { type: 'string', description: 'Linsstorleken direkt efter referenskoden, t.ex. 56. Tom sträng om den saknas.' },
          description: { type: 'string', description: 'Produktbeskrivningen utan referenskod och utan linsstorlek, t.ex. Sunglass MAN METAL' },
          qty: { type: 'integer', description: 'Antal enheter på raden' },
          line_total: { type: 'number', description: 'Radens totalbelopp som vanlig decimal' },
        },
        required: ['ref_code', 'lens_size', 'description', 'qty', 'line_total'],
        additionalProperties: false,
      },
    },
  },
  required: ['currency', 'rows'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Du läser inköpsfakturor från glasögonleverantörer (oftast Kering Eyewear) och plockar ut artikelraderna.

Regler:
1. Referenskoden står inbäddad i artikelbeskrivningen, inte i en egen kolumn. Exempel: raden "CT0582S-005 56 Sunglass MAN METAL" har referenskoden "CT0582S-005", linsstorleken "56" och beskrivningen "Sunglass MAN METAL". Ta aldrig koden från ID- eller UPC-kolumnen.
1b. VIKTIGAST AV ALLT: läs referenskoden tecken för tecken. Cartier-koder har formen CT + fyra siffror + EN BOKSTAV + bindestreck + tre siffror, till exempel CT0582S-005 och CT0622S-003. Tecknet precis före bindestrecket är nästan alltid en BOKSTAV, inte en siffra. Förväxla inte S med 5, O med 0, I eller l med 1, B med 8, eller Z med 2. Är du osäker på ett tecken, välj bokstaven som är rimlig för formatet framför siffran. En felläst referenskod är det värsta fel du kan göra här.
2. Tal skrivs i europeiskt format där punkt är tusentalsavgränsare och komma är decimaltecken. "12.072,00" betyder 12072.00 — inte 12,072. Räkna om alla belopp till vanliga decimaltal.
3. line_total är radens belopp i kolumnen "Net Total" (eller motsvarande radtotal), exakt som det står. Räkna inte om per styck.
4. Valutan läser du från fakturans summering ("Invoice Summary", "Total amount" eller liknande). Anta aldrig en valuta — läs den.
5. Ta bara med riktiga artikelrader. Hoppa över frakt, avgifter, summeringar och momsrader.
6. Är fakturan oläslig eller saknar artikelrader, returnera en tom lista.`;

module.exports = () => {
  const router = require('express').Router();

  async function eurSekRate() {
    try {
      const { data } = await supabase.from('app_settings')
        .select('value').eq('key', 'settlement_config').maybeSingle();
      const cfg = data?.value ? JSON.parse(data.value) : null;
      const rate = Number(cfg?.eur_sek_rate);
      return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_EUR_SEK_RATE;
    } catch { return DEFAULT_EUR_SEK_RATE; }
  }

  router.post('/orders/parse', adminAuth, upload.single('file'), async (req, res) => {
    const t0 = Date.now();
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        return res.status(503).json({ error: 'AI-avläsning är inte påslagen. Lägg in ANTHROPIC_API_KEY i Railway.' });
      }
      if (!req.file) return res.status(400).json({ error: 'Ingen fil' });
      if (!ALLOWED.includes(req.file.mimetype)) {
        return res.status(415).json({ error: 'Filtypen stöds inte. Ladda upp JPG, PNG, WEBP eller PDF.' });
      }

      const b64 = req.file.buffer.toString('base64');
      const block = req.file.mimetype === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: b64 } };

      const client = new Anthropic();
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: ROW_SCHEMA } },
        messages: [{ role: 'user', content: [block, { type: 'text', text: 'Läs av artikelraderna på den här fakturan.' }] }],
      });

      if (response.stop_reason === 'refusal') {
        return res.status(422).json({ error: 'Modellen kunde inte behandla dokumentet.' });
      }
      const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
      let parsed;
      try { parsed = JSON.parse(text); }
      catch { return res.status(502).json({ error: 'Kunde inte tolka svaret från avläsningen. Försök igen.' }); }

      const currency = String(parsed.currency || '').toUpperCase();
      const rate = await eurSekRate();

      const rows = (parsed.rows || []).map(r => {
        const qty = Math.max(1, parseInt(r.qty, 10) || 1);
        const lineTotal = Number(r.line_total) || 0;
        const unitOriginal = lineTotal / qty;
        // Only SEK can be converted — the agreed rate is the only one we hold.
        // Anything else is passed through for the admin to price manually.
        const converted = currency === 'SEK' ? unitOriginal / rate
          : currency === 'EUR' ? unitOriginal
            : null;
        const ref = String(r.ref_code || '').trim().toUpperCase();
        // A brand prefix followed only by digits before the dash almost always
        // means a letter was read as a digit (CT0582S-005 → CT05825-005).
        // Flagged rather than corrected — guessing at someone's article number
        // would be worse than pointing at it.
        const suspiciousRef = /^[A-Z]{1,3}\d+-\d+$/.test(ref);
        return {
          ref_code: ref,
          lens_size: String(r.lens_size || '').trim(),
          description: String(r.description || '').trim(),
          suspicious_ref: suspiciousRef,
          qty,
          line_total: lineTotal,
          unit_original: Math.round(unitOriginal * 100) / 100,
          currency_original: currency || null,
          buy_price_eur: converted == null ? null : Math.round(converted * 100) / 100,
          needs_manual_price: converted == null,
        };
      }).filter(r => r.ref_code);

      const u = response.usage || {};
      console.log(`[Order] Läste ${rows.length} rader (${currency || 'okänd valuta'}) på ${Date.now() - t0}ms, ${u.input_tokens || 0} in / ${u.output_tokens || 0} ut tokens`);

      res.json({ currency: currency || null, eur_sek_rate: rate, rows });
    } catch (e) {
      console.error(`[Order] Avläsning misslyckades efter ${Date.now() - t0}ms:`, e.stack || e.message);
      const status = e?.status === 401 ? 503 : 500;
      const msg = e?.status === 401
        ? 'API-nyckeln för AI-avläsningen är ogiltig.'
        : e?.status === 429 ? 'AI-tjänsten är tillfälligt överbelastad. Försök igen om en stund.'
          : 'Kunde inte läsa av dokumentet.';
      if (!res.headersSent) res.status(status).json({ error: msg });
    }
  });

  // Create stock from a confirmed review list. One inventory row per physical
  // pair (qty 3 = 3 rows, they are sold individually) but one purchases row per
  // invoice line, so the log mirrors the invoice.
  router.post('/orders/import', adminAuth, async (req, res) => {
    try {
      const { items, document_url } = req.body;
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Inga rader att importera' });

      const invRows = [], purchaseRows = [];
      const now = new Date().toISOString();
      for (const it of items) {
        const name = String(it.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Alla rader måste ha ett namn' });
        const qty = Math.max(1, parseInt(it.qty, 10) || 1);
        const buy = it.buy_price == null || it.buy_price === '' ? null : Number(it.buy_price);
        const sell = it.sell_price == null || it.sell_price === '' ? null : Number(it.sell_price);
        for (let i = 0; i < qty; i++) {
          invRows.push({
            ref_code: it.ref_code || null, name,
            buy_price: buy, sell_price: sell,
            notes: it.notes || null, image: it.image || null,
            added_at: now,
          });
        }
        purchaseRows.push({
          admin_id: req.adminId, inventory_id: null,
          name, ref_code: it.ref_code || null,
          buy_price: buy, qty,
          source: 'order_import', document_url: document_url || null,
          purchased_at: now,
        });
      }

      const { data: created, error } = await supabase.from('inventory').insert(invRows).select();
      if (error) return res.status(500).json({ error: `Kunde inte skapa lagerrader: ${error.message}` });

      // Bookkeeping must never undo stock that was just created
      const { error: pErr } = await supabase.from('purchases').insert(purchaseRows);
      if (pErr) console.error(`[Order] Lagret skapades men inköpsloggen misslyckades: ${pErr.message}`);

      console.log(`[Order] Importerade ${invRows.length} lagerrader från ${purchaseRows.length} fakturarader`);
      res.json({ created: created?.length || invRows.length, lines: purchaseRows.length, purchase_log: !pErr });
    } catch (e) {
      console.error('[Order] Import misslyckades:', e.stack || e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Kunde inte importera ordern' });
    }
  });

  return router;
};
