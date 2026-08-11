const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');

// Ett underlag som säkert spänner över flera sidor. Förr klipptes det långa
// arket rakt igenom tabellraderna, så siffror hamnade halva på två sidor och
// sidorna 2 och framåt saknade både marginal och kolumnrubrik.
const sales = [];
for (let i = 1; i <= 26; i++) {
  const inv = `VP07-${String(i).padStart(3, '0')}`;
  sales.push({ sale_id:`s${i}`, date:'2026-07-05', paid_at:'2026-07-12', invoice:inv,
    client:`Kund med ett ganska långt namn ${i}`, sold_by:'Vision Palace', status:'Betald',
    name:`Cartier Modell ${i} med lång beskrivning`, ref:`CT${i}0582S-005`,
    qty:2, sell:1200, amount:2400, buy:900, profit:600, preorder:false });
  sales.push({ sale_id:`s${i}`, date:'2026-07-05', paid_at:'2026-07-12', invoice:inv,
    client:`Kund med ett ganska långt namn ${i}`, sold_by:'Vision Palace', status:'Betald',
    name:'Shipping', ref:'', qty:1, sell:15, amount:15, buy:null, profit:null, preorder:false });
}
const purchases = [];
for (let i = 1; i <= 22; i++) {
  purchases.push({ date:'2026-07-03', name:`Cartier Modell ${i} med lång beskrivning`,
    ref:`CT${i}0582S-005`, qty:2, unit:900, amount:1800,
    // Fakturan kom i kronor — 9 900 kr per styck, 19 800 kr på raden
    original_unit:9900, original_amount:19800, currency:'SEK', fx_rate:11,
    source:'Förbeställning', added_by:'Vision Palace 2', document:'' });
}
const inventory = [];
for (let i = 1; i <= 30; i++) {
  inventory.push({ ref:`CT${i}0582S-005`, name:`Cartier Modell ${i} med lång beskrivning`,
    qty:(i % 4) + 1, buy:900, value:900 * ((i % 4) + 1), sell:1400 });
}
const REPORT = { month:'2026-07', admin:'Vision Palace', stock_as_of:'2026-08-11',
  sales, purchases, payments:[], inventory,
  totals:{ revenue:62790, profit:15600, purchases:39600, stock_count:75, stock_value:67500, stock_retail:105000 } };

(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors=[]; page.on('pageerror', e=>errors.push(String(e)));
  for (const [u,b] of [['**/api/clients','{"clients":[]}'],['**/api/broadcasts**','{"broadcasts":[]}'],
    ['**/api/push/**','{}'],['**/api/inventory','{"items":[]}'],['**/api/lenses','{"lenses":[]}'],
    ['**/api/sales**','{"sales":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});

    const r = await page.evaluate(rep => {
      const holder = document.createElement('div');
      holder.id = 'pdf-preview';
      holder.style.cssText = 'position:fixed;left:-10000px;top:0';
      holder.innerHTML = buildBookkeepingHTML(rep, null);
      document.body.appendChild(holder);
      const pages = [...holder.querySelectorAll('.pdf-page')];
      const A4 = 297 * (96 / 25.4);
      return {
        count: pages.length,
        // overflow:hidden gör att allt som inte får plats klipps bort. Är
        // scrollHeight större än clientHeight har text försvunnit.
        overflowing: pages.filter(p => p.scrollHeight > p.clientHeight + 1).length,
        heights: pages.map(p => Math.round(p.offsetHeight)),
        a4: Math.round(A4),
        footers: pages.map((p, i) => p.textContent.includes(`Sida ${i + 1} av ${pages.length}`)),
        // Varje tabellbit på varje sida måste bära sin egen kolumnrubrik —
        // annars vet man inte vilken kolumn som är belopp och vilken som är
        // vinst när tabellen fortsätter på nästa sida
        // Rubriken ska stå en gång per sida och tabell, ovanför första raden
        // — inte före varje enskilt köp.
        tablesWithoutHead: pages.reduce((bad, p) => {
          const seen = new Set();
          for (const t of p.querySelectorAll('table')) {
            const key = t.dataset.table;
            const hasHead = !!t.querySelector('th');
            if (!seen.has(key)) { seen.add(key); if (!hasHead) bad++; }
            else if (hasHead) bad++;   // upprepad rubrik mitt på sidan
          }
          return bad;
        }, 0),
        tableCount: pages.reduce((n, p) => n + p.querySelectorAll('table').length, 0),
        headCount: pages.reduce((n, p) => n + p.querySelectorAll('th').length, 0),
        stockPageIdx: pages.findIndex(p => p.textContent.includes('Lagerstatus')),
        stockPageStartsClean: (() => {
          const p = pages.find(x => x.textContent.includes('Lagerstatus'));
          if (!p) return false;
          // Lagret ska börja högst upp på en egen sida, inte under inköpen
          return !/Inköp\b/.test(p.textContent) && !/Försäljningar/.test(p.textContent);
        })(),
        text: holder.textContent.replace(/ /g, ' '),
      };
    }, REPORT);

    checks.push(['underlaget blir flera sidor', r.count > 3]);
    checks.push(['ingen sida svämmar över', r.overflowing === 0]);
    checks.push(['varje sida är exakt A4', r.heights.every(h => Math.abs(h - r.a4) <= 1)]);
    checks.push(['varje sida numreras', r.footers.every(Boolean)]);
    checks.push(['kolumnrubriken står överst på varje sida med tabell',
      r.tableCount > 0 && r.tablesWithoutHead === 0]);
    checks.push(['lagerstatus finns med', r.stockPageIdx >= 0]);
    checks.push(['lagret börjar på en egen sida', r.stockPageStartsClean]);
    checks.push(['lagret är daterat', r.text.includes('2026-08-11')]);
    checks.push(['lagervärdet summeras', r.text.includes('75 par i lager') && r.text.includes('67 500,00')]);
    checks.push(['köpet står en gång, inte på varje varurad',
      (r.text.match(/VP07-001/g) || []).length === 1]);
    checks.push(['summorna finns kvar', r.text.includes('62 790,00') && r.text.includes('15 600,00')]);
    checks.push(['fakturans belopp står bredvid euro-priset',
      r.text.includes('Enligt faktura') && r.text.includes('19 800,00 SEK')]);
    checks.push(['inga JS-fel', errors.length===0]);

    console.log(`   (${r.count} sidor, höjder ${[...new Set(r.heights)].join('/')} px, A4 = ${r.a4} px)`);
    await page.setViewportSize({ width: 900, height: 1300 });
    await page.evaluate(() => {
      const h = document.getElementById('pdf-preview');
      h.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow:auto;background:#888';
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/export-sidor.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  if (errors.length) console.log(errors.slice(0,3));
  await browser.close(); process.exit(ok?0:1);
})();
