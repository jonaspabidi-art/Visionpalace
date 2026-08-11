// ── Bokföringsunderlag som PDF ──
// CSV går rakt in i redovisningsprogrammet. Den här är den man mailar,
// skriver ut eller lämnar över.
//
// Dokumentet byggs som färdiga A4-sidor, inte som ett långt ark som klipps.
// Tidigare renderades allt i en enda hög div och html2pdf sågade den i
// 297 mm-bitar: marginalerna hamnade bara överst och underst i hela
// dokumentet, så från sida 2 låg texten kant i kant med papperet, och
// klippet gick rakt genom tabellraderna så att siffror delades på mitten.
// Nu paginerar vi själva — en rad hamnar aldrig halv på två sidor, och varje
// sida får sina egna marginaler, sin kolumnrubrik och sitt sidnummer.

const EXPORT_MONTHS_SV = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

const PAGE_W = 210, PAGE_H = 297;          // A4 i mm
const PAD_TOP = 14, PAD_SIDE = 15, PAD_BOTTOM = 13;
const FOOTER_H = 9;                        // plats för sidfoten
const CONTENT_W = PAGE_W - PAD_SIDE * 2;   // 180 mm
const PX_PER_MM = 96 / 25.4;
const USABLE_PX = (PAGE_H - PAD_TOP - PAD_BOTTOM - FOOTER_H) * PX_PER_MM;
const DOC_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

function exportMonthLabel(month) {
  const [y, m] = String(month).split('-').map(Number);
  return `${EXPORT_MONTHS_SV[m - 1] || month} ${y}`;
}

