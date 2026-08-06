// Tar man bort en vara för hand ska inköpsraden bort också — annars ligger
// testprodukter kvar i bokföringsunderlaget. En SÅLD vara får däremot aldrig
// tappa sitt inköp: den tas bort av sales.js, inte via de här routerna.
const http = require('http');
let invDeletes = [], purchaseDeletes = [];
const mock = http.createServer((req,res)=>{
  let b=''; req.on('data',c=>b+=c);
  req.on('end',()=>{
    const p=req.url.split('?')[0], key=`${req.method} ${p}`;
    res.setHeader('Content-Type','application/json');
    if (key==='DELETE /rest/v1/inventory') { invDeletes.push(decodeURIComponent(req.url)); res.statusCode=204; return res.end(); }
    if (key==='DELETE /rest/v1/purchases') { purchaseDeletes.push(decodeURIComponent(req.url)); res.statusCode=204; return res.end(); }
    res.end('[]');
  });
});
mock.listen(0,'127.0.0.1',()=>{
  process.env.SUPABASE_URL=`http://127.0.0.1:${mock.address().port}`;
  process.env.SUPABASE_SERVICE_KEY='dummy'; process.env.JWT_SECRET='test-secret';
  const express=require(process.cwd()+'/node_modules/express');
  const jwt=require(process.cwd()+'/node_modules/jsonwebtoken');
  const app=express(); app.use(express.json());
  app.use('/api', require(process.cwd()+'/server/routes/inventory.js')({ emit(){} }));
  const srv=app.listen(0,'127.0.0.1',async()=>{
    const P=srv.address().port;
    const H={ Authorization:`Bearer ${jwt.sign({role:'admin',adminId:'a1'},'test-secret')}`, 'Content-Type':'application/json' };
    const checks=[];

    // Ett exemplar
    const r1=await fetch(`http://127.0.0.1:${P}/api/inventory/i1`,{method:'DELETE',headers:H});
    checks.push(['borttagning svarar 200', r1.status===200]);
    checks.push(['lagerraden tas bort', invDeletes.some(u=>/id=eq\.i1/.test(u))]);
    checks.push(['inköpsraden städas bort', purchaseDeletes.some(u=>/inventory_id=in\.\(i1\)/.test(u))]);

    // Hela högen
    invDeletes=[]; purchaseDeletes=[];
    const r2=await fetch(`http://127.0.0.1:${P}/api/inventory/delete`,{method:'POST',headers:H,body:JSON.stringify({ids:['i2','i3','i4']})});
    checks.push(['gruppborttagning svarar 200', r2.status===200]);
    checks.push(['alla tre lagerrader tas bort', invDeletes.some(u=>/i2.*i3.*i4/.test(u))]);
    checks.push(['alla tre inköpsrader städas bort', purchaseDeletes.some(u=>/inventory_id=in\.\(i2,i3,i4\)/.test(u))]);

    // Källkodskontroll: säljvägen får inte gå via de här routerna
    const salesSrc = require('fs').readFileSync(process.cwd()+'/server/routes/sales.js','utf8');
    checks.push(['säljet rör inte inköpsloggen', !/from\('purchases'\)\s*\.delete/.test(salesSrc)]);
    checks.push(['säljet tar bort lagret själv', /from\('inventory'\)\.delete/.test(salesSrc)]);

    let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
    if(!ok) console.log({ invDeletes, purchaseDeletes });
    srv.close(); mock.close(); process.exit(ok?0:1);
  });
});
