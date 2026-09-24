const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');

// "1t" rundades ner, så allt mellan 60 och 119 minuter såg likadant ut. Nu står
// både hur länge sedan och vilket klockslag det var.
const iso = minSedan => new Date(Date.now() - minSedan*60000).toISOString();
const CLIENTS = [
  { id:'c1', display_name:'Samora', admin_label:null, unread_count:0, is_online:false, last_seen_at: iso(119) },
  { id:'c2', display_name:'Callum', admin_label:null, unread_count:0, is_online:false, last_seen_at: iso(61) },
  { id:'c3', display_name:'Rojne',  admin_label:null, unread_count:0, is_online:true,  last_seen_at: iso(2) },
  { id:'c4', display_name:'Nadia',  admin_label:null, unread_count:0, is_online:false, last_seen_at: iso(60*26) },
  { id:'c5', display_name:'Ingen',  admin_label:null, unread_count:0, is_online:false, last_seen_at: null },
];

(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block',
    timezoneId:'Europe/Stockholm', locale:'sv-SE' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e).split('\n')[0]));
  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
    ['**/api/inventory','{"items":[]}'],['**/api/lenses','{"lenses":[]}'],['**/api/sales**','{"sales":[]}'],
    ['**/api/messages/**','{"messages":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
  await page.route('**/api/clients', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ clients: CLIENTS }) }));

  const row = n => page.evaluate(i => {
    const r = document.querySelectorAll('.client-row')[i];
    return { kort: r.querySelector('.last-seen-txt')?.textContent.trim() || '',
             exakt: r.querySelector('.last-seen-exact')?.textContent.trim() || null,
             title: r.querySelector('[title]')?.getAttribute('title') || null };
  }, n);

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    await page.click('#tab-clients');
    await page.waitForSelector('.client-row', { timeout: 15000 });
    await page.waitForTimeout(400);

    const r0 = await row(0), r1 = await row(1), r2 = await row(2), r3 = await row(3), r4 = await row(4);

    // Kärnan: 61 och 119 minuter får inte se likadana ut
    checks.push(['1t 59m visas med minuter', r0.kort === '1t 59m']);
    checks.push(['1t 1m visas med minuter', r1.kort === '1t 1m']);
    checks.push(['de går att skilja åt', r0.kort !== r1.kort]);

    checks.push(['klockslaget står under', /^\d{2}:\d{2}$/.test(r0.exakt || '')]);
    checks.push(['och skiljer sig mellan klienterna', r0.exakt !== r1.exakt]);
    checks.push(['hela tidpunkten finns att hålla på', /\d{2}:\d{2}/.test(r0.title || '')]);

    checks.push(['online visar Online', r2.kort === 'Online']);
    checks.push(['och inget klockslag', r2.exakt === null]);

    checks.push(['igår märks ut som igår', /^igår \d{2}:\d{2}$/.test(r3.exakt || '')]);
    checks.push(['och räknas i dagar', r3.kort === '1d']);

    checks.push(['aldrig inne ger tom text', r4.kort === '' && r4.exakt === null]);

    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/senast-lista.png' });

    // Chattens rubrik
    await page.click('.client-row');
    await page.waitForTimeout(700);
    const sub = (await page.textContent('#cp-sub')).trim();
    checks.push(['chatten visar klockslaget', /Senast \d{2}:\d{2}/.test(sub)]);
    checks.push(['och hur länge sedan', /· 1t 59m/.test(sub)]);
    // Rubriken bryter aldrig till två rader (nowrap), så höjden säger inget.
    // Bredden gör det: ryms texten inte kapas den med ... och då är klockslaget
    // det första som försvinner.
    checks.push(['rubriken kapas inte',
      (await page.evaluate(() => {
        const e = document.getElementById('cp-sub');
        return e.scrollWidth <= e.clientWidth + 1;
      }))]);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/senast-inne.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
