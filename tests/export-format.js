// Bokföringsunderlaget ska gå att få som CSV (till redovisningsprogrammet)
// och som JSON (som appen bygger PDF:en ur). Samma siffror i båda.
const http = require('http');
const SELLER = 'admin-1';
const SALES = [{
  id:'s1', created_at:'2026-07-03T10:00:00Z', paid_at:'2026-07-12T12:00:00Z', status:'paid',
  invoice_number:'VP07-010', admin_id:SELLER, is_preorder:false,
  clients:{ display_name:'Samora', admin_label:null },
  admins:{ display_name:'Vision Palace', username:'visionpalace' },
  sale_items:[
    { name:'Cartier Première', ref_code:'CT0582S-005', sell_price:'2400', buy_price:'1097.45', qty:1 },
    { name:'Frakt', ref_code:null, sell_price:'15', buy_price:null, qty:1 },
  ],
}];
const mock = http.createServer((req,res)=>{
  let b=''; req.on('data',c=>b+=c);
  req.on('end',()=>{
    const p=req.url.split('?')[0];
    res.setHeader('Content-Type','application/json');
    if (p==='/rest/v1/sales') return res.end(JSON.stringify(SALES));
    if (p==='/rest/v1/admins') return res.end(JSON.stringify({ display_name:'Vision Palace' }));
    if (p==='/rest/v1/purchases') return res.end(JSON.stringify([
      // Fakturan kom i kronor: 12 072 kr för 2 par, omräknat med kursen 11
      { purchased_at:'2026-07-03T09:00:00Z', name:'Cartier Première', ref_code:'CT0582S-005',
        qty:2, buy_price:'1097.45', source:'preorder', document_url:'https://x/cartier.pdf',
        buy_price_original:'6036', buy_currency:'SEK', fx_rate:'11',
        admins:{ display_name:'Vision Palace 2' } },
      // Inlagt innan valutan började sparas — får inte visa ett påhittat original
      { purchased_at:'2026-07-04T09:00:00Z', name:'Gammal vara', ref_code:'CT9',
        qty:1, buy_price:'500', source:'manual', document_url:null,
        admins:{ display_name:'Vision Palace' } }]));
    if (p==='/rest/v1/sale_payments') return res.end(JSON.stringify([
      { sale_id:'s1', paid_at:'2026-07-12T12:00:00Z', amount:'2415', note:'Bank', image_url:'https://x/k.jpg' }]));
    // Lagret har en rad per fysiskt par — tre likadana ska bli EN rad med
    // antal 3 i underlaget, annars går listan inte att stämma av mot en
    // inventering. Ett par saknar inköpspris och får inte räknas som 0.
    if (p==='/rest/v1/inventory') return res.end(JSON.stringify([
      { ref_code:'CT1', name:'Cartier Première', buy_price:'1000', sell_price:'2400' },
      { ref_code:'CT1', name:'Cartier Première', buy_price:'1000', sell_price:'2400' },
      { ref_code:'CT1', name:'Cartier Première', buy_price:'1000', sell_price:'2400' },
      { ref_code:'CT7', name:'Woods Grey', buy_price:'900', sell_price:'1400' },
      { ref_code:'CT9', name:'Utan pris', buy_price:null, sell_price:null },
    ]));
    // Riksbankens dagskurs: 11,50 kr per euro i juli
    if (p.startsWith('/swea/v1/Observations/')) return res.end(JSON.stringify([{ date:'2026-07-01', value:11.5 }]));
    if (p==='/rest/v1/fx_rates') return res.end('[]');
    if (p==='/rest/v1/app_settings') return res.end('null');
    res.statusCode=404; res.end('{}');
  });
});
mock.listen(0,'127.0.0.1',()=>{
  process.env.SUPABASE_URL=`http://127.0.0.1:${mock.address().port}`;
  process.env.SUPABASE_SERVICE_KEY='dummy'; process.env.JWT_SECRET='test-secret';
  process.env.RIKSBANK_API=`http://127.0.0.1:${mock.address().port}/swea/v1`;
  const express=require(process.cwd()+'/node_modules/express');
  const jwt=require(process.cwd()+'/node_modules/jsonwebtoken');
  const app=express(); app.use(express.json());
  app.use('/api', require(process.cwd()+'/server/routes/export.js')());
  const srv=app.listen(0,'127.0.0.1',async()=>{
    const P=srv.address().port;
    const H={ Authorization:`Bearer ${jwt.sign({role:'admin',adminId:SELLER},'test-secret')}` };
    const csvRes=await fetch(`http://127.0.0.1:${P}/api/export/bookkeeping?month=2026-07`,{headers:H});
    const buf=Buffer.from(await csvRes.arrayBuffer());
    const csv=buf.toString('utf8').replace(/^﻿/,'');
    const jsonRes=await fetch(`http://127.0.0.1:${P}/api/export/bookkeeping?month=2026-07&format=json`,{headers:H});
    const d=await jsonRes.json();
    const bad=await fetch(`http://127.0.0.1:${P}/api/export/bookkeeping?month=juli&format=json`,{headers:H});

    const checks=[
      // CSV som förut
      ['CSV svarar med csv', /text\/csv/.test(csvRes.headers.get('content-type')||'')],
      ['CSV har BOM i råa bytes', buf[0]===0xEF && buf[1]===0xBB && buf[2]===0xBF],
      ['CSV har semikolon och decimalkomma', csv.includes('Datum;Betaldatum') && csv.includes('2400,00')],
      // JSON
      ['JSON svarar med json', /application\/json/.test(jsonRes.headers.get('content-type')||'')],
      ['månaden följer med', d.month==='2026-07'],
      ['kontot följer med', d.admin==='Vision Palace'],
      ['en rad per såld vara', d.sales.length===2],
      ['säljraden bär kund, säljare och status', d.sales[0].client==='Samora'
        && d.sales[0].sold_by==='Vision Palace' && d.sales[0].status==='Betald'],
      ['belopp och vinst som tal, inte text', typeof d.sales[0].amount==='number' && d.sales[0].profit===1302.55],
      ['frakt utan inköpspris har ingen vinst', d.sales[1].profit===null],
      ['betaldatum följer med', d.sales[0].paid_at==='2026-07-12'],
      ['inköpen följer med', d.purchases.length===2 && d.purchases[0].qty===2],
      ['förbeställning märks som källa', d.purchases[0].source==='Förbeställning'],
      ['betalningarna följer med', d.payments.length===1 && d.payments[0].amount===2415],
      // Samma siffror i båda formaten
      ['omsättningen stämmer mot CSV', d.totals.revenue===2415 && csv.includes('2415,00')],
      ['vinsten stämmer mot CSV', d.totals.profit===1302.55 && csv.includes('1302,55')],
      ['inköpssumman stämmer mot CSV', d.totals.purchases===2694.9 && csv.includes('2194,90')],
      ['ogiltig månad avvisas även för JSON', bad.status===400],

      // Fakturans egen valuta — euro-priset är omräknat med en kurs vi valt
      // själva och går aldrig att stämma av mot en SEK-faktura
      ['fakturans belopp per styck följer med', d.purchases[0].original_unit===6036],
      ['fakturans radsumma räknas ut', d.purchases[0].original_amount===12072],
      ['valutan följer med', d.purchases[0].currency==='SEK'],
      ['kursen som användes sparas', d.purchases[0].fx_rate===11],
      ['euro-priset lämnas orört', d.purchases[0].unit===1097.45],
      ['inköp utan original hittar inte på ett',
        d.purchases[1].original_amount===null && d.purchases[1].currency===null],
      ['CSV har fakturakolumnerna',
        csv.includes('Fakturapris;Fakturasumma;Valuta;Kurs')],
      ['CSV visar fakturans summa i kronor', csv.includes('12072,00')],

      // Kronor är bokföringsvalutan — euro står kvar som referens
      ['säljet räknas om till dagskurs', d.sales[0].amount_sek===27600],
      ['kursen redovisas på raden', d.sales[0].rate===11.5],
      ['vinsten räknas om med samma kurs', d.sales[0].profit_sek===14979.33],
      ['omsättningen i kronor summeras', d.totals.revenue_sek===27772.5],
      ['SEK-fakturan tas till fakturans belopp, inte omräknad',
        d.purchases[0].amount_sek===12072 && d.purchases[0].sek_source==='faktura'],
      ['inköp utan faktura i kronor räknas om till dagskurs',
        d.purchases[1].amount_sek===5750 && d.purchases[1].sek_source==='dagskurs'],
      ['inköpen i kronor summeras', d.totals.purchases_sek===17822],
      ['lagret värderas också i kronor', d.totals.stock_value_sek===44850],
      ['CSV har kronkolumnerna', csv.includes('Belopp (SEK);Vinst (SEK);Kurs;Kursdatum')],
      ['CSV säger vilken kurs som gäller', csv.includes('Riksbankens dagskurs')],

      // Lagerstatus — samma siffror i CSV och JSON
      ['säljraden bär sitt köp-id så PDF:en kan gruppera', d.sales[0].sale_id==='s1'],
      ['lagret grupperas per modell', d.inventory.length===3],
      ['tre likadana par blir en rad med antal 3',
        d.inventory.some(i=>i.ref==='CT1' && i.qty===3 && i.value===3000)],
      ['par utan inköpspris får inget lagervärde',
        d.inventory.some(i=>i.ref==='CT9' && i.qty===1 && i.value===null)],
      ['antalet i lager summeras', d.totals.stock_count===5],
      ['lagervärdet räknar inte par utan pris som noll', d.totals.stock_value===3900],
      ['lagret daterats', /^\d{4}-\d{2}-\d{2}$/.test(d.stock_as_of||'')],
      ['CSV har lagersektionen', csv.includes('LAGERSTATUS') && csv.includes('Lagervärde (EUR)')],
      ['CSV visar samma lagervärde', csv.includes('3900,00') || csv.includes('3 900,00')],
    ];
    let ok=true; for(const [l,p] of checks){ console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
    if(!ok) console.log(JSON.stringify(d,null,1).slice(0,900));
    srv.close(); mock.close(); process.exit(ok?0:1);
  });
});
