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

    // Förhandsvisningen får aldrig röras. Förut togs nedskalningen bort så
    // att dokumentet ritades i full storlek — det syntes på skärmen, och
    // eftersom tråden samtidigt låstes såg det ut som att appen frös
    // inzoomad.
    await page.evaluate(() => {
      window.__duringRender = null;
      window.html2pdf = () => ({
        set(o){ window.__saved = o; return this; },
        from(el){ window.__renderedId = el.id; window.__renderedOffscreen =
          el.getBoundingClientRect().right < 0; return this; },
        toCanvas(){ return this; },
        get(what){
          window.__outputKind = what;
          const i = document.getElementById('inv-doc-inner');
          window.__duringRender = { transform: i.style.transform,
            right: Math.round(i.getBoundingClientRect().right), vw: window.innerWidth };
          const c = document.createElement('canvas');
          c.width = 1191; c.height = 1685;
          return new Promise(r => setTimeout(() => r(c), 400));
        },
        outputPdf(){ window.__usedOutputPdf = true; return new Promise(() => {}); },
        save(){ window.__usedSave = true; return new Promise(() => {}); } });
      // jsPDF finns i html2pdf-paketet; här räcker en attrapp
      window.jspdf = { jsPDF: class {
        constructor(){ this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } }; }
        addImage(){ window.__addedImage = true; }
        output(){ return new Blob(['%PDF-1.4 stub'], { type: 'application/pdf' }); }
      } };
    });
    await page.evaluate(() => { window.__shared = null;
      navigator.share = f => { window.__shared = f; return Promise.resolve(); };
      navigator.canShare = () => true; });
    await page.click('.inv-save-btn');
    await page.waitForTimeout(1800);
    const render = await page.evaluate(() => ({
      during: window.__duringRender, offscreen: window.__renderedOffscreen,
      opt: window.__saved,
      after: document.getElementById('inv-doc-inner').style.transform,
      holders: document.querySelectorAll('body > div[style*="-10000px"]').length,
      outputKind: window.__outputKind, usedSave: window.__usedSave === true,
      addedImage: window.__addedImage === true,
      renderWidth: window.__saved?.html2canvas?.width,
      btn: document.querySelector('.inv-save-btn').textContent.trim(),
      btnOff: document.querySelector('.inv-save-btn').disabled,
    }));
    checks.push(['förhandsvisningen är fortfarande nedskalad under renderingen',
      /scale\(/.test(render.during?.transform || '')]);
    checks.push(['den hoppar aldrig utanför skärmen',
      render.during && render.during.right <= render.during.vw]);
    checks.push(['det som ritas av ligger utanför synfältet', render.offscreen === true]);
    checks.push(['nedskalningen är orörd efteråt', /scale\(/.test(render.after)]);
    checks.push(['kopian städas bort', render.holders === 0]);
    checks.push(['A4 stående begärs',
      render.opt?.jsPDF?.format === 'a4' && render.opt?.jsPDF?.orientation === 'portrait']);
    checks.push(['telefonen renderar i lägre skala', render.opt?.html2canvas?.scale === 1.5]);
    // Utan fast bredd mäter html2canvas mot telefonens 390 px i stället för
    // dokumentets 794
    checks.push(['avritningen mäts mot dokumentets bredd, inte telefonens',
      render.opt?.html2canvas?.width === 794 && render.opt?.html2canvas?.windowWidth === 794]);
    checks.push(['filnamnet bär fakturanumret', /^invoice-/.test(render.opt?.filename || '')]);
    // .save() lämnar över till webbläsarens nedladdning, som blockeras i en
    // installerad iOS-PWA och aldrig blir klar. Filen ska hämtas ut som blob
    // och gå genom delningsmenyn, precis som bokföringsexporten.
    checks.push(['bilden hämtas ut som canvas', render.outputKind === 'canvas']);
    checks.push(['filen byggs här, inte av html2pdf', render.addedImage === true]);
    checks.push(['webbläsarens nedladdning används aldrig', render.usedSave === false]);
    checks.push(['knappen släpps när PDF:en är klar',
      render.btn === 'Spara PDF' && render.btnOff === false]);

    // Vakthunden: hänger ett steg ska knappen ändå släppas och felet säga
    // vilket steg det var. Utan den står den kvar för evigt — precis det som
    // rapporterades fyra gånger i rad.
    const hung = await page.evaluate(async () => {
      window.html2pdf = () => ({ set(){ return this; }, from(){ return this; },
        toCanvas(){ return this; }, get(){ return new Promise(() => {}); } });   // blir aldrig klar
      const btn = document.querySelector('.inv-save-btn');
      btn.click();
      await new Promise(r => setTimeout(r, 1500));
      const mid = { label: btn.textContent.trim(), disabled: btn.disabled };
      return mid;
    });
    checks.push(['ett hängande steg syns i knappen', /ritar av|packar bild|bygger fil/.test(hung.label)]);

    // ── Nedskalningen får inte kunna fastna i full storlek ──
    // Mättes bredden vid fel tillfälle (iOS: tangentbordet på väg ner när man
    // trycker Generera) stod dokumentet kvar oskalat och rubriken hamnade
    // utanför skärmen. Här härmas det genom att ytan görs obefintlig i det
    // ögonblick mätningen sker, och sedan återställs.
    await form(page); await page.evaluate(() => generateInvoice());
    await page.waitForTimeout(500);
    const good = await page.evaluate(() => document.getElementById('inv-doc-inner').style.transform);
    checks.push(['normalfallet är nedskalat', /scale\(/.test(good)]);

    const recovered = await page.evaluate(async () => {
      const wrap = document.getElementById('inv-doc');
      const inner = document.getElementById('inv-doc-inner');
      // Bredden försvinner och mätningen görs mitt i — precis det fall som
      // förut lämnade dokumentet i full storlek
      wrap.style.width = '0px';
      scaleInvDoc();
      const brokenState = inner.style.transform;
      wrap.style.width = '';
      // Observern ska räkna om av sig själv, utan att något anropar den
      await new Promise(r => setTimeout(r, 600));
      return { brokenState, after: inner.style.transform };
    });
    checks.push(['nedskalningen återhämtar sig av sig själv', /scale\(/.test(recovered.after)]);

    // Skyddsnätet: även ett oskalat dokument får inte huggas av
    const netting = await page.evaluate(() => {
      const wrap = document.getElementById('inv-doc');
      const cs = getComputedStyle(wrap);
      return { maxWidth: cs.maxWidth, overflowX: cs.overflowX };
    });
    checks.push(['förhandsvisningen kan scrollas i sidled om allt annat felar',
      netting.overflowX === 'auto']);

    checks.push(['inga JS-fel', errors.length===0]);
    if (errors.length) console.log('   fel:', errors.slice(0,3));
    await page.screenshot({ path:(process.argv[2]||'/tmp')+'/faktura.png' });
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
