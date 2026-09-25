const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');

// Redigering av en order i Historik. Det viktiga är att knappen bara finns på
// obetalda ordrar, att nya par tar med sig VILKA lagerrader de plockat, och
// att rabatten skickas negativt med inköpspris 0 — annars sänker den
// omsättningen men inte vinsten.
const SALES = [
  { id:'s1', created_at:'2026-09-05T10:00:00Z', status:'unpaid', invoice_number:'VP09-001',
    client_id:'c1', clients:{ display_name:'Samora', admin_label:null },
    sale_items:[
      { id:'i1', name:'Cartier Première', ref_code:'CT1', sell_price:'1200', buy_price:'800', qty:2 },
      { id:'i2', name:'Shipping', ref_code:null, sell_price:'20', buy_price:null, qty:1 },
    ] },
  { id:'s2', created_at:'2026-09-06T10:00:00Z', status:'paid', invoice_number:'VP09-002',
    client_id:'c1', clients:{ display_name:'Samora', admin_label:null },
    sale_items:[{ id:'i3', name:'Woods', ref_code:'CT7', sell_price:'1400', buy_price:'900', qty:1 }] },
];
const INVENTORY = [
  { id:'inv9',  ref_code:'CT7', name:'Woods Grey', buy_price:900, sell_price:1400, image:null, added_at:'2026-09-01' },
  { id:'inv10', ref_code:'CT7', name:'Woods Grey', buy_price:900, sell_price:1400, image:null, added_at:'2026-09-01' },
];