function eurAmount(n) {
  if (n == null || n === '') return '';
  return Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Kolumnerna låses i procent och tabellen får table-layout:fixed. Annars
// räknar webbläsaren om bredderna efter innehållet på just den sidan, och
// kolumnerna hoppar i sidled mellan sida 1 och 2.
// Kolumnerna sätts per dokument: fakturabeloppet tas bara med när det finns
// något att visa, så månader som lades in innan valutan sparades inte får en
// tom kolumn genom hela underlaget.
function docCols(d) {
  const anyOriginal = (d.purchases || []).some(p => p.original_amount != null);
  return {
    sales: [
      { label: 'Vara', w: 47, align: 'left', wrap: true },
      { label: 'Antal', w: 9, align: 'right' },
      { label: 'Á-pris €', w: 14, align: 'right' },
      { label: 'Belopp €', w: 14, align: 'right' },
      { label: 'Vinst €', w: 16, align: 'right' },
    ],
    purchases: anyOriginal ? [
      { label: 'Datum', w: 12, align: 'left' },
      { label: 'Vara', w: 24, align: 'left', wrap: true },
      { label: 'Antal', w: 6, align: 'right' },
      { label: 'Á-pris €', w: 11, align: 'right' },
      { label: 'Summa €', w: 11, align: 'right' },
      { label: 'Enligt faktura', w: 16, align: 'right' },
      { label: 'Källa', w: 11, align: 'left', wrap: true },
      { label: 'Inlagt av', w: 9, align: 'left', wrap: true },
    ] : [
      { label: 'Datum', w: 13, align: 'left' },
      { label: 'Vara', w: 32, align: 'left', wrap: true },
      { label: 'Antal', w: 7, align: 'right' },
      { label: 'Á-pris €', w: 13, align: 'right' },
      { label: 'Summa €', w: 13, align: 'right' },
      { label: 'Källa', w: 12, align: 'left', wrap: true },
      { label: 'Inlagt av', w: 10, align: 'left', wrap: true },
    ],
    stock: [
      { label: 'Ref', w: 17, align: 'left' },
      { label: 'Modell', w: 37, align: 'left', wrap: true },
      { label: 'Antal', w: 8, align: 'right' },
      { label: 'Inköpspris €', w: 13, align: 'right' },
      { label: 'Lagervärde €', w: 13, align: 'right' },
      { label: 'Utpris €', w: 12, align: 'right' },
    ],
  };
}

const TABLE_CSS = 'width:100%;border-collapse:collapse;table-layout:fixed';
const colgroupHtml = cols => `<colgroup>${cols.map(c => `<col style="width:${c.w}%">`).join('')}</colgroup>`;

function headRowHtml(cols) {
  return `<tr>${cols.map((c, i) => `<th style="font-size:8px;letter-spacing:1.2px;text-transform:uppercase;
    color:#999;font-weight:600;white-space:nowrap;overflow:hidden;text-align:${c.align};
    padding:0 ${i === cols.length - 1 ? 0 : 7}px 6px ${i === 0 ? 0 : 7}px;
    border-bottom:1px solid #ddd">${esc(c.label)}</th>`).join('')}</tr>`;
}

function bodyRowHtml(cols, cells) {
  return `<tr>${cols.map((c, i) => {
    const v = cells[i];
    const shown = v === '' || v == null ? '<span style="color:#ccc">—</span>' : esc(String(v));
    // Textkolumner får radbryta, belopp aldrig. Ett tal som bryts mitt i är
    // oläsbart — det var så priserna såg fel ut.
    const wrap = c.wrap ? 'white-space:normal;word-break:break-word' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    return `<td style="font-size:9.5px;color:#222;text-align:${c.align};${wrap};
      padding:4px ${i === cols.length - 1 ? 0 : 7}px 4px ${i === 0 ? 0 : 7}px;
      border-bottom:1px solid #f0f0f0">${shown}</td>`;
  }).join('')}</tr>`;
}

function sectionTitleHtml(title, note) {
  return `<div style="padding:4px 0 7px">
    <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#111;font-weight:700">${esc(title)}</div>
    ${note ? `<div style="font-size:9px;color:#999;padding-top:2px">${esc(note)}</div>` : ''}
  </div>`;
}

function totalRowHtml(label, value) {
  return `<div style="display:flex;justify-content:flex-end;gap:22px;font-size:10.5px;font-weight:700;color:#111;
    border-top:1.5px solid #111;padding:6px 0 14px">
    <span style="letter-spacing:1px;text-transform:uppercase">${esc(label)}</span>
    <span style="text-align:right">${esc(value)}</span>
  </div>`;
}

function emptyNoteHtml(text) {
  return `<div style="font-size:10px;color:#999;padding:2px 0 14px">${esc(text)}</div>`;
}

// Rubrikraden för ett köp. Datum, fakturanummer, kund, status och säljare
// stod förr på varje varurad och åt upp bredden som priserna behövde. Nu står
// de en gång per köp och varuraderna får hela sidan.
function saleHeadHtml(s) {
  const left = [s.date, s.invoice, s.client].filter(Boolean).join(' · ');
  const right = [
    s.paid_at ? `${s.status} ${s.paid_at}` : s.status,
    s.preorder ? 'Förbeställning' : '',
    s.sold_by,
  ].filter(Boolean).join(' · ');
  return `<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;padding:9px 0 4px">
    <div style="font-size:10px;font-weight:700;color:#111;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(left)}</div>
    <div style="font-size:9px;color:#888;white-space:nowrap;flex-shrink:0">${esc(right)}</div>
  </div>`;
}

function saleSumHtml(amount, profit, anyProfit) {
  const p = anyProfit ? ` · vinst € ${eurAmount(profit)}` : '';
  return `<div style="text-align:right;font-size:9px;color:#666;padding:3px 0 2px">Summa € ${eurAmount(amount)}${p}</div>`;
}

// ── Blocken ──
// Ett block är minsta bit som aldrig får delas: en rubrik, en tabellrad, en
// summarad. Sidan tar slut före ett block som inte får plats i stället för
// att klippa det på mitten.
const blk = (html, opts = {}) => ({ html, table: null, keep: 0, ...opts });

function buildBlocks(d, cols) {
  const out = [];

  // Försäljningar, grupperade per köp
  out.push(blk(sectionTitleHtml('Försäljningar', 'Båda admin-kontonas försäljningar'), { keep: 2 }));
  if (!d.sales?.length) {
    out.push(blk(emptyNoteHtml('Inga försäljningar den här månaden.')));
  } else {
    const groups = [];
    const byKey = new Map();
    for (const s of d.sales) {
      // sale_id är nyckeln — fakturanummer saknas på kontantköp och skulle
      // slå ihop två olika köp till ett
      const key = s.sale_id || `${s.date}|${s.invoice}|${s.client}|${s.sold_by}`;
      let g = byKey.get(key);
      if (!g) { g = { head: s, items: [], amount: 0, profit: 0, anyProfit: false }; byKey.set(key, g); groups.push(g); }
      g.items.push(s);
      g.amount += Number(s.amount) || 0;
      if (s.profit != null) { g.profit += Number(s.profit); g.anyProfit = true; }
    }
    out.push(blk(headRowHtml(cols.sales), { table: 'sales', isHead: true }));
    for (const g of groups) {
      out.push(blk(saleHeadHtml(g.head), { keep: 2 }));
      for (const it of g.items) {
        out.push(blk(bodyRowHtml(cols.sales, [
          it.ref ? `${it.name} (${it.ref})` : it.name,
          it.qty, eurAmount(it.sell), eurAmount(it.amount),
          it.profit == null ? '' : eurAmount(it.profit),
        ]), { table: 'sales' }));
      }
      out.push(blk(saleSumHtml(g.amount, g.profit, g.anyProfit)));
    }
    out.push(blk(totalRowHtml('Summa', `€ ${eurAmount(d.totals.revenue)}   ·   vinst € ${eurAmount(d.totals.profit)}`)));
  }

  // Inköp
  out.push(blk(sectionTitleHtml('Inköp', 'Gemensamma för bolaget'), { keep: 2 }));
  if (!d.purchases?.length) {
    out.push(blk(emptyNoteHtml('Inga inköp den här månaden.')));
  } else {
    out.push(blk(headRowHtml(cols.purchases), { table: 'purchases', isHead: true }));
    const withOriginal = cols.purchases.some(c => c.label === 'Enligt faktura');
    for (const p of d.purchases) {
      const base = [p.date, p.ref ? `${p.name} (${p.ref})` : p.name, p.qty,
        eurAmount(p.unit), eurAmount(p.amount)];
      // Beloppet som står på leverantörsfakturan, i fakturans egen valuta
      const orig = p.original_amount == null ? ''
        : `${eurAmount(p.original_amount)} ${p.currency || ''}`.trim();
      out.push(blk(bodyRowHtml(cols.purchases,
        withOriginal ? [...base, orig, p.source, p.added_by]
          : [...base, p.source, p.added_by]), { table: 'purchases' }));
    }
    out.push(blk(totalRowHtml('Summa', `€ ${eurAmount(d.totals.purchases)}`)));
  }

  // Lagerstatus — alltid på en egen sida, så den går att skriva ut och ta
  // med till en inventering utan att halva sidan är inköp
  if (d.inventory) {
    const t = d.totals || {};
    out.push(blk(sectionTitleHtml('Lagerstatus',
      `Läget ${d.stock_as_of || ''} — vad som står i lagret nu, inte vid månadens slut`), { keep: 2, newPage: true }));
    if (!d.inventory.length) {
      out.push(blk(emptyNoteHtml('Lagret är tomt.')));
    } else {
      out.push(blk(headRowHtml(cols.stock), { table: 'stock', isHead: true }));
      for (const s of d.inventory) {
        out.push(blk(bodyRowHtml(cols.stock, [
          s.ref, s.name, s.qty,
          s.buy == null ? '' : eurAmount(s.buy),
          s.value == null ? '' : eurAmount(s.value),
          s.sell == null ? '' : eurAmount(s.sell),
        ]), { table: 'stock' }));
      }
      out.push(blk(totalRowHtml(`${t.stock_count ?? 0} par i lager`, `lagervärde € ${eurAmount(t.stock_value || 0)}`)));
    }
  }
  return out;
}

// Mäter varje block i verklig bredd. Tabellrader måste mätas inuti en tabell
// med samma colgroup, annars stämmer inte höjden.
function measureBlocks(ruler, blocks, cols) {
  const plain = blocks.filter(b => !b.table);
  ruler.innerHTML = plain.map(b => `<div>${b.html}</div>`).join('');
  plain.forEach((b, i) => { b.h = ruler.children[i]?.offsetHeight || 16; });

  for (const key of Object.keys(cols)) {
    const rows = blocks.filter(b => b.table === key);
    if (!rows.length) continue;
    ruler.innerHTML = `<table style="${TABLE_CSS}">${colgroupHtml(cols[key])}<tbody>${rows.map(r => r.html).join('')}</tbody></table>`;
    const trs = ruler.querySelectorAll('tr');
    rows.forEach((b, i) => { b.h = trs[i]?.offsetHeight || 18; });
  }
  ruler.innerHTML = '';
}

// Packar blocken sida för sida. `keep` håller ihop en rubrik med raderna
// under sig så att den inte blir ensam kvar längst ner på en sida.
function packPages(blocks, firstPageUsed) {
  const pages = [[]];
  let used = firstPageUsed;
  const heads = {};        // kolumnrubriken per tabell, för att upprepa den
  let shown = new Set();   // vilka tabellers rubrik som redan står på sidan

  const newPage = () => { pages.push([]); used = 0; shown = new Set(); };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.isHead) heads[b.table] = b;

    // En tabellrad på en sida som ännu inte visat kolumnrubriken drar med sig
    // rubriken. Annars går det inte att se vilken kolumn som är belopp och
    // vilken som är vinst när tabellen fortsätter på nästa sida.
    const needsHead = () => b.table && !b.isHead && !shown.has(b.table) && heads[b.table];

    let need = b.h + (needsHead() ? heads[b.table].h : 0);
    for (let k = 1; k <= b.keep && i + k < blocks.length; k++) need += blocks[i + k].h;
    if (b.newPage && pages[pages.length - 1].length) newPage();
    else if (used + need > USABLE_PX && pages[pages.length - 1].length) newPage();

    const page = pages[pages.length - 1];
    if (needsHead()) {
      page.push(heads[b.table]);
      used += heads[b.table].h;
      shown.add(b.table);
    }
    if (b.isHead) shown.add(b.table);
    page.push(b);
    used += b.h;
  }
  return pages;
}

// Sätter ihop en sidas block till HTML. Rader som ligger efter varandra i
// samma tabell samlas i ett <table>, så ramarna hänger ihop.
function renderPageBody(items, cols) {
  let html = '', open = null;
  for (const b of items) {
    if (b.table !== open) {
      if (open) html += '</tbody></table>';
      open = b.table;
      if (open) html += `<table data-table="${open}" style="${TABLE_CSS}">${colgroupHtml(cols[open])}<tbody>`;
    }
    html += b.html;
  }
  if (open) html += '</tbody></table>';
  return html;
}

function docHeaderHtml(d, logoData) {
  return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:16px">
    <div style="display:flex;align-items:center;gap:12px">
      ${logoData ? `<img src="${logoData}" style="width:44px;height:44px;object-fit:contain;border-radius:10px">` : ''}
      <div>
        <div style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:23px;color:#111;line-height:1.1">Vision Palace</div>
        <div style="font-size:8px;letter-spacing:3.5px;text-transform:uppercase;color:#999;padding-top:3px">Bokföringsunderlag</div>
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:19px;font-weight:800;color:#111;letter-spacing:1px;text-transform:capitalize">${esc(exportMonthLabel(d.month))}</div>
      <div style="font-size:10px;color:#777;padding-top:3px">Nedladdad av ${esc(d.admin || '—')}</div>
      <div style="font-size:10px;color:#777">${new Date().toLocaleDateString('sv-SE')}</div>
    </div>
  </div>`;
}

