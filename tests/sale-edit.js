// En order går att ändra så länge den är obetald. Det knepiga är lagret:
// lagerraden raderas vid försäljningen, så ett par som tas bort ur ordern
// måste skapas på nytt — annars försvinner det ur lagret för gott.
const http = require('http');
const express = require(process.cwd()+'/node_modules/express');
const jwt = require(process.cwd()+'/node_modules/jsonwebtoken');
const ADMIN = 'admin-1';

// sales.js drar in push-modulen, som vägrar starta utan VAPID-nycklar
const webpush = require(process.cwd()+'/node_modules/web-push');
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;

function makeServer(state) {
  const mock = http.createServer((req,res)=>{
    let b=''; req.on('data',c=>b+=c);
    req.on('end',()=>{
      const p = req.url.split('?')[0];
      const url = decodeURIComponent(req.url);
      res.setHeader('Content-Type','application/json');
      if (p==='/rest/v1/sales') return res.end(JSON.stringify(state.sale ? [state.sale] : []));
      if (p==='/rest/v1/sale_items') {
        if (req.method==='POST') {
          const rows = JSON.parse(b||'[]').map((r,i)=>({ id:'new'+i, ...r }));
          state.inserted.push(...rows);
          return res.end(JSON.stringify(rows));
        }
        if (req.method==='DELETE') {
          state.deletedItemIds.push(...(url.match(/id=in\.\(([^)]*)\)/)?.[1] || '').split(',').filter(Boolean));
          return res.end('[]');
        }
        return res.end(JSON.stringify(state.items));
      }
      if (p==='/rest/v1/inventory') {
        if (req.method==='POST') { state.restored.push(...JSON.parse(b||'[]')); return res.end('[]'); }
        if (req.method==='DELETE') {
          state.taken.push(...(url.match(/id=in\.\(([^)]*)\)/)?.[1] || '').split(',').filter(Boolean));
          return res.end('[]');
        }
      }
      res.statusCode=404; res.end('{}');
    });
  });
  return mock;
}

