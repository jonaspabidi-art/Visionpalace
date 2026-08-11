const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');
// Historik-fliken: månadsraden och totalkorten får inte räkna med avbrutna köp.
// Augusti har ett betalt, ett obetalt och ett avbrutet — det avbrutna ska synas
// i listan men inte i någon summa.
const SALES = [
  { id:'s1', created_at:'2026-08-05T10:00:00Z', status:'paid', invoice_number:'VP08-001',
    clients:{ display_name:'Samora', admin_label:null },
    sale_items:[{ name:'Cartier A', ref_code:'CT1', sell_price:'900', buy_price:'400', qty:2 },
                { name:'Shipping', ref_code:null, sell_price:'20', buy_price:null, qty:1 }] },
  { id:'s2', created_at:'2026-08-20T10:00:00Z', status:'unpaid', invoice_number:'VP08-009',
    clients:{ display_name:'Rojne', admin_label:null },
    sale_items:[{ name:'Cartier B', ref_code:'CT2', sell_price:'700', buy_price:'300', qty:1 }] },
  { id:'s3', created_at:'2026-08-22T10:00:00Z', status:'cancelled', invoice_number:'VP08-010',
    clients:{ display_name:'Rojne', admin_label:null },
    sale_items:[{ name:'Avbruten modell', ref_code:'CT9', sell_price:'5000', buy_price:'1000', qty:1 }] },
  { id:'s4', created_at:'2026-07-11T10:00:00Z', status:'delivered', invoice_number:'VP07-004',
    clients:{ display_name:'Samora', admin_label:null },
    sale_items:[{ name:'Woods', ref_code:'CT7', sell_price:'1400', buy_price:'900', qty:1 }] },
];
(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors=[]; page.on('pageerror', e=>errors.push(String(e)));
  for (const [u,b] of [['**/api/clients','{"clients":[]}'],['**/api/broadcasts**','{"broadcasts":[]}'],
    ['**/api/push/**','{}'],['**/api/inventory','{"items":[]}'],['**/api/lenses','{"lenses":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
  await page.route('**/api/sales**', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ sales: SALES }) }));

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    await page.click('#tab-historik'); await page.waitForTimeout(900);

    // sv-SE skiljer tusental med U+00A0, inte vanligt mellanslag
    const t = (await page.textContent('#app')).replace(/\u00a0/g, ' ');

    // Augusti: 900×2 + 20 + 700 = 2 520. Vinst: 500×2 + 400 = 1 400.
    // Med den avbrutna inräknad hade det blivit 7 520 / 5 400.
    checks.push(['augusti visar omsättning utan den avbrutna',
      /augusti 2026[\s\S]{0,160}€ 2 520,00/.test(t)]);
    checks.push(['augusti visar vinst utan den avbrutna',
      /augusti 2026[\s\S]{0,200}vinst € 1 400,00/.test(t)]);
    checks.push(['avbrutet belopp räknas inte in i månaden', !/€ 7 520,00|vinst € 5 400,00/.test(t)]);

    // Juli orörd: 1 400 / 500
    checks.push(['juli räknas som förut', /juli 2026[\s\S]{0,160}€ 1 400,00/.test(t)]);

    // Totalkorten: 2 520 + 1 400 = 3 920, vinst 1 400 + 500 = 1 900
    checks.push(['total omsättning utan den avbrutna',
      t.includes('Total omsättning') && t.includes('€ 3 920,00')]);
    checks.push(['total vinst utan den avbrutna',
      t.includes('Total vinst') && t.includes('€ 1 900,00')]);
    checks.push(['gamla totalen är borta', !/€ 8 920,00|€ 5 900,00/.test(t)]);

    // Den ska fortfarande gå att hitta och öppna — bara inte räknas
    checks.push(['den avbrutna syns kvar i listan', t.includes('Avbruten modell')]);
    checks.push(['den är märkt som avbruten', t.includes('Avbruten')]);
    checks.push(['inga JS-fel', errors.length===0]);
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/historik-avbrutna.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  if (errors.length) console.log(errors.slice(0,3));
  await browser.close(); process.exit(ok?0:1);
})();
