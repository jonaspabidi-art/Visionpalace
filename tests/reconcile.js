// Allt måste hänga ihop: samma order ska ge samma siffra i bokföringsexporten
// och i avräkningen. Båda körs mot den RIKTIGA serverkoden — bara databasen är
// hånad. Avviker en formel faller den vyn, inte alla.
const http = require('http');
const express = require(process.cwd()+'/node_modules/express');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');
const F = require(process.cwd()+'/tests/fixtures/reconcile.js');

const ADMIN = 'admin-1', PAYER = 'admin-2';
const webpush = require(process.cwd()+'/node_modules/web-push');
const k = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = k.publicKey;
process.env.VAPID_PRIVATE_KEY = k.privateKey;

const RATE = 11;          // fast kurs, så avstämningen inte beror på Riksbanken
const CFG = { seller_admin_id: ADMIN, payer_admin_id: PAYER,
  commission_pct: F.COMMISSION_PCT, eur_sek_rate: RATE };

// Databasen: bara det de två vyerna faktiskt läser
function mockDb() {
  return http.createServer((req, res) => {
    let b=''; req.on('data',c=>b+=c);
    req.on('end',()=>{
      const p = req.url.split('?')[0];
      res.setHeader('Content-Type','application/json');
      const send = x => res.end(JSON.stringify(x));
      if (p === '/rest/v1/app_settings') return send({ value: JSON.stringify(CFG) });
      if (p === '/rest/v1/sales') return send(F.SALES);
      if (p === '/rest/v1/admins') return send([{ id: ADMIN, username:'saljare' }]);
      if (p === '/rest/v1/settlements') return send([]);
      if (p === '/rest/v1/purchases') return send([]);
      if (p === '/rest/v1/sale_payments') return send([]);
      if (p === '/rest/v1/inventory') return send([]);
      if (p === '/rest/v1/fx_rates') return send([]);
      res.statusCode = 404; send({});
    });
  });
}

const checks = [];
const near = (a, b) => Math.abs(a - b) < 0.005;

(async () => {
  const db = mockDb();
  await new Promise(r => db.listen(0,'127.0.0.1',r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${db.address().port}`;
  process.env.SUPABASE_SERVICE_KEY = 'dummy';
  process.env.JWT_SECRET = 'test-secret';
  process.env.FX_FALLBACK_RATE = String(RATE);
  process.env.RIKSBANK_API = 'http://127.0.0.1:1';   // nere: tvingar fram fasta kursen
  for (const m of ['/server/lib/supabase.js','/server/routes/settlement.js','/server/routes/export.js','/server/lib/fx.js'])
    delete require.cache[require.resolve(process.cwd()+m)];

  const app = express(); app.use(express.json());
  app.use('/api', require(process.cwd()+'/server/routes/settlement.js')());
  app.use('/api', require(process.cwd()+'/server/routes/export.js')());
  const srv = app.listen(0,'127.0.0.1');
  await new Promise(r => srv.on('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const H = { Authorization:`Bearer ${jwt.sign({ role:'admin', adminId: ADMIN },'test-secret')}` };

  // ── Avräkningen ──
  const st = await (await fetch(`${base}/api/settlement`, { headers: H })).json();
  checks.push(['avräkningen räknar vinsten i euro', near(st.earned_eur, F.EARNED)]);
  checks.push(['och växlar den med kursen', near(st.earned, F.EARNED * RATE)]);
  checks.push(['den avbrutna ordern räknas inte', !near(st.earned_eur, (F.PROFIT + 26997) * 0.7)]);
  checks.push(['ingenting ligger som väntande — ordern är betald', near(st.pending_eur, 0)]);
  checks.push(['rader utan inköpspris flaggas inte här — ordern har flera som har',
    st.missing_buy_price === 0]);

  // ── Bokföringsexporten ──
  const r = await (await fetch(`${base}/api/export/bookkeeping?month=2026-09&format=json`, { headers: H })).json();
  const oms = r.totals?.revenue_sek;
  const vinst = r.totals?.profit_sek;
  console.log('  export totals:', JSON.stringify(r.totals));
  console.log('  export rader :', (r.sales||[]).length);
  checks.push(['exporten hittar summorna', oms != null && vinst != null]);
  checks.push(['exporten räknar i euro också', near(r.totals?.revenue, F.REVENUE) && near(r.totals?.profit, F.PROFIT)]);
  checks.push(['exportens omsättning är orderns, växlad', near(oms, F.REVENUE * RATE)]);
  checks.push(['exportens vinst är orderns, växlad', near(vinst, F.PROFIT * RATE)]);

  // ── Och de två mot varandra ──
  checks.push(['avräkningen är exakt sin andel av exportens vinst',
    near(st.earned, vinst * F.COMMISSION_PCT / 100)]);

  // Den avbrutna ordern ska inte finnas bland raderna heller, inte bara saknas
  // i summan — annars går raderna och summan isär i kalkylbladet
  const rader = r.sales || [];
  checks.push(['exporten listar inte den avbrutna ordern',
    !rader.some(x => x.invoice === 'VP09-002')]);
  checks.push(['raderna summerar till exportens egen summa',
    near(rader.reduce((a, x) => a + x.amount, 0), F.REVENUE)]);
  checks.push(['och vinstraderna likaså',
    near(rader.reduce((a, x) => a + (x.profit || 0), 0), F.PROFIT)]);
  checks.push(['betalningsraderna bär orderns status',
    (r.payments || []).every(x => typeof x.status === 'string')]);

  srv.close(); db.close();
  let ok = true;
  for (const [l,p] of checks) { console.log(`${p?'PASS':'FAIL'} — ${l}`); if (!p) ok = false; }
  process.exit(ok?0:1);
})().catch(e => { console.log('FAIL — testet avbröts: ' + (e.stack||e.message)); process.exit(1); });
