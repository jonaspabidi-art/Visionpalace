const { chromium } = require(process.cwd()+'/node_modules/playwright-core');

// Fakturan kunden får. Två saker den måste klara: rabatterna ska summeras till
// EN rad längst ner i stället för att ligga utspridda mellan varorna, och en
// stor order måste brytas över flera sidor utan att en rad kapas på mitten.
const rader = [];
for (let i = 1; i <= 28; i++) rader.push({
  name: i % 5 === 0 ? 'Santos de Cartier Brushed Gold Aviator Limited' : `Cartier Modell ${i}`,
  ref_code:`CT-${2000+i}`, sell_price:String(900 + i), qty: i % 6 === 0 ? 2 : 1 });

const varuSumma = rader.reduce((s,r) => s + parseFloat(r.sell_price) * r.qty, 0);
const RABATT = 250 + 300;   // en längst ner + en per par

const STOR = { id:'s1', created_at:'2026-09-12T10:00:00Z', status:'unpaid', invoice_number:'VP09-020',
  sale_items:[ ...rader,
    { name:'Discount', ref_code:null, sell_price:'-250', qty:1 },
    { name:'Discount — Cartier Modell 1', ref_code:'CT-2001', sell_price:'-300', qty:1 } ] };

const LITEN = { id:'s2', created_at:'2026-09-13T10:00:00Z', status:'unpaid', invoice_number:'VP09-021',
  sale_items:[{ name:'Woods', ref_code:'CT7', sell_price:'1400', qty:1 }] };

const nbsp = t => t.replace(/ /g, ' ');

