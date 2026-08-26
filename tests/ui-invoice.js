const { chromium } = require(process.cwd()+'/node_modules/playwright-core');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');

// Fakturan kunde bara ställas ut i den valuta språket råkade betyda, och det
// fanns ingen plats för en anteckning. Valutan är nu fristående — och en
// faktura skapad från ett sälj måste tvingas till euro, för säljen är
// prissatta i euro.
const SALES = [{
  id:'s1', created_at:'2026-08-05T10:00:00Z', status:'paid', invoice_number:'VP08-001',
  client_id:'c1', clients:{ display_name:'Samora', admin_label:null },
  sale_items:[{ name:'Cartier Première', ref_code:'CT1', sell_price:'2400', buy_price:'1000', qty:1 }],
}];

const doc = page => page.textContent('#inv-doc');
// generateInvoice() byter till förhandsvisningen och döljer formuläret, så
// varje klick i formuläret måste föregås av en växling tillbaka.
const form = page => page.click('#inv-tab-form');

(async () => {
  const token = jwt.sign({ role:'admin', adminId:'a1' }, 'test-secret-for-invoice-repro');
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(String(e).split('\n')[0]));
  for (const [u,b] of [['**/api/broadcasts**','{"broadcasts":[]}'],['**/api/push/**','{}'],
    ['**/api/inventory','{"items":[]}'],['**/api/lenses','{"lenses":[]}']])
    await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));
  await page.route('**/api/clients', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ clients:[{ id:'c1', display_name:'Samora', admin_label:null, unread:0 }] }) }));
  await page.route('**/api/settlement', r => r.fulfill({ status:503, contentType:'application/json', body:'{"not_configured":true}' }));
  await page.route('**/api/sales**', r => r.fulfill({ status:200, contentType:'application/json',
    body: JSON.stringify({ sales: SALES }) }));

  const checks=[]; let crash=null;
  try {
    await page.addInitScript(t => localStorage.setItem('vp_admin_token', t), token);
    await page.goto('http://localhost:5959/admin');
    await page.waitForSelector('#app',{state:'visible'});
    await page.click('#tab-invoice'); await page.waitForTimeout(600);

    // En rad att räkna på
    await page.evaluate(() => {
      invLineItems = []; invLineNextId = 0;
      addInvLine('Cartier Première (CT1)', '2', '1000', '0');
      renderInvLines();
    });

    // ── Valuta ──
    checks.push(['euro är förvalt', (await page.evaluate(() => document.getElementById('inv-btn-cur-EUR')?.classList.contains('active')))]);
    await page.evaluate(() => generateInvoice());
    await page.waitForTimeout(400);
    let t = (await doc(page)).replace(/ /g,' ');
    checks.push(['euro visas på fakturan', t.includes('€ 2 000,00')]);
    checks.push(['euro ger IBAN', t.includes('IBAN') && t.includes('BIC')]);

    await form(page); await page.click('#inv-btn-cur-SEK');
    await page.evaluate(() => generateInvoice());
    await page.waitForTimeout(400);
    t = (await doc(page)).replace(/ /g,' ');
    checks.push(['kronor visas på fakturan', t.includes('2 000,00 kr')]);
    checks.push(['ingen eurosymbol kvar', !t.includes('€')]);
    // Betalning i kronor sker inrikes — då är clearing och konto det som gäller
    checks.push(['kronor ger clearing och konto',
      /Clearing/i.test(t) && /Kontonummer/i.test(t) && !t.includes('IBAN')]);

    await form(page); await page.click('#inv-btn-cur-USD');
    await page.evaluate(() => generateInvoice());
    await page.waitForTimeout(400);
    t = (await doc(page)).replace(/ /g,' ');
    checks.push(['dollar visas på fakturan', t.includes('$ 2 000,00')]);
    checks.push(['dollar ger IBAN', t.includes('IBAN')]);

    // Valutan ska vara oberoende av språket
    await form(page); await page.click('#inv-btn-lang-sv');
    await page.evaluate(() => generateInvoice());
    await page.waitForTimeout(400);
    t = (await doc(page)).replace(/ /g,' ');
    const squash = x => x.replace(/[\s\u00a0]/g, '');
    checks.push(['svensk faktura kan stå i dollar',
      squash(t).includes('FAKTURA') && t.includes('$ 2 000,00')]);
    await form(page); await page.click('#inv-btn-lang-en'); await form(page); await page.click('#inv-btn-cur-EUR');

    // Prisetiketten på raderna följer valutan
    await form(page); await page.click('#inv-btn-cur-SEK'); await page.waitForTimeout(200);
    checks.push(['radetiketten följer valutan',
      (await page.textContent('#inv-line-items')).includes('Pris (kr)')]);
    await form(page); await page.click('#inv-btn-cur-EUR'); await page.waitForTimeout(200);
    checks.push(['och tillbaka till euro',
      (await page.textContent('#inv-line-items')).includes('Pris (€)')]);

    // ── Anteckningar ──
    await page.evaluate(() => generateInvoice());
    await page.waitForTimeout(300);
    checks.push(['ingen anteckningsruta när fältet är tomt',
      !(await doc(page)).includes('Notes')]);

    await form(page); await page.fill('#inv-notes', 'Levereras vecka 34.\nHalva beloppet betalt kontant.');
    await page.evaluate(() => generateInvoice());
    await page.waitForTimeout(400);
    t = await doc(page);
    checks.push(['anteckningen hamnar på fakturan', t.includes('Levereras vecka 34.')]);
    checks.push(['flera rader följer med', t.includes('Halva beloppet betalt kontant.')]);
    checks.push(['rubriken står på engelska', t.includes('Notes')]);
    await form(page); await page.click('#inv-btn-lang-sv');
    await page.evaluate(() => generateInvoice());
    await page.waitForTimeout(400);
    checks.push(['och på svenska när fakturan är svensk',
      (await doc(page)).includes('Anteckningar')]);
    await form(page); await page.click('#inv-btn-lang-en');

    // ── Faktura från ett sälj ──
    // Säljen är i euro. Står valutan kvar på kronor går fel belopp ut.
    await form(page); await page.click('#inv-btn-cur-SEK'); await page.waitForTimeout(200);
    await page.click('#tab-historik'); await page.waitForTimeout(900);
    await page.click('.bc-msg-row, [onclick*="openSaleInvoice"]').catch(()=>{});
    await page.evaluate(() => {
      const sale = Object.values(_saleHistoryCache)[0];
      openSaleInvoice(sale.id);
    });
    await page.waitForTimeout(900);
    checks.push(['sälj tvingar tillbaka valutan till euro', (await page.evaluate(() => document.getElementById('inv-btn-cur-EUR')?.classList.contains('active')))]);
    t = (await doc(page)).replace(/ /g,' ');
    checks.push(['beloppet står i euro', t.includes('€ 2 400,00')]);
    checks.push(['förra fakturans anteckning följer inte med',
      !t.includes('Levereras vecka 34')]);
    checks.push(['anteckningsfältet är tömt',
      (await form(page), await page.inputValue('#inv-notes')) === '']);

    // ── Spara PDF ──
    // html2pdf hämtas från cdnjs, som inte går att nå härifrån. Det som testas
    // är vår egen kedja: låst knapp under tiden, och att förhandsvisningen
    // återställs även när det går fel.
    await form(page); await page.click('#inv-btn-cur-EUR');
    await page.evaluate(() => generateInvoice());
    await page.waitForTimeout(400);
    const beforeSave = await page.evaluate(() => ({
      transform: document.getElementById('inv-doc-inner').style.transform,
      outerHeight: document.getElementById('inv-scale-outer').style.height,
    }));
    checks.push(['förhandsvisningen är nedskalad', /scale\(/.test(beforeSave.transform)]);

    // Biblioteket som kraschar mitt i renderingen
    await page.evaluate(() => {
      window.html2pdf = () => ({ set(){ return this; }, from(){ return this; },
        save(){ return Promise.reject(new Error('avbrutet')); } });
    });
    await page.click('.inv-save-btn');
    await page.waitForTimeout(1200);
    const afterFail = await page.evaluate(() => ({
      transform: document.getElementById('inv-doc-inner').style.transform,
      outerHeight: document.getElementById('inv-scale-outer').style.height,
      label: document.querySelector('.inv-save-btn').textContent.trim(),
      disabled: document.querySelector('.inv-save-btn').disabled,
    }));
    checks.push(['nedskalningen återställs efter ett misslyckat försök',
      afterFail.transform === beforeSave.transform && afterFail.outerHeight === beforeSave.outerHeight]);
    checks.push(['knappen går att trycka på igen', afterFail.disabled === false]);
    checks.push(['knappens text återställs', afterFail.label === 'Spara PDF']);

    // Lyckad rendering: knappen ska vara låst medan det pågår
    await page.evaluate(() => {
      window.__saved = null;
      window.html2pdf = () => ({ set(o){ window.__saved = o; return this; }, from(){ return this; },
        save(){ return new Promise(r => setTimeout(r, 900)); } });
    });
    await page.click('.inv-save-btn');
    await page.waitForTimeout(300);
    const during = await page.evaluate(() => ({
      label: document.querySelector('.inv-save-btn').textContent.trim(),
      disabled: document.querySelector('.inv-save-btn').disabled,
    }));
    checks.push(['knappen låses medan PDF:en skapas', during.disabled === true]);
    checks.push(['och säger vad som händer', during.label === 'Skapar PDF…']);
    await page.waitForTimeout(1200);
    const opt = await page.evaluate(() => window.__saved);
    checks.push(['A4 stående begärs', opt?.jsPDF?.format === 'a4' && opt?.jsPDF?.orientation === 'portrait']);
    checks.push(['filnamnet bär fakturanumret', /^invoice-/.test(opt?.filename || '')]);
    const after = await page.evaluate(() => document.getElementById('inv-doc-inner').style.transform);
    checks.push(['nedskalningen återställs efter ett lyckat försök', after === beforeSave.transform]);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/faktura.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
