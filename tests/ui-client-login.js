const { chromium } = require(process.cwd()+'/node_modules/playwright-core');

// En kund fastnade på "Signing in…" i Facebooks inbyggda webbläsare. Två fel:
// lagringen där kastar i stället för att svara, vilket dödade appen redan vid
// start, och inloggningsknappen kunde aldrig återställas om anropet hängde.
const FB_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Mobile/21A329 [FBAN/FBIOS;FBAV/449.0.0.35.109]';

const BLOCK_STORAGE = () => {
  const boom = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { return { getItem: boom, setItem: boom, removeItem: boom, clear: boom }; },
  });
};

async function session(browser, { blockStorage = false, ua = null, loginReply = 'ok' } = {}) {
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 },
    serviceWorkers:'block', ...(ua ? { userAgent: ua } : {}) });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e).split('\n')[0]));

  await page.route('**/api/auth/client', async r => {
    if (loginReply === 'hang') { await new Promise(res => setTimeout(res, 30000)); return r.abort(); }
    if (loginReply === 'wrong') return r.fulfill({ status:401, contentType:'application/json',
      body:'{"error":"Incorrect name or password."}' });
    r.fulfill({ status:200, contentType:'application/json',
      body: JSON.stringify({ session_token:'tok', client_id:'c1', display_name:'callum' }) });
  });
  for (const [u,b] of [['**/api/messages/**','{"messages":[]}'],['**/api/broadcasts**','{"broadcasts":[]}'],
    ['**/api/push/**','{}']]) await page.route(u, r => r.fulfill({ status:200, contentType:'application/json', body:b }));

  if (blockStorage) await page.addInitScript(BLOCK_STORAGE);
  await page.goto('http://localhost:5959/client');
  await page.waitForTimeout(2400);
  return { ctx, page, errors };
}

const state = page => page.evaluate(() => ({
  splash: getComputedStyle(document.getElementById('splash')).display,
  join: getComputedStyle(document.getElementById('join-screen')).display,
  app: getComputedStyle(document.getElementById('app')).display,
  btn: document.getElementById('action-btn')?.textContent.trim(),
  btnOff: document.getElementById('action-btn')?.disabled,
  err: document.getElementById('join-err')?.textContent.trim(),
  inapp: getComputedStyle(document.getElementById('inapp-banner')).display,
}));

(async () => {
  const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true });
  const checks = []; let crash = null;
  try {
    // 1. Lagring blockerad — appen ska starta som vanligt
    {
      const { ctx, page, errors } = await session(browser, { blockStorage:true });
      const s0 = await state(page);
      checks.push(['blockerad lagring: splashen släpper', s0.splash === 'none']);
      checks.push(['blockerad lagring: inloggningen visas', s0.join === 'flex']);
      checks.push(['blockerad lagring: inga sidfel', errors.length === 0]);
      if (errors.length) console.log('   fel:', errors.slice(0,2));

      await page.fill('#name-input','callum'); await page.fill('#password-input','hemligt');
      await page.click('#action-btn'); await page.waitForTimeout(1500);
      const s1 = await state(page);
      checks.push(['blockerad lagring: inloggningen går igenom', s1.app === 'flex' && s1.join === 'none']);
      await ctx.close();
    }

    // 2. Servern svarar aldrig — knappen får inte fastna
    {
      const { ctx, page } = await session(browser, { loginReply:'hang' });
      await page.fill('#name-input','callum'); await page.fill('#password-input','hemligt');
      await page.click('#action-btn');
      const mid = await state(page);
      checks.push(['under tiden står det Signing in', mid.btn === 'Signing in…']);
      // Tidsgränsen är 20 s
      await page.waitForTimeout(22000);
      const s = await state(page);
      checks.push(['knappen återställs när svaret uteblir', s.btn === 'Sign in']);
      checks.push(['och går att trycka på igen', s.btnOff === false]);
      checks.push(['felet förklarar vad som hände', /did not respond/i.test(s.err || '')]);
      await ctx.close();
    }

    // 3. Fel lösenord — servern svarar, meddelandet ska synas
    {
      const { ctx, page } = await session(browser, { loginReply:'wrong' });
      await page.fill('#name-input','callum'); await page.fill('#password-input','fel');
      await page.click('#action-btn'); await page.waitForTimeout(1200);
      const s = await state(page);
      checks.push(['fel lösenord visas som fel lösenord', /Incorrect/i.test(s.err || '')]);
      checks.push(['och knappen går att trycka på igen', s.btn === 'Sign in' && s.btnOff === false]);
      await ctx.close();
    }

    // 4. Facebooks webbläsare — vägen ut ska pekas ut
    {
      const { ctx, page } = await session(browser, { ua: FB_UA });
      const s = await state(page);
      checks.push(['Facebook-vyn känns igen', s.inapp === 'flex']);
      const txt = await page.textContent('#inapp-banner');
      checks.push(['bannern säger vad man ska göra', /Open in browser/i.test(txt)]);
      await page.click('#inapp-dismiss'); await page.waitForTimeout(300);
      checks.push(['den går att stänga', (await state(page)).inapp === 'none']);
      await ctx.close();
    }

    // 5. Vanlig webbläsare — ingen banner
    {
      const { ctx, page } = await session(browser);
      checks.push(['vanlig webbläsare får ingen banner', (await state(page)).inapp === 'none']);
      await ctx.close();
    }
  } catch (e) { crash = e; }

  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if (crash) { ok=false; console.log('FAIL — testet avbröts: ' + String(crash).split('\n')[0]); }
  await browser.close(); process.exit(ok?0:1);
})();
