const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');

// Förut gick det bara att förbeställa ett par i taget, trots att servern redan
// tog emot en lista. Tre par till samma kund blev tre separata ordrar — tre
// notiser, tre leveransfönster och tre rader i kundens köphistorik.
(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e).split('\n')[0]));

  let posted = null, postCount = 0;
  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
    ['**/api/inventory','{"items":[]}'],['**/api/lenses','{"lenses":[]}'],['**/api/sales/**','{}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/clients', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ clients:[{ id:'c1', display_name:'Samora', admin_label:null, unread:0 }] }) }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
  // Känd modell för uppslaget
  await page.route('**/api/inventory/ref-lookup**', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ match:{ name:'Cartier Première', ref_code:'CT1', sell_price:2400, buy_price:1000, image:'https://x/a.jpg' } }) }));
  await page.route('**/api/sales', r => {
    if (r.request().method() === 'POST') {
      postCount++;
      posted = JSON.parse(r.request().postData() || '{}');
      return r.fulfill({ status:200, contentType:'application/json',
        body: JSON.stringify({ sale:{ id:'s-new' } }) });
    }
    r.fulfill({ status:200, contentType:'application/json', body:'{"sales":[]}' });
  });

  const rows = () => page.$$eval('#pre-lines .inv-line-item', els => els.length);
  const setRow = (i, field, val) => page.evaluate(([i, field, val]) => {
    const el = document.querySelectorAll('#pre-lines .inv-line-item')[i].querySelector(`[data-field="${field}"]`);
    el.value = val;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [i, field, val]);

  let uploads = 0;
  await page.route('**/api/upload', r => {
    uploads++;
    r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ files:[{ url:`https://x/n${uploads}.jpg`, thumbUrl:`https://x/n${uploads}_thumb.jpg` }] }) });
  });

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    await page.evaluate(() => openPreorderModal());
    await page.waitForTimeout(500);

    checks.push(['rutan öppnas med en rad', (await rows()) === 1]);
    checks.push(['sista raden går inte att ta bort',
      (await page.$$('#pre-lines .inv-line-remove')).length === 0]);

    await page.click('#pre-lines ~ .inv-add-row');
    await page.waitForTimeout(200);
    checks.push(['går att lägga till fler', (await rows()) === 2]);
    checks.push(['nu går rader att ta bort',
      (await page.$$('#pre-lines .inv-line-remove')).length === 2]);

    // Uppslaget ska fylla i rätt rad, inte den första
    await setRow(1, 'ref', 'CT1');
    await page.waitForTimeout(600);
    const filled = await page.evaluate(() => preLines.map(l => ({ name:l.name, sell:l.sell })));
    checks.push(['uppslaget fyller i raden man skrev i', filled[1].name === 'Cartier Première']);
    checks.push(['och rör inte den andra raden', !filled[0].name]);

    await setRow(0, 'name', 'Cartier Santos');
    await setRow(0, 'qty', '2');
    await setRow(0, 'sell', '1500');
    await setRow(0, 'buy', '900');
    await setRow(1, 'qty', '1');
    await page.waitForTimeout(250);
    checks.push(['summan räknar alla rader',
      (await page.textContent('#pre-total')).replace(/ /g,' ').includes('3 par · totalt € 5 400,00')]);

    // En ofullständig rad ska stoppas och pekas ut
    await page.click('#pre-lines ~ .inv-add-row');
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.getElementById('pre-client-pick').value = 'c1'; onPreBuyerChange(); });
    // Toasten skapas som en lös div utan id, så meddelandet fångas vid källan
    await page.evaluate(() => {
      window.__toasts = [];
      const real = window.showToast;
      window.showToast = (msg, type) => { window.__toasts.push(String(msg)); return real(msg, type); };
    });
    await page.evaluate(() => createPreorder());
    await page.waitForTimeout(500);
    const toast = (await page.evaluate(() => window.__toasts.join(' | '))) || '';
    checks.push(['ofullständig rad stoppar sparandet', postCount === 0]);
    checks.push(['och felet pekar ut vilken rad', /rad 3/.test(toast)]);

    // Ta bort den tomma raden och skapa på riktigt
    await page.click('#pre-lines .inv-line-item:nth-child(3) .inv-line-remove');
    await page.waitForTimeout(200);
    checks.push(['raden går att ta bort igen', (await rows()) === 2]);

    await page.evaluate(() => createPreorder());
    await page.waitForTimeout(700);
    checks.push(['en enda order skapas', postCount === 1]);
    checks.push(['båda varorna följer med', posted?.items?.length === 2]);
    checks.push(['antal per rad följer med',
      posted?.items?.[0]?.qty === 2 && posted?.items?.[1]?.qty === 1]);
    checks.push(['priserna följer med',
      posted?.items?.[0]?.sell_price === 1500 && posted?.items?.[0]?.buy_price === 900]);
    checks.push(['referenskoden normaliseras', posted?.items?.[1]?.ref_code === 'CT1']);
    checks.push(['bilden från uppslaget följer med', !!posted?.items?.[1]?.image]);
    checks.push(['ordern är märkt som förbeställning', posted?.is_preorder === true]);
    checks.push(['leveransfönstret skickas en gång för hela ordern',
      posted?.eta_weeks_min === 1 && posted?.eta_weeks_max === 6]);

    // En modell som aldrig sålts förut har ingen bild i uppslaget. Utan en egen
    // bildväljare gick förbeställningen iväg helt utan bild.
    const fs = require('fs'); const path = require('path');
    const tmpImg = path.join(process.argv[2] || '/tmp', 'ny-modell.jpg');
    fs.writeFileSync(tmpImg, Buffer.from(
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'+
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'+
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'));
    // Rutan stängdes när ordern skapades — öppna en ny med en tom rad
    await page.evaluate(() => openPreorderModal());
    await page.waitForSelector('#pre-lines .inv-line-item');
    await page.waitForTimeout(300);
    const preImg = '#pre-lines .inv-line-item:first-child [data-role="img-pick"]';
    checks.push(['raden har en bildruta', !!(await page.$(preImg))]);
    const ch = page.waitForEvent('filechooser');
    await page.click(preImg);
    (await ch).setFiles(tmpImg);
    await page.waitForFunction(() => !!preLines[0].image, { timeout: 15000 });
    checks.push(['bilden hamnar på raden',
      (await page.evaluate(() => preLines[0].image)).includes('_thumb')]);
    checks.push(['och visas i rutan', !!(await page.$(preImg + ' img'))]);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
