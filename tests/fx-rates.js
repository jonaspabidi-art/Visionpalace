// Riksbanken publicerar inga kurser på helger och röda dagar. Ett sälj på en
// lördag ska då värderas till fredagens kurs — och en export får aldrig falla
// bara för att kurskällan är nere.
const http = require('http');

const PUBLISHED = [
  { date:'2026-06-30', value:11.10 },
  { date:'2026-07-01', value:11.20 },
  { date:'2026-07-02', value:11.30 },
  { date:'2026-07-03', value:11.40 },   // fredag
  // 4–5 juli helg, inget publicerat
  { date:'2026-07-06', value:11.50 },   // måndag
];

let apiCalls = 0, apiMode = 'ok';
const stored = new Map();

const mock = http.createServer((req,res)=>{
  let b=''; req.on('data',c=>b+=c);
  req.on('end',()=>{
    const p = req.url.split('?')[0];
    res.setHeader('Content-Type','application/json');
    // Riksbanken
    if (p.startsWith('/swea/v1/Observations/')) {
      apiCalls++;
      if (apiMode === 'down') { res.statusCode = 503; return res.end('{}'); }
      const [, from, to] = p.split('/').slice(4);
      return res.end(JSON.stringify(PUBLISHED.filter(o => o.date >= from && o.date <= to)));
    }
    // PostgREST: fx_rates
    if (p === '/rest/v1/fx_rates') {
      if (req.method === 'POST') {
        for (const r of JSON.parse(b||'[]')) stored.set(r.day, r);
        return res.end('[]');
      }
      const m = /day=gte\.([\d-]+)&day=lte\.([\d-]+)/.exec(decodeURIComponent(req.url));
      const from = m?.[1] || '0000-01-01', to = m?.[2] || '9999-12-31';
      return res.end(JSON.stringify([...stored.values()]
        .filter(r => r.day >= from && r.day <= to)
        .sort((a,b)=>a.day.localeCompare(b.day))));
    }
    res.statusCode=404; res.end('{}');
  });
});

mock.listen(0,'127.0.0.1', async () => {
  const port = mock.address().port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SERVICE_KEY = 'dummy';
  process.env.RIKSBANK_API = `http://127.0.0.1:${port}/swea/v1`;
  const { ratesFor } = require(process.cwd()+'/server/lib/fx.js');

  const checks = [];
  const at1 = await ratesFor('2026-07-01','2026-07-06');
  checks.push(['vardagens kurs används', at1('2026-07-02').rate===11.30]);
  checks.push(['kursen märks som Riksbankens', at1('2026-07-02').source==='riksbank']);
  checks.push(['lördag ärver fredagens kurs', at1('2026-07-04').rate===11.40]);
  checks.push(['söndag också', at1('2026-07-05').rate===11.40]);
  checks.push(['ärvd kurs märks som sådan', at1('2026-07-05').source==='carry']);
  checks.push(['ärvd kurs pekar ut vilken dag den kom från',
    at1('2026-07-05').rate_day==='2026-07-03' || at1('2026-07-05').rate_day==='2026-07-05']);
  checks.push(['måndagen får sin egen kurs', at1('2026-07-06').rate===11.50]);

  const callsAfterFirst = apiCalls;
  checks.push(['kurserna sparades', stored.size > 0]);

  // Andra exporten av samma månad ska inte fråga källan igen
  const at2 = await ratesFor('2026-07-01','2026-07-06');
  checks.push(['omexport frågar inte källan igen', apiCalls===callsAfterFirst]);
  checks.push(['omexport ger samma siffror', at2('2026-07-02').rate===11.30 && at2('2026-07-04').rate===11.40]);

  // Källan nere för ett spann vi inte hämtat förut (måste ligga bakåt i
  // tiden — framtida dagar har ingen kurs och slås aldrig upp)
  apiMode = 'down';
  const at3 = await ratesFor('2026-07-20','2026-07-22');
  checks.push(['nere källa fäller inte exporten', typeof at3('2026-07-21').rate === 'number']);
  checks.push(['då används senast kända kurs', at3('2026-07-21').rate===11.50]);
  checks.push(['och den märks som ärvd', at3('2026-07-21').source==='carry']);

  // Källan nere och ingenting sparat alls
  stored.clear();
  delete require.cache[require.resolve(process.cwd()+'/server/lib/fx.js')];
  const { ratesFor: rf2, FALLBACK_RATE } = require(process.cwd()+'/server/lib/fx.js');
  const at4 = await rf2('2026-07-20','2026-07-22');
  checks.push(['utan allt används den fasta kursen', at4('2026-07-21').rate===FALLBACK_RATE]);
  checks.push(['och den märks tydligt', at4('2026-07-21').source==='fallback']);

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  mock.close(); process.exit(ok?0:1);
});
