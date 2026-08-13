const { chromium } = require(process.cwd()+'/node_modules/playwright-core');

// Feeden laddade originalfilerna — obeskurna mobilbilder, flera per inlägg,
// alla avkodade samtidigt. Miniatyrerna har funnits sedan uppladdningen men
// användes bara i chatten. Testet håller fast att feeden tar miniatyren och
// lightboxen originalet.
const THUMB = u => `https://x/media/${u}_thumb.jpg`;
const FULL  = u => `https://x/media/${u}.jpg`;

const BROADCASTS = [
  // Flera bilder — remsan man scrollar i sidled
  { id:'b1', created_at:'2026-08-10T10:00:00Z', text:'Nya Cartier', price:'€ 2 400', is_pinned:false,
    broadcast_reactions:[], broadcast_media:[
      { id:'m1', storage_url:FULL('a'), thumbnail_url:THUMB('a'), type:'image' },
      { id:'m2', storage_url:FULL('b'), thumbnail_url:THUMB('b'), type:'image' },
      { id:'m3', storage_url:FULL('c'), thumbnail_url:THUMB('c'), type:'image' },
    ] },
  // En bild
  { id:'b2', created_at:'2026-08-10T11:00:00Z', text:'Ensam bild', price:null, is_pinned:false,
    broadcast_reactions:[], broadcast_media:[
      { id:'m4', storage_url:FULL('d'), thumbnail_url:THUMB('d'), type:'image' },
    ] },
  // Gammalt inlägg utan miniatyr — får inte bli trasig bild
  { id:'b3', created_at:'2026-08-10T12:00:00Z', text:'Utan miniatyr', price:null, is_pinned:false,
    broadcast_reactions:[], broadcast_media:[
      { id:'m5', storage_url:FULL('e'), thumbnail_url:null, type:'image' },
    ] },
];

(async () => {
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  // Klientappen registrerar en service worker, och page.route fångar inte det
  // som går genom den — då blir nätverkskontrollen nedan tyst och mäter noll.
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e)));

  // Vilka bild-URL:er webbläsaren faktiskt begär — det är det som avgör
  // om feeden är tung eller lätt
  const requested = [];
  await page.route('**/media/**', r => {
    requested.push(r.request().url());
    // 1×1 png, så inget riktigt nätverk behövs
    r.fulfill({ status:200, contentType:'image/png', body: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64') });
  });
  await page.route('**/api/messages/me/thread', r => r.fulfill({ status:200,
    contentType:'application/json', body:'{"messages":[]}' }));
  await page.route('**/api/broadcasts', r => r.fulfill({ status:200,
    contentType:'application/json', body: JSON.stringify({ broadcasts: BROADCASTS }) }));
  await page.route('**/api/broadcasts/views', r => r.fulfill({ status:200, contentType:'application/json', body:'{}' }));
  await page.route('**/api/push/**', r => r.fulfill({ status:200, contentType:'application/json', body:'{}' }));

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(() => localStorage.setItem('vp_session', JSON.stringify({
      session_token:'t', client:{ id:'c1', display_name:'Samora' } })));
    await page.goto('http://localhost:5959/client');
    await page.waitForSelector('.bc-row', { timeout: 15000 });
    // Lata bilder hämtas först när de syns. Utan att gå igenom hela feeden
    // och varje sidledsremsa mäter nätverkskontrollen nedan bara det som
    // råkade ligga i vy — och då säger den ingenting.
    await page.evaluate(async () => {
      const s = document.getElementById('feed-scroll');
      for (let y = 0; y <= s.scrollHeight; y += Math.floor(s.clientHeight / 2)) {
        s.scrollTop = y;
        await new Promise(r => setTimeout(r, 120));
      }
      for (const strip of document.querySelectorAll('.bc-media-strip')) {
        for (let x = 0; x <= strip.scrollWidth; x += Math.floor(strip.clientWidth / 2)) {
          strip.scrollLeft = x;
          await new Promise(r => setTimeout(r, 120));
        }
      }
    });
    await page.waitForTimeout(1200);

    const imgs = await page.$$eval('#feed-scroll img', els => els.map(e => ({
      src: e.getAttribute('src'), full: e.dataset.full,
      lazy: e.getAttribute('loading'), decoding: e.getAttribute('decoding'),
    })));
    const feedImgs = imgs.filter(i => /\/media\//.test(i.src || ''));

    checks.push(['feeden renderar bilderna', feedImgs.length === 5]);
    checks.push(['alla bilder är lata', feedImgs.every(i => i.lazy === 'lazy')]);
    checks.push(['alla avkodas asynkront', feedImgs.every(i => i.decoding === 'async')]);

    // Bilderna med miniatyr ska visa miniatyren, inte originalet
    const withThumb = feedImgs.filter(i => /_thumb/.test(i.src));
    checks.push(['miniatyrerna används i feeden', withThumb.length === 4]);
    checks.push(['originalet ligger kvar för lightboxen',
      feedImgs.every(i => /\/media\//.test(i.full || '') && !/_thumb/.test(i.full))]);

    // Gamla inlägg utan miniatyr faller tillbaka på originalet
    const fallback = feedImgs.find(i => /media\/e\.jpg$/.test(i.src));
    checks.push(['inlägg utan miniatyr visas ändå', !!fallback]);

    // Det viktiga: inget original hämtas över nätet bara för att visa feeden
    const fullFetched = requested.filter(u => /\/media\//.test(u) && !/_thumb/.test(u) && !/\/e\.jpg$/.test(u));
    checks.push(['inga originalfiler laddas ned för feeden', fullFetched.length === 0]);
    console.log('   hämtat över nätet:', JSON.stringify(requested.map(u=>u.split('/').pop())));

    checks.push(['inga JS-fel', errors.length===0]);
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/feed-media.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  if (errors.length) console.log(errors.slice(0,3));
  await browser.close(); process.exit(ok?0:1);
})();
