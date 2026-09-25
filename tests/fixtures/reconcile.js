// EN order, räknad i alla vyer. Varje siffra nedan är uträknad för hand här och
// används av både serverprovet (export, avräkning) och webbläsarprovet
// (Historik, kundens historik, fakturan). Avviker någon formel faller den vyn.
//
// Reglerna allt bygger på:
//   omsättning = sell_price × qty, alla rader
//   vinst      = (sell_price − buy_price) × qty, men rader UTAN inköpspris
//                hoppas över helt (frakt är genomgång)
//   rabatt     = negativ rad med inköpspris 0, så den sänker båda
//   avbruten   = räknas inte alls

const ITEMS = [
  // 2 par à 1200, inköp 800  → omsättning 2400, vinst 800
  { id:'a1', name:'Cartier Première', ref_code:'CT1', sell_price:'1200', buy_price:'800', qty:2 },
  // 1 par à 1400, inköp 900  → omsättning 1400, vinst 500
  { id:'a2', name:'Woods', ref_code:'CT7', sell_price:'1400', buy_price:'900', qty:1 },
  // frakt: ingen buy_price  → omsättning 20, vinst 0 (hoppas över)
  { id:'a3', name:'Shipping', ref_code:null, sell_price:'20', buy_price:null, qty:1 },
  // rabatt längst ner       → omsättning −250, vinst −250
  { id:'a4', name:'Discount', ref_code:null, sell_price:'-250', buy_price:'0', qty:1 },
  // rabatt på ett enskilt par → omsättning −100, vinst −100
  { id:'a5', name:'Discount — Woods', ref_code:'CT7', sell_price:'-100', buy_price:'0', qty:1 },
];

// 2400 + 1400 + 20 − 250 − 100
const REVENUE = 3470;
//  800 +  500 +  0 − 250 − 100
const PROFIT = 950;

// En avbruten order med stora tal — den får aldrig läcka in i någon summa
const CANCELLED = [
  { id:'c1', name:'Avbruten', ref_code:'CT9', sell_price:'9999', buy_price:'1000', qty:3 },
];

const SALES = [
  { id:'s1', created_at:'2026-09-05T10:00:00Z', status:'paid', invoice_number:'VP09-001',
    is_preorder:false, commission_pct:null, client_id:'c1',
    clients:{ display_name:'Samora', admin_label:null }, sale_items: ITEMS },
  { id:'s2', created_at:'2026-09-06T10:00:00Z', status:'cancelled', invoice_number:'VP09-002',
    is_preorder:false, commission_pct:null, client_id:'c1',
    clients:{ display_name:'Samora', admin_label:null }, sale_items: CANCELLED },
];

// Avräkningen: 70 % av vinsten på betalda ordrar
const COMMISSION_PCT = 70;
const EARNED = PROFIT * COMMISSION_PCT / 100;   // 665

module.exports = { ITEMS, CANCELLED, SALES, REVENUE, PROFIT, COMMISSION_PCT, EARNED };
