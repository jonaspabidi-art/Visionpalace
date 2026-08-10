// Rabatten läggs som en minusrad med inköpspris 0. Det avgörande är att den
// sänker BÅDE omsättning och vinst — rader utan inköpspris räknas som
// genomgång och hoppas över i vinsten, och då hade ni fått provision på
// pengar som aldrig kom in.
const fs = require('fs');
const path = process.cwd();

// Samma vinstformel som export.js, settlement.js och Historik använder
function profitOf(items) {
  return items.reduce((s, i) => {
    if (i.buy_price == null) return s;
    const qty = i.qty || 1;
    return s + ((parseFloat(i.sell_price) || 0) - (parseFloat(i.buy_price) || 0)) * qty;
  }, 0);
}
function revenueOf(items) {
  return items.reduce((s, i) => s + (parseFloat(i.sell_price) || 0) * (i.qty || 1), 0);
}

const varor = [
  { name:'Cartier A', sell_price:900, buy_price:400, qty:2 },
  { name:'Cartier B', sell_price:700, buy_price:300, qty:1 },
];
const frakt = { name:'Shipping', sell_price:20, qty:1 };                 // ingen buy_price
const rabatt = { name:'Discount', sell_price:-250, buy_price:0, qty:1 }; // buy_price 0

const utan = [...varor, frakt];
const med = [...varor, frakt, rabatt];

const checks = [
  ['omsättning utan rabatt', revenueOf(utan) === 2520],
  ['vinst utan rabatt', profitOf(utan) === 1400],
  ['rabatten sänker omsättningen', revenueOf(med) === 2270],
  ['rabatten sänker vinsten lika mycket', profitOf(med) === 1150],
  ['frakten räknas inte in i vinsten', profitOf([...varor, frakt]) === profitOf(varor)],
];

// Utan buy_price hade rabatten sänkt omsättningen men inte vinsten
const rabattUtanInkop = { name:'Discount', sell_price:-250, qty:1 };
checks.push(['felaktig rabatt utan inköpspris skulle ge för hög vinst',
  profitOf([...varor, rabattUtanInkop]) === 1400 && revenueOf([...varor, rabattUtanInkop]) === 2250]);

// Koden ska faktiskt sätta buy_price 0 på rabattraden
const src = fs.readFileSync(path + '/public/js/admin/sales.js', 'utf8');
checks.push(['rabattraden skickas med inköpspris 0',
  /name: 'Discount'[^}]*buy_price: 0/.test(src)]);
checks.push(['rabatten skickas som negativt belopp', /sell_price: -discount/.test(src)]);
checks.push(['varunamnen är på engelska för kunden',
  /name: 'Shipping'/.test(src) && !/name: 'Frakt'/.test(src)]);
checks.push(['rabatten kan aldrig överstiga varorna', /Math\.min\(.*sub\)/s.test(src)]);
checks.push(['procent kapas vid 100', /Math\.min\(raw, 100\)/.test(src)]);

let ok = true;
for (const [l, p] of checks) { console.log(`${p?'PASS':'FAIL'} — ${l}`); if(!p) ok=false; }
process.exit(ok?0:1);
