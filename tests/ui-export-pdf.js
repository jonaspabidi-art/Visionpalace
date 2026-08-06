const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');
const REPORT = {
  month:'2026-07', admin:'Vision Palace',
  sales:[
    { date:'2026-07-03', paid_at:'2026-07-12', invoice:'VP07-010', client:'Samora',
      sold_by:'Vision Palace', status:'Betald', name:'Cartier Première', ref:'CT0582S-005',
      qty:1, sell:2400, amount:2400, buy:1097.45, profit:1302.55, preorder:false },
    { date:'2026-07-03', paid_at:'2026-07-12', invoice:'VP07-010', client:'Samora',
      sold_by:'Vision Palace', status:'Betald', name:'Frakt', ref:'',
      qty:1, sell:15, amount:15, buy:null, profit:null, preorder:false },
    { date:'2026-07-20', paid_at:'', invoice:'VP07-011', client:'Rojne',
      sold_by:'Vision Palace 2', status:'Obetald', name:'Woods Grey', ref:'CT7',
      qty:2, sell:1400, amount:2800, buy:900, profit:1000, preorder:true },
  ],
  purchases:[{ date:'2026-07-03', name:'Cartier Première', ref:'CT0582S-005', qty:2,
    unit:1097.45, amount:2194.9, source:'Förbeställning', added_by:'Vision Palace 2', document:'https://x/c.pdf' }],
  payments:[{ date:'2026-07-12', invoice:'VP07-010', client:'Samora', sold_by:'Vision Palace',
    amount:2415, note:'Bank', receipt:'https://x/k.jpg' }],
  totals:{ revenue:5215, profit:2302.55, purchases:2194.9 },
};
const SALES=[{ id:'s1', created_at:'2026-07-03T10:00:00Z', status:'paid', invoice_number:'VP07-010',
  client_id:'c1', clients:{ display_name:'Samora' },
  sale_items:[{ name:'Cartier Première', ref_code:'CT1', sell_price:'2400', buy_price:'1097.45', qty:1 }] }];
