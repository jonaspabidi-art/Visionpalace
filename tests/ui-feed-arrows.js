const { chromium } = require(process.cwd()+'/node_modules/playwright-core');

// Bildremsan gick bara att svepa i sidled, och det var svårt att träffa rätt.
// Pilar, räknare och pilar i lightboxen — utan att lägga till en enda bild.
const img = (u, i) => ({ id:'m'+i, storage_url:`https://x/media/${u}.jpg`,
  thumbnail_url:`https://x/media/${u}_thumb.jpg`, type:'image' });

const BROADCASTS = [
  { id:'b1', created_at:'2026-08-10T10:00:00Z', text:'Fyra bilder', price:null, is_pinned:false,
    broadcast_reactions:[], broadcast_media:['a','b','c','d'].map(img) },
  { id:'b2', created_at:'2026-08-10T11:00:00Z', text:'En bild', price:null, is_pinned:false,
    broadcast_reactions:[], broadcast_media:[img('e',9)] },
];

(async () => {
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e).split('\n')[0]));

  await page.route('**/media/**', r => r.fulfill({ status:200, contentType:'image/png', body: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64') }));
  await page.route('**/api/messages/**', r => r.fulfill({ status:200, contentType:'application/json', body:'{"messages":[]}' }));
  await page.route('**/api/broadcasts', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ broadcasts: BROADCASTS }) }));
  await page.route('**/api/broadcasts/views', r => r.fulfill({ status:200, contentType:'application/json', body:'{}' }));
  await page.route('**/api/push/**', r => r.fulfill({ status:200, contentType:'application/json', body:'{}' }));

  const wrap = '.bc-strip-wrap';
  const count = () => page.textContent(`${wrap} .strip-count`);
  const shown = sel => page.evaluate(s => {
    const el = document.querySelector(s);
    return !!el && !el.hasAttribute('hidden');
  }, sel);
  const scrollLeft = () => page.$eval(`${wrap} .bc-media-strip`, e => Math.round(e.scrollLeft));

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(() => localStorage.setItem('vp_session', JSON.stringify({
      session_token:'t', client:{ id:'c1', display_name:'Samora' } })));
    await page.goto('http://localhost:5959/client');
    await page.waitForSelector('.bc-row', { timeout: 15000 });
    await page.waitForTimeout(900);

    // Bara inlägget med flera bilder får en remsa
    checks.push(['bara flerbildsinlägg får pilar',
      (await page.$$('.bc-strip-wrap')).length === 1]);
    checks.push(['räknaren börjar på 1', (await count()).trim() === '1/4']);
    checks.push(['ingen bakåtpil vid början', !(await shown(`${wrap} .strip-nav.prev`))]);
    checks.push(['framåtpilen syns', await shown(`${wrap} .strip-nav.next`)]);

    // Ett tryck framåt
    const x0 = await scrollLeft();
    await page.click(`${wrap} .strip-nav.next`);
    await page.waitForTimeout(700);
    const x1 = await scrollLeft();
    checks.push(['pilen flyttar remsan framåt', x1 > x0]);
    checks.push(['räknaren följer med', (await count()).trim() === '2/4']);
    checks.push(['bakåtpilen dyker upp', await shown(`${wrap} .strip-nav.prev`)]);

    // Tillbaka igen
    await page.click(`${wrap} .strip-nav.prev`);
    await page.waitForTimeout(700);
    checks.push(['bakåtpilen flyttar tillbaka', (await scrollLeft()) === x0]);
    checks.push(['räknaren tillbaka på 1', (await count()).trim() === '1/4']);

    // Hela vägen till slutet
    for (let i = 0; i < 3; i++) { await page.click(`${wrap} .strip-nav.next`); await page.waitForTimeout(650); }
    checks.push(['räknaren når sista bilden', (await count()).trim() === '4/4']);
    checks.push(['framåtpilen försvinner vid slutet', !(await shown(`${wrap} .strip-nav.next`))]);

    // Lightboxen: pilar och räknare, och den ska bläddra inom inlägget
    await page.click(`${wrap} .bc-media-strip img`);
    await page.waitForTimeout(500);
    checks.push(['lightboxen öppnas', await page.isVisible('#lightbox')]);
    const lbCount = await page.textContent('#lb-counter');
    checks.push(['lightboxen räknar bilderna', /\/\s*4/.test(lbCount)]);
    const first = await page.getAttribute('#lb-img', 'src');
    checks.push(['nästa-pilen syns i lightboxen', await shown('#lb-next')]);
    await page.click('#lb-next');
    await page.waitForTimeout(400);
    checks.push(['pilen byter bild', (await page.getAttribute('#lb-img','src')) !== first]);
    await page.click('#lb-prev');
    await page.waitForTimeout(400);
    checks.push(['och tillbaka igen', (await page.getAttribute('#lb-img','src')) === first]);
    checks.push(['ingen bakåtpil på första bilden', !(await shown('#lb-prev'))]);

    // Lightboxen visar originalet, inte miniatyren
    checks.push(['lightboxen visar originalet', !/_thumb/.test(await page.getAttribute('#lb-img','src'))]);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/feed-pilar.png' });

    // Admin-feeden har egen markup och egen css — samma pilar måste finnas där
    const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');
    const actx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
    const ap = await actx.newPage();
    const aerr=[]; ap.on('pageerror', e=>aerr.push(String(e).split('\n')[0]));
    await ap.route('**/media/**', r => r.fulfill({ status:200, contentType:'image/png', body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64') }));
    for (const [u,b] of [['**/api/clients','{"clients":[]}'],['**/api/inventory','{"items":[]}'],
      ['**/api/lenses','{"lenses":[]}'],['**/api/sales**','{"sales":[]}'],['**/api/push/**','{}']])
      await ap.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
    await ap.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
    await ap.route('**/api/broadcasts**', r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ broadcasts: BROADCASTS }) }));
    await ap.addInitScript(t => localStorage.setItem('vp_admin_token', t),
      jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro'));
    await ap.goto('http://localhost:5959/admin');
    await ap.waitForSelector('#app', { state:'visible' });
    await ap.waitForTimeout(1200);

    const aWrap = '.bc-strip-wrap';
    checks.push(['admin: flerbildsinlägg får pilar', (await ap.$$(aWrap)).length === 1]);
    checks.push(['admin: räknaren börjar på 1',
      (await ap.textContent(`${aWrap} .strip-count`)).trim() === '1/4']);
    const ax0 = await ap.$eval(`${aWrap} .bc-media-strip-admin`, e => Math.round(e.scrollLeft));
    await ap.click(`${aWrap} .strip-nav.next`);
    await ap.waitForTimeout(700);
    checks.push(['admin: pilen flyttar remsan',
      (await ap.$eval(`${aWrap} .bc-media-strip-admin`, e => Math.round(e.scrollLeft))) > ax0]);
    checks.push(['admin: räknaren följer med',
      (await ap.textContent(`${aWrap} .strip-count`)).trim() === '2/4']);
    checks.push(['admin: inga JS-fel', aerr.length===0]);
    if (aerr.length) console.log('   adminfel:', aerr.slice(0,3));
    await ap.screenshot({ path:(process.argv[2]||'/tmp')+'/feed-pilar-admin.png' });
    await actx.close();
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
