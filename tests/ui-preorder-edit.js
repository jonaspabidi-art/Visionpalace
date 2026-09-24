const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');

// En förbeställning rör aldrig lagret — varan finns inte hemma än. Därför måste
// man kunna skriva in en vara för hand när ordern ändras. På en vanlig order
// vore det att sälja något man inte har, så knappen finns bara på förbeställningar.
const SALES = [
  { id:'p1', created_at:'2026-09-05T10:00:00Z', status:'unpaid', invoice_number:'VP09-010',
    is_preorder:true, client_id:'c1', clients:{ display_name:'Samora', admin_label:null },
    sale_items:[{ id:'i1', name:'Cartier Première', ref_code:'CT1', sell_price:'1200', buy_price:'800', qty:1 }] },
  { id:'s1', created_at:'2026-09-06T10:00:00Z', status:'unpaid', invoice_number:'VP09-011',
    is_preorder:false, client_id:'c1', clients:{ display_name:'Samora', admin_label:null },
    sale_items:[{ id:'i2', name:'Woods', ref_code:'CT7', sell_price:'1400', buy_price:'900', qty:1 }] },
];

(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e).split('\n')[0]));

  let patched = null;
  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
    ['**/api/lenses','{"lenses":[]}'],['**/api/inventory','{"items":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/clients', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ clients:[{ id:'c1', display_name:'Samora', admin_label:null, unread:0 }] }) }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
  await page.route('**/api/inventory/ref-lookup**', r => {
    const code = new URL(r.request().url()).searchParams.get('code');
    r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(
      code === 'CT-2841'
        ? { match:{ name:'Santos de Cartier', sell_price:1500, buy_price:950, image:'https://x/s.jpg' } }
        : { match:null }) });
  });
  await page.route('**/api/sales**', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ sales: SALES }) }));
  await page.route('**/api/sales/*/items', r => {
    patched = JSON.parse(r.request().postData() || '{}');
    r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true,"restored":0,"taken":0}' });
  });

  const lines = () => page.$$eval('#edit-lines .inv-line-item', els => els.length);
  const btnShown = () => page.evaluate(() =>
    document.getElementById('edit-add-preorder-btn').style.display !== 'none');
  const field = (n, f) => `#edit-lines .inv-line-item:nth-child(${n}) [data-field="${f}"]`;
  const setField = async (n, f, v) => {
    await page.fill(field(n, f), v);
    await page.dispatchEvent(field(n, f), 'change');
    await page.waitForTimeout(350);
  };

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    await page.click('#tab-historik'); await page.waitForTimeout(900);

    // Vanlig order: ingen handpåläggning
    await page.evaluate(() => openEditSale('s1'));
    await page.waitForTimeout(700);
    checks.push(['vanlig order får ingen knapp för förbeställd vara', (await btnShown()) === false]);
    await page.evaluate(() => closeEditSale());
    await page.waitForTimeout(200);

    // Förbeställning: knappen finns
    await page.evaluate(() => openEditSale('p1'));
    await page.waitForTimeout(700);
    checks.push(['förbeställning får knappen', await btnShown()]);
    checks.push(['ordern börjar med sin enda rad', (await lines()) === 1]);

    await page.click('#edit-add-preorder-btn');
    await page.waitForTimeout(300);
    checks.push(['en tom rad läggs till', (await lines()) === 2]);
    checks.push(['raden har fält för namn', !!(await page.$(field(2, 'name')))]);
    checks.push(['och för referenskod', !!(await page.$(field(2, 'ref_code')))]);
    checks.push(['och för inköpspris', !!(await page.$(field(2, 'buy')))]);
    checks.push(['den befintliga raden har inga sådana fält',
      (await page.$(field(1, 'name'))) === null]);

    // Okänd ref: inget fylls i, men man får veta det
    await setField(2, 'ref_code', 'HELT-NY');
    checks.push(['okänd ref säger att den är ny',
      (await page.textContent('#edit-lines')).includes('Ny modell')]);
    checks.push(['och fyller inte i något namn', (await page.inputValue(field(2, 'name'))) === '']);

    // Känd ref: namn och priser hämtas
    await setField(2, 'ref_code', 'CT-2841');
    checks.push(['känd ref hämtar namnet',
      (await page.inputValue(field(2, 'name'))) === 'Santos de Cartier']);
    checks.push(['och säljpriset', (await page.inputValue(field(2, 'sell'))) === '1500']);
    checks.push(['och inköpspriset', (await page.inputValue(field(2, 'buy'))) === '950']);
    checks.push(['summan räknar med den nya raden',
      (await page.textContent('#edit-total')).replace(/ /g, ' ').includes('€ 2 700,00 · vinst € 950,00')]);

    // Namnlös rad ska stoppas
    await page.click('#edit-add-preorder-btn');
    await page.waitForTimeout(300);
    await setField(3, 'sell', '500');
    await page.evaluate(() => { window.__t = []; const real = window.showToast;
      window.showToast = (m, t) => { window.__t.push(String(m)); return real(m, t); }; });
    await page.click('#edit-save-btn');
    await page.waitForTimeout(400);
    checks.push(['rad utan namn sparas inte', patched === null]);
    checks.push(['och säger varför',
      /skriv namn/i.test(await page.evaluate(() => window.__t.join(' | ')))]);

    await page.click('#edit-lines .inv-line-item:nth-child(3) .inv-line-remove');
    await page.waitForTimeout(300);
    await page.click('#edit-save-btn');
    await page.waitForTimeout(700);

    checks.push(['ändringen går igenom', !!patched]);
    checks.push(['båda raderna skickas', patched?.items?.length === 2]);
    const ny = patched?.items?.[1];
    checks.push(['den nya raden bär namnet', ny?.name === 'Santos de Cartier']);
    checks.push(['ref-koden normaliseras', ny?.ref_code === 'CT-2841']);
    checks.push(['priserna följer med', ny?.sell_price === 1500 && ny?.buy_price === 950]);
    checks.push(['den tar inget ur lagret', ny?.inventory_ids === undefined]);
    checks.push(['den befintliga raden behåller sitt id', patched?.items?.[0]?.id === 'i1']);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/forbest-andra.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