let asked=null, downloaded=null;
(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, acceptDownloads:true });
  const errors=[]; page.on('pageerror', e=>errors.push(String(e)));
  page.on('download', d => { downloaded = d.suggestedFilename(); });
  for (const [u,b] of [['**/api/clients','{"clients":[]}'],['**/api/broadcasts**','{"broadcasts":[]}'],
    ['**/api/push/**','{}'],['**/api/inventory','{"items":[]}'],['**/api/lenses','{"lenses":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
  await page.route('**/api/sales**', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ sales: SALES }) }));
  await page.route('**/api/export/bookkeeping**', r => {
    asked = r.request().url();
    if (asked.includes('format=json')) return r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(REPORT) });
    r.fulfill({ status:200, headers:{ 'content-type':'text/csv' }, body:'Datum;Fakturanr\n' });
  });

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    await page.click('#tab-historik'); await page.waitForTimeout(900);

    await page.click('button:has-text("Exportera bokföring")'); await page.waitForTimeout(400);
    checks.push(['formatvalet öppnas', await page.isVisible('#export-menu-modal')]);
    const menu = await page.textContent('#export-menu-rows');
    checks.push(['CSV finns som val', menu.includes('Excel-fil (CSV)')]);
    checks.push(['PDF finns som val', menu.includes('PDF')]);
    checks.push(['rubriken säger vilken månad', (await page.textContent('#export-menu-title')).includes('2026-07')]);

    // CSV-vägen
    await page.click('#export-menu-rows .sheet-row:has-text("Excel")'); await page.waitForTimeout(900);
    checks.push(['CSV hämtas utan format=json', !!asked && !asked.includes('format=json')]);

    // PDF-vägen
    asked=null; downloaded=null;
    await page.click('button:has-text("Exportera bokföring")'); await page.waitForTimeout(400);
    // html2pdf hämtas från cdnjs, som inte går att nå härifrån. Biblioteket
    // används redan av fakturan i produktion — det som behöver testas är vår
    // egen kedja: JSON → dokument → rätt element → filnamn → nedladdning.
    await page.evaluate(() => {
      window.__pdfCalls = [];
      window.html2pdf = () => ({
        set(opt) { window.__pdfCalls.push(opt); return this; },
        from(el) { window.__pdfEl = { tag: el?.tagName, len: (el?.outerHTML || '').length, text: (el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) }; return this; },
        outputPdf() { return Promise.resolve(new Blob(['%PDF-1.4 stub'], { type: 'application/pdf' })); },
      });
    });
    const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await page.click('#export-menu-rows .sheet-row:has-text("PDF")');
    const got = await dl;
    if (got) downloaded = got.suggestedFilename();
    const pdfOpt = await page.evaluate(() => window.__pdfCalls?.[0] || null);
    const pdfEl = await page.evaluate(() => window.__pdfEl || {});
    checks.push(['A4 stående begärs', pdfOpt?.jsPDF?.format === 'a4' && pdfOpt?.jsPDF?.orientation === 'portrait']);
    checks.push(['filnamnet sätts', pdfOpt?.filename === 'bokforing-2026-07.pdf']);
    checks.push(['dokumentet skickas in, inte omslaget',
      pdfEl.tag === 'DIV' && pdfEl.len > 2000 && /Vision Palace/.test(pdfEl.text)]);
    console.log('   (renderas:', JSON.stringify(pdfEl) + ')');
    checks.push(['PDF hämtar JSON', !!asked && asked.includes('format=json')]);
    checks.push(['PDF laddas ner med rätt namn', downloaded === 'bokforing-2026-07.pdf']);

    // Så här ser dokumentet ut innan det blir PDF
    const html = await page.evaluate(async () => {
      const logo = await imgToDataUrl('/logo.png').catch(() => null);
      const d = await (await fetch('/api/export/bookkeeping?month=2026-07&format=json',
        { headers:{ Authorization:'Bearer ' + localStorage.getItem('vp_admin_token') } })).json();
      const holder = document.createElement('div');
      holder.id = 'pdf-preview';
      holder.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow:auto;background:#888';
      holder.innerHTML = buildBookkeepingHTML(d, logo);
      document.body.appendChild(holder);
      return { hasLogo: !!logo, text: holder.textContent };
    });
    checks.push(['loggan bakas in i dokumentet', html.hasLogo]);
    checks.push(['rubriken visar månaden på svenska', html.text.includes('juli 2026')]);
    const plain = html.text.replace(/\u00a0/g, ' ');
    checks.push(['summorna finns', plain.includes('5 215,00') && plain.includes('2 302,55')]);
    checks.push(['försäljningar och inköp finns',
      html.text.includes('Försäljningar') && html.text.includes('Inköp')]);
    // Statuskolumnen och betaldatumet säger redan om fakturan är betald —
    // en egen betalningssektion i PDF:en blir bara upprepning
    checks.push(['ingen betalningssektion i PDF:en', !html.text.includes('Registrerade inbetalningar')]);
    checks.push(['betald-status finns kvar i tabellen',
      html.text.includes('Betald') && html.text.includes('Obetald')]);
    checks.push(['betaldatum finns kvar i tabellen', html.text.includes('2026-07-12')]);
    checks.push(['varan visas med ref', html.text.includes('Cartier Première (CT0582S-005)')]);
    checks.push(['förbeställningens inköp märks', html.text.includes('Förbeställning')]);
    checks.push(['inga JS-fel', errors.length===0]);
    await page.setViewportSize({ width: 900, height: 1400 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: (process.argv[2]||'/tmp')+'/export-pdf.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  if (errors.length) console.log(errors.slice(0,3));
  await browser.close(); process.exit(ok?0:1);
})();
