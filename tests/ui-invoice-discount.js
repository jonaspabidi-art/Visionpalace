const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');
const fs = require('fs');

// Admin-fakturan med samma form som en riktig order: varje par har en egen
// rabattrad. Förut låg de mitt bland varorna och fakturan blev dubbelt så lång
// utan att visa vad avdraget blev totalt.
const VAROR = [
  ['Cartier Jumping Panthere Gold / black', 'CT0120O-001', 1, 679, 50],
  ['Cartier 3D Panthere silver',            'CT0281O-002', 1, 649, 70],
  ['2025 Panthere Silver',                  'CT0601O-002', 2, 649, 70],
  ['C decor rosé gold sunglasses',          'CT0465S-009', 4, 729, 50],
  ['C decor silver solglas',                'CT0465S-010', 2, 729, 50],
  ['C decor rosé gold solglas',             'CT0468S-005', 4, 729, 50],
  ['C decor silver solglas',                'CT0468S-006', 2, 729, 50],
  ['Panthere de Cartier Limited Edition',   'CT0901O-001', 3, 899, 40],
  ['Santos Brushed Gold Aviator',           'CT0777S-003', 2, 849, 60],
];
const items = [];
for (const [namn, ref, qty, pris, rab] of VAROR) {
  items.push({ name: namn, ref_code: ref, sell_price: String(pris), buy_price: '400', qty });
  items.push({ name: `Discount — ${namn}`, ref_code: ref, sell_price: String(-rab), buy_price: '0', qty });
}
const varuSumma = VAROR.reduce((s, [, , q, p]) => s + q * p, 0);
const rabattSumma = VAROR.reduce((s, [, , q, , r]) => s + q * r, 0);

const SALES = [{ id:'s1', created_at:'2026-09-25T10:00:00Z', status:'unpaid', invoice_number:'VP09-008',
  client_id:'c1', clients:{ display_name:'Nikola', admin_label:null }, sale_items: items }];

