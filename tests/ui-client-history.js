const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');
// Två månader, en avbruten order som aldrig får räknas, och en rabattrad
const SALES = [
  { id:'s1', created_at:'2026-08-05T10:00:00Z', status:'paid', invoice_number:'VP08-001',
    sale_items:[{ name:'Cartier A', ref_code:'CT1', sell_price:'900', buy_price:'400', qty:2 },
                { name:'Shipping', ref_code:null, sell_price:'20', buy_price:null, qty:1 },
                { name:'Discount', ref_code:null, sell_price:'-150', buy_price:'0', qty:1 }] },
  { id:'s2', created_at:'2026-08-20T10:00:00Z', status:'unpaid', invoice_number:'VP08-009',
    sale_items:[{ name:'Cartier B', ref_code:'CT2', sell_price:'700', buy_price:'300', qty:1 }] },
  { id:'s3', created_at:'2026-07-11T10:00:00Z', status:'delivered', invoice_number:'VP07-004',
    sale_items:[{ name:'Woods', ref_code:'CT7', sell_price:'1400', buy_price:'900', qty:1 }] },
  { id:'s4', created_at:'2026-07-12T10:00:00Z', status:'cancelled', invoice_number:'VP07-005',
    sale_items:[{ name:'Avbruten', ref_code:'CT9', sell_price:'5000', buy_price:'1000', qty:1 }] },
];
(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors=[]; page.on('pageerror', e=>errors.push(String(e)));
  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
    ['**/api/inventory','{"items":[]}'],['**/api/lenses','{"lenses":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/clients', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ clients:[{ id:'c1', display_name:'Samora', admin_label:null, unread:0 }] }) }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
  await page.route('**/api/messages/**', r => r.fulfill({ status:200, contentType:'application/json', body:'{"messages":[]}' }));
  await page.route('**/api/sales/client/**', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ sales: SALES }) }));

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    await page.click('#tab-clients'); await page.waitForTimeout(600);
    await page.click('.client-row, [onclick*="openChat"]').catch(()=>{});
    await page.waitForTimeout(500);
    await page.evaluate(() => { currentClientId = 'c1'; openClientPurchases(); });
    await page.waitForTimeout(800);

    const t = (await page.textContent('#purchases-sheet-body')).replace(/ /g, ' ');

    // Augusti: (900×2 + 20 − 150) + 700 = 2 370. Vinst: (500×2 + (−150−0)) + 400 = 1 250
    checks.push(['augusti visas med summa', /augusti 2026[\s\S]{0,120}€ 2 370,00/.test(t)]);
    checks.push(['augusti visar vinst', /augusti 2026[\s\S]{0,160}vinst[\s\S]{0,20}€ 1 250,00/.test(t)]);
    checks.push(['antal köp per månad', /augusti 2026[\s\S]{0,200}2 köp/.test(t)]);

    // Juli: bara 1 400 — den avbrutna räknas inte
    checks.push(['juli visas med summa', /juli 2026[\s\S]{0,120}€ 1 400,00/.test(t)]);
    checks.push(['avbruten order räknas inte', !/6 400|5 000,00/.test(t)]);
    checks.push(['men syns kvar i listan', t.includes('Avbruten')]);

    // Totalen högst upp: 2 370 + 1 400 = 3 770, vinst 1 250 + 500 = 1 750
    checks.push(['totalt köpt visas', t.includes('Köpt totalt') && t.includes('€ 3 770,00')]);
    checks.push(['vår vinst visas', t.includes('Vår vinst') && t.includes('€ 1 750,00')]);
    checks.push(['snitt per månad', t.includes('Snitt/mån') && t.includes('€ 1 885,00')]);
    checks.push(['obetalt lyfts fram', /Obetalt just nu: € 700,00/.test(t)]);

    // Rabatten ska sänka både summa och vinst, precis som i bokföringen
    checks.push(['rabatten är inräknad', !/2 520,00/.test(t)]);
    checks.push(['inga JS-fel', errors.length===0]);
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/klient-historik.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  if (errors.length) console.log(errors.slice(0,3));
  await browser.close(); process.exit(ok?0:1);
})();
