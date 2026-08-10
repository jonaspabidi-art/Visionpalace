const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');
const ITEMS = [
  { id:'i1', name:'Cartier A', ref_code:'CT1', sell_price:'900', buy_price:'400', image:null },
  { id:'i2', name:'Cartier A', ref_code:'CT1', sell_price:'900', buy_price:'400', image:null },
];
let posted = null;
(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors=[]; page.on('pageerror', e=>errors.push(String(e)));
  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],['**/api/lenses','{"lenses":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/clients', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ clients:[{ id:'c1', display_name:'Samora', admin_label:null }] }) }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
  await page.route('**/api/inventory', r => r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({ items: ITEMS }) }));
  await page.route('**/api/sales**', r => {
    if (r.request().method()==='POST') { posted = JSON.parse(r.request().postData()||'{}');
      return r.fulfill({ status:200, contentType:'application/json', body:'{"sale":{"id":"s1"}}' }); }
    r.fulfill({ status:200, contentType:'application/json', body:'{"sales":[]}' });
  });

  const checks=[]; let crash=null;
  // sv-SE skiljer tusental med hårt blanksteg — jämför alltid normaliserat
  const txt = async sel => (await page.textContent(sel)).replace(/\u00a0/g, ' ');
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    await page.click('#tab-inventory'); await page.waitForTimeout(500);

    // Två par à 900 = 1800
    await page.locator('.inv-card').first().locator('.inv-sell-btn').click(); await page.waitForTimeout(150);
    await page.locator('.inv-card').first().locator('.inv-sell-btn').click(); await page.waitForTimeout(150);
    await page.click('#inv-sell-open-btn'); await page.waitForTimeout(500);
    checks.push(['rabattfältet finns i säljrutan', await page.isVisible('#sale-discount')]);
    checks.push(['euro är förvalt', (await page.textContent('#sale-disc-unit')).trim() === '€']);
    checks.push(['tomt fält förklarar sig', (await txt('#sale-disc-hint')).includes('Lämna tomt')]);
    checks.push(['totalen börjar på 1 800', (await txt('#sale-total')).includes('1 800,00')]);

    // 150 € rabatt
    await page.fill('#sale-discount','150'); await page.waitForTimeout(300);
    checks.push(['totalen sänks av rabatten', (await txt('#sale-total')).includes('1 650,00')]);
    checks.push(['hinten visar före och efter', (await txt('#sale-disc-hint')).includes('1 800,00 → 1 650,00')]);

    // Procent i stället: 10 % av 1800 = 180
    await page.click('#sale-disc-pct'); await page.waitForTimeout(200);
    checks.push(['tecknet byts till procent', (await page.textContent('#sale-disc-unit')).trim() === '%']);
    await page.fill('#sale-discount','10'); await page.waitForTimeout(300);
    checks.push(['procent räknas om till belopp', (await txt('#sale-total')).includes('1 620,00')]);

    // Orimliga värden ska inte ge negativ försäljning
    await page.fill('#sale-discount','500'); await page.waitForTimeout(300);
    checks.push(['över 100 % kapas', (await txt('#sale-total')).includes('0,00')
      && !(await txt('#sale-total')).includes('-')]);
    await page.click('#sale-disc-abs'); await page.waitForTimeout(200);
    await page.fill('#sale-discount','9999'); await page.waitForTimeout(300);
    checks.push(['belopp större än varorna kapas', !(await txt('#sale-total')).includes('-')]);

    // Frakt + rabatt tillsammans
    await page.fill('#sale-discount','150');
    await page.fill('#sale-shipping','20'); await page.waitForTimeout(300);
    checks.push(['frakt läggs på efter rabatten', (await txt('#sale-total')).includes('1 670,00')]);

    await page.selectOption('#sale-client-pick','c1');
    await page.click('#sale-modal .inv-gen-btn'); await page.waitForTimeout(900);
    const items = posted?.items || [];
    const disc = items.find(i => i.name === 'Discount');
    const ship = items.find(i => i.name === 'Shipping');
    checks.push(['försäljningen postas', !!posted]);
    checks.push(['rabattraden följer med', !!disc]);
    checks.push(['som negativt belopp', disc?.sell_price === -150]);
    checks.push(['med inköpspris 0, så vinsten sänks', disc?.buy_price === 0]);
    checks.push(['fraktraden heter Shipping', !!ship && ship.sell_price === 20]);
    checks.push(['ingen svensk fraktrad kvar', !items.some(i => i.name === 'Frakt')]);
    checks.push(['inga JS-fel', errors.length===0]);
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  if (errors.length) console.log(errors.slice(0,3));
  await browser.close(); process.exit(ok?0:1);
})();