(async () => {
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e).split('\n')[0]));
  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
    ['**/api/messages/**','{"messages":[]}'],['**/api/broadcasts/views','{}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/purchases/me', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ sales: [STOR, LITEN] }) }));

  // jsPDF hämtas från cdnjs i appen. Sandlådan når inte ut, så biblioteket
  // serveras från node_modules i stället — det är samma fil, och testet mäter
  // då riktig sidbrytning och riktig filstorlek, inte en attrapp.
  const fs = require('fs');
  const jspdfSrc = fs.readFileSync(process.cwd()+'/node_modules/jspdf/dist/jspdf.umd.min.js', 'utf8');
  await page.route('**/jspdf*.js', r => r.fulfill({
    status:200, contentType:'application/javascript', body: jspdfSrc }));

  const öppna = inv => page.evaluate(n => {
    const kort = [...document.querySelectorAll('.sale-card')].find(k => k.textContent.includes(n));
    kort.querySelector('.sale-invoice-btn').click();
  }, inv);

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(() => localStorage.setItem('vp_session', JSON.stringify({
      session_token:'t', client:{ id:'c1', display_name:'Samora' } })));
    await page.goto('http://localhost:5959/client');
    await page.evaluate(() => switchTab('purchases')).catch(()=>{});
    await page.waitForSelector('.sale-card', { timeout: 15000 });
    await page.waitForTimeout(400);

    // ── Förhandsvisningen ──
    await öppna('VP09-020');
    await page.waitForTimeout(600);
    const doc = nbsp(await page.textContent('#invoice-doc'));
    checks.push(['rabatterna ligger inte bland varorna', !doc.includes('Discount — Cartier Modell 1')]);
    checks.push(['rabatten står som en summarad', doc.includes('Discount')]);
    checks.push(['delsumman visas', doc.includes(`€ ${varuSumma.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/ /g,' ')}`)]);
    const väntadTotal = (varuSumma - RABATT).toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/ /g,' ');
    checks.push(['totalen är varorna minus rabatten', doc.includes(`€ ${väntadTotal}`)]);
    checks.push(['varuraderna finns kvar', doc.includes('Cartier Modell 28')]);

    // En order utan rabatt ska inte få några extra rader
    await page.evaluate(() => closeInvoice());
    await page.waitForTimeout(300);
    await öppna('VP09-021');
    await page.waitForTimeout(600);
    const enkel = nbsp(await page.textContent('#invoice-doc'));
    checks.push(['utan rabatt visas ingen rabattrad', !enkel.includes('Discount')]);
    checks.push(['och ingen delsumma', !enkel.includes('Subtotal')]);
    checks.push(['totalen är varans pris', enkel.includes('1 400,00')]);

    // ── PDF:en ──
    await page.evaluate(() => closeInvoice());
    await page.waitForTimeout(300);
    await öppna('VP09-020');
    await page.waitForTimeout(600);

    const pdf = await page.evaluate(async () => {
      await new Promise((res, rej) => {
        if (window.jspdf?.jsPDF) return res();
        const el = document.createElement('script');
        el.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        el.onload = res; el.onerror = rej; document.head.appendChild(el);
      });
      const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
      const d = buildSaleInvoicePdf(JsPDF, _currentInvoiceSale);
      const sidor = d.getNumberOfPages();
      const text = [];
      for (let p = 1; p <= sidor; p++) {
        d.setPage(p);
        text.push(d.internal.pages[p].join(' '));
      }
      // Var på sidan texten faktiskt hamnade. jsPDF skriver "x y Td" i punkter
      // från nederkanten; A4 är 841,89 pt hög och 1 mm = 2,8346 pt.
      const djupast = text.map(t => {
        const ys = [...t.matchAll(/([\d.]+) ([\d.]+) Td/g)].map(m => parseFloat(m[2]));
        // mm från överkanten, störst = längst ner på sidan
        return ys.map(y => (841.89 - y) / 2.8346).sort((a, b) => b - a);
      });
      return { sidor, storlek: d.output('blob').size, text, djupast };
    });

    checks.push(['stor order blir flera sidor', pdf.sidor > 1]);
    // Att texten FINNS i strömmen betyder inte att den syns — rader som rinner
    // förbi sidkanten skrivs ändå ut, de bara klipps bort i läsaren. Därför
    // mäts var de hamnade: bara sidnumret får stå nedanför 272 mm.
    checks.push(['ingen rad rinner utanför sidan',
      pdf.djupast.every(ys => ys.filter(y => y > 272).length <= 1)]);
    checks.push(['och inget hamnar utanför pappret',
      pdf.djupast.every(ys => ys.every(y => y < 297 && y > 0))]);
    checks.push(['filen är liten — text, inte bild', pdf.storlek < 120000]);
    checks.push(['varje sida har tabellhuvudet',
      pdf.text.every(t => /Description/i.test(t))]);
    checks.push(['sidnumren skrivs ut', /Page 1 of/.test(pdf.text[0])]);
    const sista = pdf.text[pdf.text.length - 1];
    checks.push(['summeringen står på sista sidan', /TOTAL/.test(sista)]);
    checks.push(['rabatten summeras i PDF:en', /Discount/.test(sista) && /Subtotal/.test(sista)]);
    checks.push(['bankuppgifterna står sist', /IBAN/.test(sista)]);
    checks.push(['ingen rabattrad bland varorna i PDF:en',
      !pdf.text.some(t => /Discount .* Cartier Modell 1/.test(t))]);

    // Kunden ska se sitt nya pris per par, inte bara radens summa
    const parRad = pdf.text.join(' ');
    checks.push(['avdraget per par skrivs ut i PDF:en', /per pair/i.test(parRad)]);
    const prev2 = nbsp(await page.textContent('#invoice-doc'));
    checks.push(['och i förhandsvisningen', /per pair/i.test(prev2)]);
    const nytt = await page.evaluate(() => {
      const rad = [...document.querySelectorAll('#invoice-doc tr')]
        .find(r => r.textContent.includes('Cartier Modell 1') && !r.textContent.includes('Modell 10'));
      return { struket: rad?.querySelector('s')?.textContent.trim() || null,
               nytt: rad?.querySelector('strong')?.textContent.trim() || null };
    });
    checks.push(['ordinarie priset stryks över på fakturan', /901/.test(nytt.struket || '')]);
    checks.push(['nya priset per par står bredvid', /601/.test(nytt.nytt || '')]);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
    console.log(`   (${pdf.sidor} sidor, ${Math.round(pdf.storlek/1024)} kB)`);
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/faktura-stor.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