(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e).split('\n')[0]));
  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
    ['**/api/lenses','{"lenses":[]}'],['**/api/inventory','{"items":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/clients', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ clients:[{ id:'c1', display_name:'Nikola', admin_label:null, unread:0 }] }) }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
  await page.route('**/api/sales**', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ sales: SALES }) }));
  const jspdfSrc = fs.readFileSync(process.cwd()+'/node_modules/jspdf/dist/jspdf.umd.min.js','utf8');
  await page.route('**/jspdf*.js', r => r.fulfill({ status:200, contentType:'application/javascript', body: jspdfSrc }));

  const kr = n => n.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/ /g,' ');
  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    await page.click('#tab-historik'); await page.waitForTimeout(900);
    await page.evaluate(() => openSaleInvoice('s1'));
    await page.waitForTimeout(1200);

    // Raderna som fylls i
    const rader = await page.evaluate(() => invLineItems.map(l => l.desc));
    checks.push(['varje vara får en rad', rader.filter(d => !/^Discount/.test(d)).length === 9]);
    checks.push(['rabatterna blir en enda rad', rader.filter(d => /^Discount/.test(d)).length === 1]);

    // Förhandsvisningen
    const prev = (await page.textContent('#inv-panel-preview')).replace(/ /g, ' ');
    checks.push(['ingen rabatt bland varorna', !/Discount — /.test(prev)]);
    checks.push(['nettot är varorna', prev.includes(kr(varuSumma))]);
    checks.push(['rabatten står som egen summarad', /Discount|Rabatt/.test(prev)]);
    checks.push(['med hela avdraget', prev.includes(kr(rabattSumma))]);
    checks.push(['totalen är varorna minus rabatten', prev.includes(kr(varuSumma - rabattSumma))]);

    // PDF:en
    const pdf = await page.evaluate(async () => {
      await new Promise((res, rej) => {
        if (window.jspdf?.jsPDF) return res();
        const el = document.createElement('script');
        el.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        el.onload = res; el.onerror = rej; document.head.appendChild(el);
      });
      const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
      const blob = buildInvoicePdf(JsPDF, invSamlaData());
      // Bygg om för att kunna läsa insidan
      const d2 = (() => {
        const doc = new JsPDF({ unit:'mm', format:'a4' });
        return doc;
      })();
      return { storlek: blob.size };
    });
    checks.push(['PDF:en är text, inte bild', pdf.storlek > 0 && pdf.storlek < 120000]);

    // Läs sidor och positioner ur samma bygge
    const inre = await page.evaluate(() => {
      const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
      const d = invSamlaData();
      // Kör byggaren men behåll dokumentet: samma kod, utan output()
      const doc = new JsPDF({ unit:'mm', format:'a4' });
      window.__doc = doc;
      buildInvoicePdf(JsPDF, d);
      return null;
    });

    const mätt = await page.evaluate(() => {
      const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
      // Fånga dokumentet genom att låta jsPDF-konstruktorn spara sista instansen
      const Orig = JsPDF;
      let sista = null;
      const Spion = function (...a) { sista = new Orig(...a); return sista; };
      Spion.prototype = Orig.prototype;
      buildInvoicePdf(Spion, invSamlaData());
      const sidor = sista.getNumberOfPages();
      const text = [];
      const djup = [];
      for (let p = 1; p <= sidor; p++) {
        sista.setPage(p);
        const t = sista.internal.pages[p].join(' ');
        text.push(t);
        const ys = [...t.matchAll(/([\d.]+) ([\d.]+) Td/g)].map(m => (841.89 - parseFloat(m[2])) / 2.8346);
        djup.push(ys.sort((a,b) => b-a));
      }
      return { sidor, text, djup };
    });

    // Nio varor med var sin rabattrad var arton rader förut. Utan rabattraderna
    // får samma order plats på en enda sida.
    checks.push(['ordern får plats på en sida nu', mätt.sidor === 1]);
    checks.push(['ingen rad rinner utanför sidan',
      mätt.djup.every(ys => ys.filter(y => y > 272).length <= 1)]);
    checks.push(['tabellhuvudet finns', mätt.text.every(t => /description|beskrivning/i.test(t))]);
    checks.push(['en ensam sida får inget sidnummer', !/1 \/ 1/.test(mätt.text[0])]);
    const sista = mätt.text[mätt.text.length - 1];
    checks.push(['summeringen står på sista sidan', /TOTAL/.test(sista)]);
    checks.push(['rabatten summeras i PDF:en', /Discount|Rabatt/.test(sista)]);
    checks.push(['bankuppgifterna står sist', /IBAN|Clearing/.test(sista)]);
    checks.push(['ingen rabattrad bland varorna i PDF:en',
      !mätt.text.some(t => /Discount .{0,4} Cartier/.test(t))]);

    // ── En order som verkligen inte får plats ──
    const stor = await page.evaluate(() => {
      invLineItems = []; invLineNextId = 0;
      for (let i = 1; i <= 34; i++) {
        addInvLine(`Cartier Panthere Limited Edition Modell ${i}`, String(i % 4 === 0 ? 2 : 1),
          String(700 + i), '0');
      }
      addInvLine('Discount', '1', '-1500', '0');
      renderInvLines();
      generateInvoice();
      const JsPDF = window.jspdf?.jsPDF || window.jsPDF;
      const Orig = JsPDF;
      let sista = null;
      const Spion = function (...a) { sista = new Orig(...a); return sista; };
      Spion.prototype = Orig.prototype;
      buildInvoicePdf(Spion, invSamlaData());
      const sidor = sista.getNumberOfPages();
      const text = [], djup = [];
      for (let p = 1; p <= sidor; p++) {
        sista.setPage(p);
        const t = sista.internal.pages[p].join(' ');
        text.push(t);
        djup.push([...t.matchAll(/([\d.]+) ([\d.]+) Td/g)]
          .map(m => (841.89 - parseFloat(m[2])) / 2.8346).sort((a,b) => b-a));
      }
      return { sidor, text, djup };
    });
    checks.push(['34 varor blir flera sidor', stor.sidor > 1]);
    checks.push(['varje sida har tabellhuvudet',
      stor.text.every(t => /description|beskrivning/i.test(t))]);
    checks.push(['ingen rad rinner utanför sidan på någon av dem',
      stor.djup.every(ys => ys.filter(y => y > 272).length <= 1)]);
    checks.push(['sidnumren skrivs ut', /1 \/ \d/.test(stor.text[0])]);
    checks.push(['summeringen står på sista sidan', /TOTAL/.test(stor.text[stor.sidor - 1])]);
    checks.push(['bankuppgifterna står sist', /IBAN|Clearing/.test(stor.text[stor.sidor - 1])]);
    console.log(`   (stor order: ${stor.sidor} sidor)`);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
    console.log(`   (${mätt.sidor} sidor, ${Math.round(pdf.storlek/1024)} kB, netto ${kr(varuSumma)}, rabatt ${kr(rabattSumma)})`);
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/admin-faktura.png', fullPage:true });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
