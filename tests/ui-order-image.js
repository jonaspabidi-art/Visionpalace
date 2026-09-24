const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');
const path = require('path');
const fs = require('fs');

// När en faktura läses in kunde man bara sätta namn och pris. En helt ny vara
// hamnade därför i lagret utan bild, och bilden fick läggas till efteråt — en
// gång per vara. Nu går bilden att sätta direkt på raden.
//
// Det som måste hålla: förhandsvisningen syns direkt, url:en från
// uppladdningen följer med till importen, och en import kan inte gå iväg
// medan en bild fortfarande laddas upp (då hade bilden tappats tyst).
const PARSED = { currency:'EUR', eur_sek_rate:11.42, rows:[
  { ref_code:'NY1-01', qty:2, buy_price_eur:180, unit_original:180, currency_original:'EUR', suspicious_ref:false },
  { ref_code:'NY2-02', qty:1, buy_price_eur:220, unit_original:220, currency_original:'EUR', suspicious_ref:false },
]};

// En riktig liten JPEG, så att compressInvImage har något att rita av
const PIXEL = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'+
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'+
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

(async () => {
  const tmp = path.join(process.argv[2] || '/tmp', 'order-bild.jpg');
  fs.writeFileSync(tmp, PIXEL);

  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e).split('\n')[0]));

  let imported = null;
  let holdUpload = null;          // sätts för att frysa en uppladdning mitt i
  let uploads = 0;

  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
    ['**/api/clients','{"clients":[]}'],['**/api/lenses','{"lenses":[]}'],['**/api/sales**','{"sales":[]}'],
    ['**/api/inventory','{"items":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
  await page.route('**/api/orders/parse', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify(PARSED) }));
  await page.route('**/api/inventory/ref-lookup**', r => r.fulfill({ status:200, contentType:'application/json',
    body:'{"match":null}' }));      // båda raderna är nya varor
  await page.route('**/api/upload', async r => {
    uploads++;
    const n = uploads;
    if (holdUpload) await holdUpload;
    r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ files:[{ url:`https://x/bild${n}.jpg`, thumbUrl:`https://x/bild${n}_thumb.jpg` }] }) });
  });
  await page.route('**/api/orders/import', r => {
    imported = JSON.parse(r.request().postData() || '{}');
    r.fulfill({ status:200, contentType:'application/json', body:'{"created":3}' });
  });

  // Tryck på rutan som en användare gör; knappen öppnar filväljaren
  const pickImage = async i => {
    const chooser = page.waitForEvent('filechooser');
    await page.click(`#order-rows button[onclick="pickOrderImage(${i})"]`);
    (await chooser).setFiles(tmp);
  };

  const cellSrc = i => page.evaluate(n => {
    const b = document.querySelectorAll('#order-rows button[onclick^="pickOrderImage"]')[n];
    return b?.querySelector('img')?.src || null;
  }, i);

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    await page.evaluate(() => openOrderImport());
    await page.setInputFiles('#order-file', tmp);      // vilken fil som helst, svaret är hånat
    await page.waitForFunction(() => orderRows.length === 2, { timeout: 15000 });

    checks.push(['varje rad får en bildruta',
      (await page.$$('#order-rows button[onclick^="pickOrderImage"]')).length === 2]);
    checks.push(['ny vara utan bild säger till',
      (await page.textContent('#order-rows')).includes('Ingen bild')]);
    checks.push(['ingen bild är satt från början', (await cellSrc(0)) === null]);

    // Välj en bild på första raden
    await pickImage(0);
    await page.waitForFunction(() => !!orderRows[0].image, { timeout: 15000 });
    const src0 = await cellSrc(0);
    checks.push(['bilden visas i rutan', !!src0]);
    checks.push(['rutan visar den uppladdade bilden', /bild1/.test(src0)]);
    const rowText = i => page.evaluate(n =>
      document.querySelectorAll('#order-rows > div')[n].textContent, i);
    checks.push(['uppmaningen försvinner när bilden finns',
      !(await rowText(0)).includes('Ingen bild')]);
    checks.push(['men står kvar på raden utan bild', (await rowText(1)).includes('Ingen bild')]);
    checks.push(['den andra raden är orörd', (await cellSrc(1)) === null]);
    checks.push(['miniatyren sparas, inte originalet',
      (await page.evaluate(() => orderRows[0].image)) === 'https://x/bild1_thumb.jpg']);

    // Bilden ska följa med till importen. Namnen måste fyllas i först —
    // nya varor går inte att importera namnlösa.
    await page.evaluate(() => { updateOrderRow(0,'name','Nyhet A'); updateOrderRow(1,'name','Nyhet B'); });
    await page.click('#order-import-btn');
    await page.waitForFunction(() => true);
    await page.waitForTimeout(700);
    checks.push(['importen gick iväg', !!imported]);
    checks.push(['bilden följer med varan',
      imported?.items?.[0]?.image === 'https://x/bild1_thumb.jpg']);
    checks.push(['raden utan bild skickas utan bild', imported?.items?.[1]?.image === null]);
    checks.push(['båda raderna importeras', imported?.items?.length === 2]);

    // En import mitt under en uppladdning måste stoppas — annars tappas bilden
    imported = null;
    await page.evaluate(() => openOrderImport());
    await page.setInputFiles('#order-file', tmp);
    await page.waitForFunction(() => orderRows.length === 2, { timeout: 15000 });
    await page.evaluate(() => { updateOrderRow(0,'name','Nyhet A'); updateOrderRow(1,'name','Nyhet B'); });
    let release;
    holdUpload = new Promise(r => { release = r; });
    await pickImage(0);
    await page.waitForFunction(() => orderRows[0].uploading === true, { timeout: 15000 });
    checks.push(['rutan säger att bilden laddas upp',
      (await page.textContent('#order-rows')).includes('Laddar upp')]);
    checks.push(['förhandsvisningen syns innan uppladdningen är klar',
      /^blob:/.test(await cellSrc(0) || '')]);
    // Fakturan laddas upp innan importen, och den uppladdningen ligger också
    // och väntar här. Att `imported` är tom bevisar alltså ingenting — det är
    // toasten som är skyddets enda egna avtryck, så det är den vi mäter.
    await page.evaluate(() => {
      window.__t = []; const real = window.showToast;
      window.showToast = (m, t) => { window.__t.push(String(m)); return real(m, t); };
    });
    await page.click('#order-import-btn');
    await page.waitForTimeout(500);
    checks.push(['importen stoppas medan bilden laddas upp', imported === null]);
    checks.push(['och säger åt en att vänta',
      /vänta tills bilderna/i.test(await page.evaluate(() => window.__t.join(' | ')))]);
    release();
    await page.waitForFunction(() => orderRows[0].uploading === false, { timeout: 15000 });
    holdUpload = null;
    await page.click('#order-import-btn');
    await page.waitForTimeout(700);
    checks.push(['och går igenom när uppladdningen är klar', !!imported]);
    checks.push(['med bilden på plats', /bild\d+_thumb/.test(imported?.items?.[0]?.image || '')]);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/order-bild.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