(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e).split('\n')[0]));

  let patched = null;
  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
    ['**/api/lenses','{"lenses":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/clients', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ clients:[{ id:'c1', display_name:'Samora', admin_label:null, unread:0 }] }) }));
  let settlementCalls = 0;
  await page.route('**/api/settlement', r => {
    settlementCalls++;
    r.fulfill({ status:200, contentType:'application/json', body: JSON.stringify({
      configured:true, seller_name:'Rojne', commission_pct:70,
      earned: 86000, pending: 12000, balance: 86000, months:{}, entries:[], missing_buy_price:0 }) });
  });
  await page.route('**/api/inventory', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ items: INVENTORY }) }));
  await page.route('**/api/sales**', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ sales: SALES }) }));
  await page.route('**/api/sales/*/items', r => {
    patched = JSON.parse(r.request().postData() || '{}');
    r.fulfill({ status:200, contentType:'application/json', body:'{"ok":true,"restored":1}' });
  });

  const lines = () => page.$$eval('#edit-lines .inv-line-item', els => els.length);
  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    // Gå RAKT till Historik. Klickade testet in på Lager först laddades lagret
    // dit, och då dolde testet att rutan inte hämtar något själv — precis den
    // bugg som gjorde att inget gick att lägga till i skarpt läge.
    await page.click('#tab-historik'); await page.waitForTimeout(900);
    checks.push(['lagret är oläst när man går rakt till Historik',
      await page.evaluate(() => Object.keys(invGroups).length === 0)]);

    const html = await page.textContent('#app');
    checks.push(['obetald order får en Ändra-knapp', html.includes('Ändra')]);
    // Den betalda ordern får ingen knapp
    const btns = await page.$$eval('[onclick*="openEditSale"]', els =>
      els.map(e => e.getAttribute('onclick')));
    checks.push(['bara den obetalda ordern går att ändra',
      btns.length === 1 && btns[0].includes('s1')]);

    // Betald order ska avvisas även om man anropar direkt
    const refused = await page.evaluate(() => {
      window.__t = []; const real = window.showToast;
      window.showToast = (m, t) => { window.__t.push(String(m)); return real(m, t); };
      openEditSale('s2');
      return { open: document.getElementById('edit-sale-modal').classList.contains('open'),
        toasts: window.__t.join(' | ') };
    });
    checks.push(['betald order öppnas inte', refused.open === false]);
    checks.push(['och säger varför', /obetalda/i.test(refused.toasts)]);

    await page.evaluate(() => openEditSale('s1'));
    await page.waitForTimeout(400);
    checks.push(['rutan öppnas med orderns rader', (await lines()) === 2]);
    // Det här är kärnan: rutan måste hämta lagret själv, annars finns inget
    // att lägga till för den som inte varit inne på Lager-fliken först
    checks.push(['rutan hämtar lagret själv',
      (await page.$$('#edit-stock-list .inv-add-row')).length > 0]);
    checks.push(['rubriken visar fakturanumret',
      (await page.textContent('#edit-sale-title')).includes('VP09-001')]);
    checks.push(['summan visar omsättning och vinst',
      (await page.textContent('#edit-total')).replace(/\u00a0/g, ' ').includes('€ 2 420,00 · vinst € 800,00')]);

    // Antalet på en befintlig rad går att sänka men inte höja
    await page.evaluate(() => updateEditLine(0, 'qty', '5'));
    await page.waitForTimeout(200);
    checks.push(['antalet går inte att höja på en befintlig rad',
      (await page.evaluate(() => editLines[0].qty)) === 2]);
    await page.evaluate(() => updateEditLine(0, 'qty', '1'));
    await page.waitForTimeout(200);
    checks.push(['men går att sänka', (await page.evaluate(() => editLines[0].qty)) === 1]);

    // Lägg till ur lagret — raden ska bära med sig lagerradens id
    await page.click('#edit-stock-list .inv-add-row');
    await page.waitForTimeout(300);
    checks.push(['par ur lagret läggs till', (await lines()) === 3]);
    checks.push(['raden bär med sig vilket par den tagit',
      (await page.evaluate(() => editLines[2].inventory_ids))?.[0] === 'inv9']);
    await page.click('#edit-stock-list .inv-add-row');
    await page.waitForTimeout(300);
    checks.push(['fler par slås ihop till samma rad',
      (await lines()) === 3 && (await page.evaluate(() => editLines[2].qty)) === 2]);
    checks.push(['lagret tar slut när alla är valda',
      (await page.textContent('#edit-stock-list')).includes('Inget kvar')]);

    // Rabatt
    await page.click('button.inv-add-row:has-text("rabatt")');
    await page.waitForTimeout(250);
    await page.evaluate(() => updateEditLine(3, 'sell', '300'));
    await page.waitForTimeout(200);
    checks.push(['rabatten dras av i summan',
      (await page.textContent('#edit-total')).replace(/\u00a0/g, ' ').includes('€ 3 720,00')]);

    // Ta bort fraktraden
    await page.evaluate(() => removeEditLine(1));
    await page.waitForTimeout(250);
    checks.push(['rader går att ta bort', (await lines()) === 3]);

    await page.evaluate(() => saveEditSale());
    await page.waitForTimeout(600);
    checks.push(['ändringen skickas', !!patched]);
    checks.push(['alla rader följer med', patched?.items?.length === 3]);
    checks.push(['befintlig rad behåller sitt id', patched?.items?.[0]?.id === 'i1']);
    checks.push(['ny rad har inget id men bär lagerraderna',
      !patched?.items?.[1]?.id && patched?.items?.[1]?.inventory_ids?.length === 2]);
    const disc = patched?.items?.find(i => i.name === 'Discount');
    checks.push(['rabatten skickas negativt', disc?.sell_price === -300]);
    checks.push(['med inköpspris 0, så vinsten sänks', disc?.buy_price === 0]);
    checks.push(['återläggning till lagret begärs', patched?.restock === true]);

    // ── Rabatt på ett enskilt par ──
    // Den sparas som en egen minusrad döpt efter varan, så den syns på fakturan
    // och sänker vinsten — men i rutan är den ett fält på varans rad.
    patched = null;
    await page.evaluate(() => openEditSale('s1'));
    await page.waitForTimeout(600);
    const discField = '#edit-lines .inv-line-item:first-child [data-field="discount"]';
    checks.push(['varuraden har ett eget rabattfält', !!(await page.$(discField))]);
    checks.push(['fraktraden har inget rabattfält',
      (await page.$$('#edit-lines [data-field="discount"]')).length === 1]);

    await page.fill(discField, '300');
    await page.dispatchEvent(discField, 'change');
    await page.waitForTimeout(300);
    // Raden är 2 par à 1200. 300 i rabatt är 300 PER PAR, alltså 600 i avdrag:
    // raden blir 2400 − 600 = 1800, ordern 1800 + 20 = 1820, vinsten 800 − 600 = 200.
    const rad = async () => (await page.textContent('#edit-lines')).replace(/\u00a0/g, ' ');
    checks.push(['rutan räknar avdraget per par',
      (await rad()).includes('2 × € 300,00 = € 600,00')]);
    checks.push(['och visar vad raden blir', (await rad()).includes('raden blir € 1 800,00')]);
    checks.push(['summan sänks med hela avdraget',
      (await page.textContent('#edit-total')).replace(/\u00a0/g, ' ').includes('€ 1 820,00 · vinst € 200,00')]);

    // Större rabatt än raden ska stoppas
    await page.fill(discField, '9000');
    await page.dispatchEvent(discField, 'change');
    await page.evaluate(() => { window.__t = []; const real = window.showToast;
      window.showToast = (m, t) => { window.__t.push(String(m)); return real(m, t); }; });
    await page.click('#edit-save-btn');
    await page.waitForTimeout(400);
    checks.push(['för stor parrabatt sparas inte', patched === null]);
    checks.push(['och säger varför',
      /större än vad ett par kostar/i.test(await page.evaluate(() => window.__t.join(' | ')))]);

    await page.fill(discField, '300');
    await page.dispatchEvent(discField, 'change');
    await page.waitForTimeout(200);
    await page.click('#edit-save-btn');
    await page.waitForTimeout(600);
    const pd = patched?.items?.find(i => String(i.name).startsWith('Discount — '));
    checks.push(['parrabatten skickas som egen rad', !!pd]);
    checks.push(['döpt efter varan', pd?.name === 'Discount — Cartier Première']);
    checks.push(['med negativt belopp', pd?.sell_price === -300]);
    checks.push(['och inköpspris 0, så vinsten sänks', pd?.buy_price === 0]);
    checks.push(['den ligger direkt efter sin vara',
      patched?.items?.findIndex(i => i.name === 'Discount — Cartier Première') === 1]);
    checks.push(['varans eget pris är orört', patched?.items?.[0]?.sell_price === 1200]);

    // Öppnas ordern igen ska rabatten ligga i fältet, inte som en extra rad
    await page.evaluate(() => {
      _saleHistoryCache['s1'].sale_items = [
        { id:'i1', name:'Cartier Première', ref_code:'CT1', sell_price:'1200', buy_price:'800', qty:2 },
        { id:'i9', name:'Discount — Cartier Première', ref_code:'CT1', sell_price:'-300', buy_price:'0', qty:1 },
        { id:'i2', name:'Shipping', ref_code:null, sell_price:'20', buy_price:null, qty:1 },
      ];
      openEditSale('s1');
    });
    await page.waitForTimeout(600);
    checks.push(['rabatten blir inte en egen rad när ordern öppnas igen', (await lines()) === 2]);
    // Ordern är lagd före ändringen: rabatten ligger som EN rad på 300 för hela
    // varuraden. Den räknas om till avdrag per par — 300 på 2 par blir 150 per
    // par — och det avgörande är att TOTALEN inte rör sig en krona.
    checks.push(['gammalt belopp räknas om till per par',
      (await page.inputValue(discField)) === '150']);
    checks.push(['och totalen är oförändrad',
      (await page.textContent('#edit-total')).replace(/\u00a0/g, ' ').includes('€ 2 120,00 · vinst € 500,00')]);

    // Sparas den orörd ska beloppet vara exakt detsamma som innan
    patched = null;
    await page.click('#edit-save-btn');
    await page.waitForTimeout(700);
    const gammal = patched?.items?.find(i => i.name === 'Discount — Cartier Première');
    checks.push(['en orörd gammal rabatt sparas till samma totalbelopp',
      Math.abs((gammal?.sell_price || 0) * (gammal?.qty || 1) + 300) < 0.005]);

    // En parrabatt vars vara inte finns kvar i ordern. Den får inte försvinna
    // tyst, och den får inte heller stoppa sparandet genom att behandlas som
    // en vanlig vara utan säljpris.
    patched = null;
    await page.evaluate(() => {
      _saleHistoryCache['s1'].sale_items = [
        { id:'i1', name:'Cartier Première', ref_code:'CT1', sell_price:'1200', buy_price:'800', qty:2 },
        { id:'i8', name:'Discount — Borttagen vara', ref_code:'CT5', sell_price:'-100', buy_price:'0', qty:1 },
      ];
      openEditSale('s1');
    });
    await page.waitForTimeout(600);
    checks.push(['herrelös parrabatt står kvar som egen rad', (await lines()) === 2]);
    checks.push(['den räknas som avdrag i summan',
      (await page.textContent('#edit-total')).replace(/\u00a0/g, ' ').includes('€ 2 300,00 · vinst € 700,00')]);
    await page.click('#edit-save-btn');
    await page.waitForTimeout(600);
    checks.push(['och stoppar inte sparandet', !!patched]);
    checks.push(['den skickas fortfarande negativt',
      patched?.items?.find(i => i.name === 'Discount — Borttagen vara')?.sell_price === -100]);

    // Avräkningen räknas ur samma försäljningar som historiken. Ändrar man en
    // order ändras provisionen den ger — men siffran "kommer läggas på när de
    // betalas" laddades aldrig om, så den stod kvar på beloppet från innan.
    await page.evaluate(() => openEditSale('s1'));
    await page.waitForTimeout(600);
    const före = settlementCalls;
    patched = null;
    await page.click('#edit-save-btn');
    await page.waitForTimeout(900);
    checks.push(['ändringen sparas', !!patched]);
    checks.push(['avräkningen laddas om efter en ändring', settlementCalls > före]);

    // Fakturaknappen: en parrabatt hör till sin vara och blir ett avdrag PER
    // STYCK på den raden, så kunden ser vad ett par kostar efter rabatt.
    // Rabatten längst ner hör inte till någon vara och blir en egen rad.
    await page.evaluate(() => {
      _saleHistoryCache['s1'].sale_items = [
        { id:'i1', name:'Cartier Première', ref_code:'CT1', sell_price:'1200', buy_price:'800', qty:2 },
        { id:'i7', name:'Discount', ref_code:null, sell_price:'-250', buy_price:'0', qty:1 },
        { id:'i9', name:'Discount — Cartier Première', ref_code:'CT1', sell_price:'-100', buy_price:'0', qty:2 },
      ];
      openSaleInvoice('s1');
    });
    await page.waitForTimeout(900);
    const invRader = await page.evaluate(() =>
      invLineItems.map(l => ({ d: l.desc, p: l.price, r: l.discount })));
    const rabattRader = invRader.filter(r => /^Discount/.test(r.d));
    checks.push(['den generella rabatten blir en egen rad', rabattRader.length === 1]);
    checks.push(['med sitt belopp', parseFloat(rabattRader[0]?.p) === -250]);
    const varan = invRader.find(r => /Cartier Première/.test(r.d));
    checks.push(['varuraden är kvar', !!varan]);
    checks.push(['parrabatten ligger på varans rad, per styck', parseFloat(varan?.r) === 100]);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
