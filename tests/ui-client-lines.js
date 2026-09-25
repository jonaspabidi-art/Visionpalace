const { chromium } = require(process.cwd()+'/node_modules/playwright-core');

// Kundens köphistorik. Priset som visas stort är vad RADEN kostade, inte
// styckpriset: står bara styckpriset med ett litet ×3 under får kunden räkna
// själv, och inget tal i listan stämmer med totalen längst ner.
const LONG = 'Santos de Cartier Brushed Gold Aviator';
const SALES = [{
  id:'s1', created_at:'2026-09-12T10:00:00Z', status:'unpaid', invoice_number:'VP09-014',
  sale_items:[
    { name:'Cartier Première', ref_code:'CT1', sell_price:'1200', qty:3, image:null },
    { name:'Woods', ref_code:'CT7', sell_price:'1400', qty:1, image:null },
    { name:LONG, ref_code:'CT-9120', sell_price:'980', qty:2, image:null },
    { name:'Panthere Rose', ref_code:'CT-5000', sell_price:'900', qty:3, image:null },
    { name:'Discount \u2014 Panthere Rose', ref_code:'CT-5000', sell_price:'-60', qty:3, image:null },
    { name:'Shipping', ref_code:null, sell_price:'20', qty:1, image:null },
    { name:'Discount', ref_code:null, sell_price:'-250', qty:1, image:null },
    { name:'Lens fitting', ref_code:null, sell_price:null, qty:2, image:null },
  ],
}];

