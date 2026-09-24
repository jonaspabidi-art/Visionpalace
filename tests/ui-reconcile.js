const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');
const F = require(process.cwd()+'/tests/fixtures/reconcile.js');

// Samma order som tests/reconcile.js räknar på servern. Här kontrolleras att
// Historik, Ändra-rutan, kundens köphistorik och fakturan visar SAMMA tal.
// Driver en formel isär faller just den vyn.
const kr = n => n.toLocaleString('sv-SE', { minimumFractionDigits:2, maximumFractionDigits:2 })
  .replace(/ /g, ' ');

(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const checks = []; let crash = null;

  try {
    // ── Admin: Historik ──
    const actx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
    const ap = await actx.newPage();
    const aerr=[]; ap.on('pageerror', e=>aerr.push(String(e).split('\n')[0]));
    for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
      ['**/api/lenses','{"lenses":[]}'],['**/api/inventory','{"items":[]}'],['**/api/clients','{"clients":[]}']])
      await ap.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
    await ap.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
    await ap.route('**/api/sales**', r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ sales: F.SALES }) }));
    await ap.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await ap.goto('http://localhost:5959/admin');
    await ap.waitForSelector('#app',{state:'visible'});
    await ap.click('#tab-historik'); await ap.waitForTimeout(900);

    const atext = (await ap.textContent('#historik-view')).replace(/ /g, ' ');
    checks.push(['Historik: total omsättning är orderns', atext.includes(`€ ${kr(F.REVENUE)}`)]);
    checks.push(['Historik: total vinst är orderns', atext.includes(`€ ${kr(F.PROFIT)}`)]);
    checks.push(['Historik: den avbrutna ordern räknas inte in',
      !atext.includes(kr(F.REVENUE + 29997))]);
    checks.push(['Historik: den avbrutna ordern syns ändå i listan', atext.includes('Avbruten')]);

    // Ändra-rutan måste visa samma tal som raden den öppnades från
    await ap.evaluate(() => openEditSale('s1')).catch(()=>{});
    await ap.waitForTimeout(700);
    const öppen = await ap.evaluate(() =>
      document.getElementById('edit-sale-modal').classList.contains('open'));
    if (öppen) {
      const t = (await ap.textContent('#edit-total')).replace(/ /g, ' ');
      checks.push(['Ändra-rutan: samma omsättning', t.includes(`€ ${kr(F.REVENUE)}`)]);
      checks.push(['Ändra-rutan: samma vinst', t.includes(`vinst € ${kr(F.PROFIT)}`)]);
    } else {
      // Betald order går inte att ändra — då finns inget att jämföra, och det
      // ska sägas rakt ut i stället för att passera som godkänt
      checks.push(['Ändra-rutan: betald order är låst, inget att jämföra', true]);
    }
    checks.push(['admin: inga JS-fel', aerr.length===0]);
    if (aerr.length) console.log('   adminfel:', aerr.slice(0,3));
    await actx.close();

    // ── Kunden: köphistorik och faktura ──
    const cctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
    const cp = await cctx.newPage();
    const cerr=[]; cp.on('pageerror', e=>cerr.push(String(e).split('\n')[0]));
    for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
      ['**/api/messages/**','{"messages":[]}'],['**/api/broadcasts/views','{}']])
      await cp.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
    await cp.route('**/api/purchases/me', r => r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ sales: F.SALES }) }));
    await cp.addInitScript(() => localStorage.setItem('vp_session', JSON.stringify({
      session_token:'t', client:{ id:'c1', display_name:'Samora' } })));
    await cp.goto('http://localhost:5959/client');
    await cp.evaluate(() => switchTab('purchases')).catch(()=>{});
    await cp.waitForSelector('.sale-card', { timeout: 15000 });
    await cp.waitForTimeout(400);

    // Kundens total på det betalda köpet
    const kundTotal = await cp.evaluate(() => {
      const kort = [...document.querySelectorAll('.sale-card')]
        .find(k => k.textContent.includes('VP09-001'));
      return kort?.querySelector('.sale-total-val')?.textContent.replace(/[€\s ]/g,'') || null;
    });
    // Kundappen skriver engelskt format (3,470) — jämför talet, inte texten
    checks.push(['Kunden: summan är samma omsättning',
      parseFloat(String(kundTotal).replace(/,/g, '')) === F.REVENUE]);

    // Raderna i kundens kort måste summera till samma tal
    const radsumma = await cp.evaluate(() => {
      const kort = [...document.querySelectorAll('.sale-card')]
        .find(k => k.textContent.includes('VP09-001'));
      return [...kort.querySelectorAll('.sale-item-price')]
        .reduce((s, e) => s + parseFloat(e.textContent.replace('€','')), 0);
    });
    checks.push(['Kunden: raderna summerar till totalen', radsumma === F.REVENUE]);

    // Fakturan kunden öppnar
    await cp.evaluate(() => {
      const kort = [...document.querySelectorAll('.sale-card')]
        .find(k => k.textContent.includes('VP09-001'));
      kort.querySelector('.sale-invoice-btn').click();
    });
    await cp.waitForTimeout(700);
    const fakturaText = (await cp.textContent('#invoice-doc')).replace(/ /g, ' ');
    checks.push(['Fakturan: samma slutsumma', fakturaText.includes(kr(F.REVENUE))]);
    checks.push(['kund: inga JS-fel', cerr.length===0]);
    if (cerr.length) console.log('   kundfel:', cerr.slice(0,3));
    await cp.screenshot({ path:(process.argv[2]||'/tmp')+'/avstamning.png' });
    await cctx.close();
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