function run(state, body, cb) {
  const mock = makeServer(state);
  mock.listen(0,'127.0.0.1',()=>{
    process.env.SUPABASE_URL=`http://127.0.0.1:${mock.address().port}`;
    process.env.SUPABASE_SERVICE_KEY='dummy'; process.env.JWT_SECRET='test-secret';
    for (const m of ['/server/lib/supabase.js','/server/routes/sales.js'])
      delete require.cache[require.resolve(process.cwd()+m)];
    const app=express(); app.use(express.json());
    app.use('/api', require(process.cwd()+'/server/routes/sales.js')({ emit(){} }));
    const srv=app.listen(0,'127.0.0.1',async()=>{
      const H={ Authorization:`Bearer ${jwt.sign({role:'admin',adminId:ADMIN},'test-secret')}`,
        'Content-Type':'application/json' };
      const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/sales/s1/items`,
        { method:'PATCH', headers:H, body: JSON.stringify(body) });
      const d = await r.json().catch(()=>({}));
      srv.close(); mock.close();
      cb({ status:r.status, body:d, state });
    });
  });
}

const baseSale = { id:'s1', status:'unpaid', invoice_number:'VP09-001', admin_id:ADMIN };
const baseItems = [
  { id:'i1', sale_id:'s1', name:'Cartier Première', ref_code:'CT1', qty:2,
    sell_price:'1200', buy_price:'800', image:'https://x/a.jpg', inventory_id:'inv1' },
  { id:'i2', sale_id:'s1', name:'Shipping', ref_code:null, qty:1,
    sell_price:'20', buy_price:null, image:null },
];
const fresh = () => ({ sale:{...baseSale}, items: baseItems.map(i=>({...i})),
  inserted:[], deletedItemIds:[], restored:[], taken:[] });

const checks = [];
const done = () => {
  let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
  process.exit(ok?0:1);
};

// 1. Ta bort en hel rad → paren tillbaka i lagret
run(fresh(), { items:[{ id:'i2', name:'Shipping', qty:1, sell_price:20 }] }, r1 => {
  checks.push(['borttagning går igenom', r1.status===200]);
  checks.push(['båda paren läggs tillbaka i lagret', r1.state.restored.length===2]);
  checks.push(['de återskapas med ref och priser',
    r1.state.restored[0]?.ref_code==='CT1' && Number(r1.state.restored[0]?.buy_price)===800]);
  checks.push(['frakt hamnar aldrig i lagret',
    !r1.state.restored.some(x => x.name==='Shipping')]);

  // 2. Sänkt antal → mellanskillnaden tillbaka
  run(fresh(), { items:[
    { id:'i1', name:'Cartier Première', ref_code:'CT1', qty:1, sell_price:1200, buy_price:800 },
    { id:'i2', name:'Shipping', qty:1, sell_price:20 }] }, r2 => {
    checks.push(['sänkt antal ger ett par tillbaka', r2.state.restored.length===1]);

    // 3. Höjt antal på befintlig rad avvisas — vi vet inte vilka par som tas
    run(fresh(), { items:[
      { id:'i1', name:'Cartier Première', ref_code:'CT1', qty:5, sell_price:1200, buy_price:800 }] }, r3 => {
      checks.push(['höjt antal avvisas', r3.status===400]);
      checks.push(['och förklarar varför', /ny rad ur lagret/.test(r3.body.error||'')]);
      checks.push(['inget rörs vid avvisning',
        r3.state.restored.length===0 && r3.state.inserted.length===0]);

      // 4. Ny rad plockar par ur lagret
      run(fresh(), { items:[
        ...baseItems.map(i=>({ id:i.id, name:i.name, ref_code:i.ref_code, qty:i.qty,
          sell_price:Number(i.sell_price), buy_price:i.buy_price?Number(i.buy_price):null })),
        { name:'Cartier Santos', ref_code:'CT7', qty:2, sell_price:1500, buy_price:900,
          inventory_ids:['inv9','inv10'] }] }, r4 => {
        checks.push(['ny rad tar par ur lagret', r4.state.taken.join()==='inv9,inv10']);
        checks.push(['ingenting läggs tillbaka i onödan', r4.state.restored.length===0]);
        checks.push(['alla rader sparas', r4.state.inserted.length===3]);
        checks.push(['gamla rader tas bort', r4.state.deletedItemIds.sort().join()==='i1,i2']);

        // 5. Rabatt som negativ rad med inköpspris 0
        run(fresh(), { items:[
          ...baseItems.map(i=>({ id:i.id, name:i.name, qty:i.qty, sell_price:Number(i.sell_price),
            buy_price:i.buy_price?Number(i.buy_price):null })),
          { name:'Discount', qty:1, sell_price:-300, buy_price:0 }] }, r5 => {
          const disc = r5.state.inserted.find(x=>x.name==='Discount');
          checks.push(['rabatt sparas som negativt belopp', Number(disc?.sell_price)===-300]);
          checks.push(['med inköpspris 0, så vinsten sänks', Number(disc?.buy_price)===0]);
          checks.push(['rabatten hamnar inte i lagret', r5.state.restored.length===0]);

          // 6. Betald order är låst
          const paid = fresh(); paid.sale.status = 'paid';
          run(paid, { items:[{ id:'i1', name:'X', qty:1, sell_price:1 }] }, r6 => {
            checks.push(['betald order går inte att ändra', r6.status===409]);
            checks.push(['och säger varför', /betald/i.test(r6.body.error||'')]);
            checks.push(['ingenting ändras på en betald order',
              r6.state.inserted.length===0 && r6.state.restored.length===0]);

            // 7. Tom order avvisas
            run(fresh(), { items:[] }, r7 => {
              checks.push(['order utan rader avvisas', r7.status===400]);

              // 8. Går att stänga av återläggningen
              run(fresh(), { restock:false,
                items:[{ id:'i2', name:'Shipping', qty:1, sell_price:20 }] }, r8 => {
                checks.push(['återläggning går att stänga av', r8.state.restored.length===0]);
                done();
              });
            });
          });
        });
      });
    });
  });
});