function summaryHtml(d) {
  const box = (label, value) => `<div><div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#999">${label}</div>
    <div style="font-size:16px;font-weight:800;color:#111;padding-top:2px">€ ${eurAmount(value)}</div></div>`;
  return `<div style="background:#fafafa;border:1px solid #eee;border-radius:6px;padding:11px 13px;margin-bottom:18px;
    display:flex;gap:26px;flex-wrap:wrap">
    ${box('Omsättning', d.totals.revenue)}
    ${box('Vinst', d.totals.profit)}
    ${box('Inköp', d.totals.purchases)}
    <div style="margin-left:auto;max-width:200px;text-align:right">
      <div style="font-size:9px;color:#999;line-height:1.45">Belopp i euro. Ingen moms — försäljning utanför EU.</div>
    </div>
  </div>`;
}

function buildBookkeepingHTML(d, logoData) {
  // Mäts i en osynlig linjal med exakt samma bredd som sidans textyta
  const ruler = document.createElement('div');
  ruler.style.cssText = `position:fixed;left:-10000px;top:0;width:${CONTENT_W}mm;
    visibility:hidden;font-family:${DOC_FONT};color:#222;background:#fff`;
  document.body.appendChild(ruler);

  let pages;
  const cols = docCols(d);
  try {
    const blocks = buildBlocks(d, cols);
    measureBlocks(ruler, blocks, cols);
    // Sida 1 bär brevhuvudet och sammanfattningsrutan
    ruler.innerHTML = `<div>${docHeaderHtml(d, logoData)}${summaryHtml(d)}</div>`;
    const topHeight = ruler.firstElementChild.offsetHeight;
    ruler.innerHTML = '';
    pages = packPages(blocks, topHeight);
  } finally {
    ruler.remove();
  }

  const month = esc(exportMonthLabel(d.month));
  const body = pages.map((items, i) => `<div class="pdf-page" style="width:${PAGE_W}mm;height:${PAGE_H}mm;
    padding:${PAD_TOP}mm ${PAD_SIDE}mm ${PAD_BOTTOM}mm;box-sizing:border-box;background:#fff;color:#222;
    font-family:${DOC_FONT};position:relative;overflow:hidden">
    ${i === 0 ? docHeaderHtml(d, logoData) + summaryHtml(d) : ''}
    ${renderPageBody(items, cols)}
    <div style="position:absolute;left:${PAD_SIDE}mm;right:${PAD_SIDE}mm;bottom:${PAD_BOTTOM - 5}mm;
      border-top:1px solid #eee;padding-top:4px;font-size:8px;color:#bbb;display:flex;justify-content:space-between">
      <span>Vision Palace · ${month} · underlag för redovisning</span>
      <span>Sida ${i + 1} av ${pages.length}</span>
    </div>
  </div>`).join('');

  return `<div class="pdf-doc" style="width:${PAGE_W}mm;background:#fff">${body}</div>`;
}

