// Fakturorna från Kering kommer i kronor men lagret räknas i euro. Kursen är
// vår egen överenskommelse, inte den banken tog, så euro-priset går aldrig att
// stämma av mot fakturan. Originalbeloppet måste därför följa med till
// inköpsloggen — och importen får inte gå sönder innan migration 012 körts.
const http = require('http');
const express = require(process.cwd()+'/node_modules/express');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');

const ITEMS = [{
  ref_code:'CT0582S-005', name:'Cartier Première', qty:2,
  buy_price:548.73, buy_original:6036, buy_currency:'sek', fx_rate:11, sell_price:2400,
}];

// hasCurrencyColumns=false härmar en databas där 012 inte körts än
function run(hasCurrencyColumns) {
  return new Promise(resolve => {
    const seen = [];
    const mock = http.createServer((req,res)=>{
      let b=''; req.on('data',c=>b+=c);
      req.on('end',()=>{
        const p = req.url.split('?')[0];
        res.setHeader('Content-Type','application/json');
        if (p==='/rest/v1/inventory') {
          const rows = JSON.parse(b||'[]');
          return res.end(JSON.stringify(rows.map((r,i)=>({ id:`inv${i}`, ...r }))));
        }
        if (p==='/rest/v1/purchases') {
          const rows = JSON.parse(b||'[]');
          seen.push(rows);
          const usesNewCols = rows.some(r => 'buy_price_original' in r);
          if (usesNewCols && !hasCurrencyColumns) {
            res.statusCode = 400;
            return res.end(JSON.stringify({
              message: "Could not find the 'buy_price_original' column of 'purchases' in the schema cache" }));
          }
          return res.end(JSON.stringify(rows));
        }
        res.statusCode=404; res.end('{}');
      });
    });
    mock.listen(0,'127.0.0.1',()=>{
      process.env.SUPABASE_URL=`http://127.0.0.1:${mock.address().port}`;
      process.env.SUPABASE_SERVICE_KEY='dummy'; process.env.JWT_SECRET='test-secret';
      delete require.cache[require.resolve(process.cwd()+'/server/lib/supabase.js')];
      delete require.cache[require.resolve(process.cwd()+'/server/routes/orders.js')];
      const app=express(); app.use(express.json());
      app.use('/api', require(process.cwd()+'/server/routes/orders.js')());
      const srv=app.listen(0,'127.0.0.1',async()=>{
        const H={ Authorization:`Bearer ${jwt.sign({role:'admin',adminId:'a1'},'test-secret')}`,
          'Content-Type':'application/json' };
        const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/orders/import`,
          { method:'POST', headers:H, body: JSON.stringify({ items: ITEMS, document_url:'https://x/f.pdf' }) });
        const body = await r.json().catch(()=>({}));
        srv.close(); mock.close();
        resolve({ status:r.status, body, seen });
      });
    });
  });
}

(async () => {
  const withCols = await run(true);
  const withoutCols = await run(false);
  const first = withCols.seen[0]?.[0] || {};
  const fallback = withoutCols.seen[1]?.[0] || {};

  const checks = [
    ['importen går igenom', withCols.status===200],
    ['ett par per exemplar i lagret', withCols.body.created===2],
    ['en inköpsrad per fakturarad', withCols.body.lines===1],
    ['fakturans pris per styck sparas', first.buy_price_original===6036],
    ['valutan normaliseras till versaler', first.buy_currency==='SEK'],
    ['kursen sparas', first.fx_rate===11],
    ['euro-priset sparas som förut', first.buy_price===548.73],
    ['inköpsloggen lyckades', withCols.body.purchase_log===true],

    // Utan migration 012
    ['importen går igenom även utan 012', withoutCols.status===200],
    ['lagret skapas ändå', withoutCols.body.created===2],
    ['försöket görs först med valutakolumnerna',
      'buy_price_original' in (withoutCols.seen[0]?.[0] || {})],
    ['andra försöket skickar dem inte',
      withoutCols.seen.length===2 && !('buy_price_original' in fallback)
      && !('buy_currency' in fallback) && !('fx_rate' in fallback)],
    ['inköpet loggas ändå', withoutCols.body.purchase_log===true && fallback.buy_price===548.73],
  ];
  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  if(!ok) console.log(JSON.stringify({ withCols, withoutCols }, null, 1).slice(0, 1200));
  process.exit(ok?0:1);
})();
