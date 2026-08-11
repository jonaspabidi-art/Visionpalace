const supabase = require('./supabase');

// ── Valutakurser för bokföringen ──
// Appen räknar i euro, redovisningen görs i kronor. Underlaget behöver därför
// Riksbankens dagskurs för den dag transaktionen skedde.
//
// Det här är INTE samma kurs som avräkningen mellan delägarna använder. Den
// är en fast, egen uppgörelse om vinstdelningen och ska inte röras av att
// euron rör sig.
//
// Kurserna cachas i fx_rates, tätt: varje kalenderdag får en rad. Riksbanken
// publicerar inget på helger och röda dagar, så de dagarna bär senast
// publicerade kurs — samma regel som gäller vid bokföring.

const SERIES = 'SEKEURPMI';                    // SEK per EUR, dagsnotering
const BASE = process.env.RIKSBANK_API || 'https://api.riksbank.se/swea/v1';
// Räcker över jul- och påskhelger, då Riksbanken kan vara tyst i över en vecka
const LOOKBACK_DAYS = 14;
const FALLBACK_RATE = Number(process.env.FX_FALLBACK_RATE) || 11;
const TIMEOUT_MS = 8000;

const iso = d => d.toISOString().substring(0, 10);
const parseDay = s => new Date(`${s}T12:00:00Z`);
function shiftDays(day, n) {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
function daysBetween(from, to) {
  const out = [];
  for (let d = parseDay(from); iso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(iso(d));
  return out;
}

// Riksbankens svar är [{ date, value }]. Ett tomt spann är helt normalt —
// frågar man om en helg finns det inget publicerat.
async function fetchRiksbank(from, to) {
  const url = `${BASE}/Observations/${SERIES}/${from}/${to}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Riksbanken svarade ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Oväntat svar från Riksbanken');
  return data
    .map(o => ({ day: String(o.date || '').substring(0, 10), rate: Number(o.value) }))
    .filter(o => /^\d{4}-\d{2}-\d{2}$/.test(o.day) && Number.isFinite(o.rate) && o.rate > 0)
    .sort((a, b) => a.day.localeCompare(b.day));
}

async function loadCached(from, to) {
  const { data, error } = await supabase.from('fx_rates')
    .select('day, rate, source').eq('currency', 'EUR')
    .gte('day', from).lte('day', to).order('day', { ascending: true });
  if (error) {
    // Innan 013 körts finns inte tabellen. Underlaget ska ändå gå att ta ut.
    console.warn(`[FX] Kunde inte läsa sparade kurser: ${error.message}`);
    return null;
  }
  return new Map((data || []).map(r => [r.day, { rate: Number(r.rate), source: r.source }]));
}

async function saveRates(rows) {
  if (!rows.length) return;
  const { error } = await supabase.from('fx_rates')
    .upsert(rows.map(r => ({ day: r.day, currency: 'EUR', rate: r.rate, source: r.source })),
      { onConflict: 'day,currency' });
  if (error) console.warn(`[FX] Kunde inte spara kurser: ${error.message}`);
}

// Fyller igen hålen: varje dag i spannet får en kurs, helger och röda dagar
// bär senaste publicerade. Dagar före första noteringen lämnas utan.
function densify(published, from, to) {
  const byDay = new Map(published.map(p => [p.day, p.rate]));
  const out = [];
  let last = null;
  for (const day of daysBetween(from, to)) {
    if (byDay.has(day)) { last = byDay.get(day); out.push({ day, rate: last, source: 'riksbank' }); }
    else if (last != null) out.push({ day, rate: last, source: 'carry' });
  }
  return out;
}

// Ger en uppslagsfunktion för ett datumspann. Ett anrop per export, inte ett
// per rad. Går hämtningen fel används det som redan finns sparat, och i sista
// hand den fasta kursen — ett underlag med en märkt kurs är bättre än inget.
async function ratesFor(from, to) {
  const today = iso(new Date());
  const until = to > today ? today : to;
  let cache = await loadCached(shiftDays(from, -LOOKBACK_DAYS), until) || new Map();

  const missing = daysBetween(from, until).filter(d => !cache.has(d));
  if (missing.length) {
    try {
      const published = await fetchRiksbank(shiftDays(from, -LOOKBACK_DAYS), until);
      const dense = densify(published, shiftDays(from, -LOOKBACK_DAYS), until);
      if (dense.length) {
        await saveRates(dense.filter(r => !cache.has(r.day) || cache.get(r.day).source === 'carry'));
        for (const r of dense) cache.set(r.day, { rate: r.rate, source: r.source });
      }
    } catch (e) {
      console.warn(`[FX] Kunde inte hämta kurser (${from}–${until}): ${e.message}`);
    }
  }

  // Senast kända kurs på eller före en dag — det är så en helgtransaktion
  // ska värderas, och det som räddar oss om hämtningen fallerat
  const known = [...cache.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  function at(day) {
    const hit = cache.get(day);
    if (hit) return { rate: hit.rate, rate_day: day, source: hit.source };
    let best = null;
    for (const [d, v] of known) { if (d <= day) best = { d, v }; else break; }
    if (best) return { rate: best.v.rate, rate_day: best.d, source: 'carry' };
    return { rate: FALLBACK_RATE, rate_day: null, source: 'fallback' };
  }
  at.complete = known.length > 0;
  return at;
}

module.exports = { ratesFor, FALLBACK_RATE, _internals: { densify, daysBetween, shiftDays } };
