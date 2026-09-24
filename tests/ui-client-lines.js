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
    { name:'Shipping', ref_code:null, sell_price:'20', qty:1, image:null },
    { name:'Discount', ref_code:null, sell_price:'-250', qty:1, image:null },
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
    checks.push(['frakten är orörd', (await price(3)) === '€20']);
    checks.push(['rabatten är kvar som minus', (await price(4)) === '€-250']);

    // Summan av raderna måste bli totalen. Det var det som inte gick ihop förut.
    const sum = await page.evaluate(() => [...document.querySelectorAll('.sale-item-price')]
      .reduce((s, e) => s + parseFloat(e.textContent.replace('€','')), 0));
    const total = await page.evaluate(() =>
      document.querySelector('.sale-total-val').textContent.replace(/[€\s ,]/g,''));
    checks.push(['raderna summerar till totalen', sum === 6730 && total === '6730']);

    // Långa namn kapades mitt i ordet
    const nameBox = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.sale-item-name')].find(e => e.textContent.startsWith('Santos'));
      return { text: el.textContent, clipped: el.scrollHeight > el.clientHeight + 1 };
    });
    checks.push(['långt namn står helt i texten', nameBox.text === LONG]);
    checks.push(['och syns utan att kapas', nameBox.clipped === false]);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/kund-rader.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