(async () => {
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e).split('\n')[0]));
  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
    ['**/api/messages/**','{"messages":[]}'],['**/api/broadcasts/views','{}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/purchases/me', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ sales: SALES }) }));

  const price = i => page.evaluate(n =>
    document.querySelectorAll('.sale-item-row')[n].querySelector('.sale-item-price')?.textContent.trim() || '', i);
  const qty = i => page.evaluate(n =>
    document.querySelectorAll('.sale-item-row')[n].querySelector('.sale-item-qty')?.textContent.trim() || null, i);

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(() => localStorage.setItem('vp_session', JSON.stringify({
      session_token:'t', client:{ id:'c1', display_name:'Samora' } })));
    await page.goto('http://localhost:5959/client');
    await page.evaluate(() => switchTab('purchases')).catch(()=>{});
    await page.waitForSelector('.sale-item-row', { timeout: 15000 });
    await page.waitForTimeout(300);

    checks.push(['stora talet är radens summa, inte styckpriset', (await price(0)) === '€3600']);
    checks.push(['antalet står med styckpriset', (await qty(0)) === '3 × €1200']);
    checks.push(['två par räknas ihop', (await price(2)) === '€1960']);
    checks.push(['och visar sitt styckpris', (await qty(2)) === '2 × €980']);

    // Ett par ska se ut precis som förr — ingen "1 ×"-rad
    checks.push(['ett par visar bara priset', (await price(1)) === '€1400']);
    checks.push(['och ingen antalsrad', (await qty(1)) === null]);
    const radPris = namn => page.evaluate(n => {
      const rad = [...document.querySelectorAll('.sale-item-row')].find(r => r.textContent.includes(n));
      return rad?.querySelector('.sale-item-price')?.textContent.trim() ?? null;
    }, namn);
    checks.push(['frakten är orörd', (await radPris('Shipping')) === '€20']);
    // Rabatten står inte längre bland varorna utan i summeringen — annars blev
    // kortet dubbelt så långt, med en tom bildruta per rabattrad.
    const sumRader = () => page.evaluate(() =>
      [...document.querySelectorAll('.sale-card-sum')].map(r =>
        [...r.querySelectorAll('span')].map(s => s.textContent.trim())));
    const summering = await sumRader();
    checks.push(['rabatten ligger inte bland varorna',
      (await page.$$('.sale-item-row')).length === 6]);
    checks.push(['delsumman visas', summering.some(r => /Subtotal/i.test(r[0]))]);
    checks.push(['rabatten visas som avdrag',
      summering.some(r => /Discount/i.test(r[0]) && /430/.test(r[1]))]);

    // Varuraderna ska summera till delsumman, och delsumman minus rabatten till
    // totalen. Det var det som inte gick ihop förut.
    const sum = await page.evaluate(() => [...document.querySelectorAll('.sale-item-price')]
      .reduce((s, e) => s + parseFloat(e.textContent.replace('\u20ac','')), 0));
    const total = await page.evaluate(() =>
      document.querySelector('.sale-total-val').textContent.replace(/[\u20ac\s\u00a0,]/g,''));
    // 6 980 + 3 \u00d7 900 = 9 680 i delsumma; raderna visar netto, alltso 9 680 \u2212 180 = 9 500
    checks.push(['varuraderna summerar till delsumman minus parrabatten', sum === 9500]);
    checks.push(['delsumman minus all rabatt är totalen', total === '9250']);

    // Långa namn kapades mitt i ordet
    const nameBox = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.sale-item-name')].find(e => e.textContent.startsWith('Santos'));
      return { text: el.textContent, clipped: el.scrollHeight > el.clientHeight + 1 };
    });
    checks.push(['långt namn står helt i texten', nameBox.text === LONG]);
    checks.push(['och syns utan att kapas', nameBox.clipped === false]);

    // En rad utan pris får inte bli "2 × €null"
    const utanPris = await page.evaluate(() => {
      const rad = [...document.querySelectorAll('.sale-item-row')].find(r => r.textContent.includes('Lens fitting'));
      return { qty: rad?.querySelector('.sale-item-qty')?.textContent.trim() ?? null,
               pris: rad?.querySelector('.sale-item-price')?.textContent.trim() ?? '' };
    });
    checks.push(['rad utan pris visar bara antalet', utanPris.qty === '\u00d72']);
    checks.push(['och inget prisfält', utanPris.pris === '']);
    checks.push(['ordet null syns ingenstans',
      !(await page.textContent('.sale-card')).includes('null')]);

    // ── Rabatt per par ──
    // Kunden ska se sitt NYA pris per par, vad ordinarie var, och hur stort
    // avdraget är. Stod bara radens summa fick man räkna baklänges.
    const par = await page.evaluate(() => {
      const rad = [...document.querySelectorAll('.sale-item-row')]
        .find(r => r.textContent.includes('Panthere Rose'));
      return {
        styck: rad.querySelector('.sale-item-qty')?.textContent.replace(/\s+/g, ' ').trim(),
        ordinarie: rad.querySelector('.sale-item-qty s')?.textContent.trim(),
        nytt: rad.querySelector('.sale-item-new')?.textContent.trim(),
        belopp: rad.querySelector('.sale-item-price')?.textContent.trim(),
        sparat: rad.querySelector('.sale-item-saved')?.textContent.trim(),
      };
    });
    checks.push(['ordinarie priset stryks över', par.ordinarie === '\u20ac900']);
    checks.push(['nya priset per par visas', par.nytt === '\u20ac840']);
    checks.push(['antalet står med', /^3 \u00d7/.test(par.styck || '')]);
    checks.push(['avdraget per par skrivs ut', /60/.test(par.sparat || '') && /per par/.test(par.sparat || '')]);
    checks.push(['radens belopp är efter rabatt', par.belopp === '\u20ac2520']);

    // En vara utan parrabatt ska se ut precis som förut
    const utan = await page.evaluate(() => {
      const rad = [...document.querySelectorAll('.sale-item-row')]
        .find(r => r.textContent.includes('Woods'));
      return { ny: !!rad.querySelector('.sale-item-new'), sparat: !!rad.querySelector('.sale-item-saved'),
               belopp: rad.querySelector('.sale-item-price')?.textContent.trim() };
    });
    checks.push(['vara utan parrabatt är orörd',
      !utan.ny && !utan.sparat && utan.belopp === '\u20ac1400']);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/kund-rader.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