let _exportPdfBusy = false;
async function exportBookkeepingPdf(month) {
  if (_exportPdfBusy) return;
  _exportPdfBusy = true;
  showToast('Skapar PDF…', 'ok');
  let holder = null;
  try {
    const r = await api(`/api/export/bookkeeping?month=${month}&format=json`);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      showToast(e.error || 'Kunde inte skapa exporten', 'error');
      return;
    }
    const d = await r.json();

    if (!window.html2pdf) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      }).catch(() => {});
    }
    if (!window.html2pdf) { showToast('Kunde inte ladda PDF-biblioteket', 'error'); return; }

    // Loggan bakas in som data-URI — html2canvas ritar inte alltid en bild som
    // fortfarande laddas, och då blir hörnet tomt
    const logoData = await imgToDataUrl('/logo.png').catch(() => null);

    holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1';
    holder.innerHTML = buildBookkeepingHTML(d, logoData);
    document.body.appendChild(holder);

    const name = `bokforing-${month}.pdf`;
    const blob = await html2pdf().set({
      margin: 0,
      filename: name,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      // Sidorna är redan exakt 297 mm höga och ligger på rad, så html2pdf
      // ska bara klippa på jämna sidhöjder. Egna brytregler skulle lägga in
      // extra brytningar ovanpå våra och ge tomma sidor.
      pagebreak: { mode: [] },
    }).from(holder.firstElementChild).outputPdf('blob');

    await deliverExport(blob, name, 'application/pdf');
  } catch (e) {
    console.error('PDF-export misslyckades:', e);
    showToast('Kunde inte skapa PDF:en', 'error');
  } finally {
    if (holder) holder.remove();
    _exportPdfBusy = false;
  }
}
