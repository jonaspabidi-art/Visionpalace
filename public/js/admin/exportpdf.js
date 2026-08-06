// ── Bokföringsunderlag som PDF ──
// CSV går rakt in i redovisningsprogrammet. Den här är den man mailar,
// skriver ut eller lämnar över — samma vita, luftiga stil som fakturan, med
// loggan överst. Byggs som HTML och renderas med html2pdf, precis som fakturan,
// i stället för att ritas fält för fält.

const EXPORT_MONTHS_SV = ['januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

function exportMonthLabel(month) {
  const [y, m] = String(month).split('-').map(Number);
  return `${EXPORT_MONTHS_SV[m - 1] || month} ${y}`;
}

function eurAmount(n) {
  if (n == null || n === '') return '';
  return Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Rubrikrad + rader, i fakturans stil: versaler med teckenavstånd, tunna linjer
// Allt utom varunamnet hålls på en rad — datum och personnamn som bryts mitt
// itu är svårläst i ett underlag man ska stämma av rad för rad. Varukolumnen
// tar i stället upp det utrymme som blir över.
function exportTable(headers, rows, aligns, wrapCol) {
  if (!rows.length) {
    return `<div style="font-size:11px;color:#999;padding:6px 0 2px">Inget att redovisa den här månaden.</div>`;
  }
  const padL = i => (i === 0 ? '0' : '9px');
  const padR = i => (i === headers.length - 1 ? '0' : '9px');
  const wrap = i => (i === wrapCol ? 'white-space:normal' : 'white-space:nowrap');
  const width = i => (i === wrapCol ? 'width:99%' : 'width:1%');
  const th = headers.map((h, i) => `<th style="font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:#999;
    padding:0 ${padR(i)} 7px ${padL(i)};text-align:${aligns[i] || 'left'};font-weight:600;
    white-space:nowrap;${width(i)}">${h}</th>`).join('');
  const tr = rows.map(cells => `<tr>${cells.map((c, i) => `<td style="font-size:10px;color:#222;
    padding:5px ${padR(i)} 5px ${padL(i)};border-top:1px solid #eee;
    text-align:${aligns[i] || 'left'};${wrap(i)}">${c === '' || c == null ? '<span style="color:#ccc">—</span>' : esc(String(c))}</td>`).join('')}</tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:4px;table-layout:auto">
    <thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function exportSection(title, note, inner) {
  return `<div style="margin-bottom:26px">
    <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#111;font-weight:700;margin-bottom:2px">${esc(title)}</div>
    ${note ? `<div style="font-size:9px;color:#999;margin-bottom:8px">${esc(note)}</div>` : '<div style="margin-bottom:8px"></div>'}
    ${inner}
  </div>`;
}

function exportTotalRow(label, value) {
  return `<div style="display:flex;justify-content:flex-end;gap:24px;font-size:11px;font-weight:700;color:#111;
    border-top:1.5px solid #111;padding-top:7px;margin-top:2px">
    <span style="letter-spacing:1px;text-transform:uppercase">${esc(label)}</span>
    <span style="min-width:90px;text-align:right">${esc(value)}</span>
  </div>`;
}

function buildBookkeepingHTML(d, logoData) {
  const salesRows = d.sales.map(s => [
    s.date, s.paid_at, s.invoice, s.client, s.sold_by, s.status,
    s.ref ? `${s.name} (${s.ref})` : s.name, s.qty,
    eurAmount(s.amount), s.profit == null ? '' : eurAmount(s.profit),
  ]);
  const purchaseRows = d.purchases.map(p => [
    p.date, p.ref ? `${p.name} (${p.ref})` : p.name, p.qty,
    eurAmount(p.unit), eurAmount(p.amount), p.source, p.added_by,
  ]);
  return `<div style="width:210mm;min-height:297mm;padding:18mm 16mm;background:#fff;color:#222;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-sizing:border-box">

    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:26px">
      <div style="display:flex;align-items:center;gap:12px">
        ${logoData ? `<img src="${logoData}" style="width:46px;height:46px;object-fit:contain;border-radius:10px">` : ''}
        <div>
          <div style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:23px;color:#111;line-height:1.1">Vision Palace</div>
          <div style="font-size:8px;letter-spacing:3.5px;text-transform:uppercase;color:#999;margin-top:3px">Bokföringsunderlag</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:19px;font-weight:800;color:#111;letter-spacing:1px;text-transform:capitalize">${esc(exportMonthLabel(d.month))}</div>
        <div style="font-size:10px;color:#777;margin-top:3px">Nedladdad av ${esc(d.admin || '—')}</div>
        <div style="font-size:10px;color:#777">${new Date().toLocaleDateString('sv-SE')}</div>
      </div>
    </div>

    <div style="background:#fafafa;border:1px solid #eee;border-radius:6px;padding:11px 13px;margin-bottom:26px;
      display:flex;gap:26px;flex-wrap:wrap">
      <div><div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#999">Omsättning</div>
        <div style="font-size:16px;font-weight:800;color:#111;margin-top:2px">€ ${eurAmount(d.totals.revenue)}</div></div>
      <div><div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#999">Vinst</div>
        <div style="font-size:16px;font-weight:800;color:#111;margin-top:2px">€ ${eurAmount(d.totals.profit)}</div></div>
      <div><div style="font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#999">Inköp</div>
        <div style="font-size:16px;font-weight:800;color:#111;margin-top:2px">€ ${eurAmount(d.totals.purchases)}</div></div>
      <div style="margin-left:auto;max-width:210px;text-align:right">
        <div style="font-size:9px;color:#999;line-height:1.45">Belopp i euro. Ingen moms — försäljning utanför EU.</div>
      </div>
    </div>

    ${exportSection('Försäljningar', 'Båda admin-kontonas försäljningar',
      exportTable(['Datum', 'Betald', 'Fakturanr', 'Kund', 'Sålt av', 'Status', 'Vara', 'Antal', 'Belopp €', 'Vinst €'],
        salesRows, ['left', 'left', 'left', 'left', 'left', 'left', 'left', 'right', 'right', 'right'], 6)
      + (d.sales.length ? exportTotalRow('Summa', `€ ${eurAmount(d.totals.revenue)}   ·   vinst € ${eurAmount(d.totals.profit)}`) : ''))}

    ${exportSection('Inköp', 'Gemensamma för bolaget',
      exportTable(['Datum', 'Vara', 'Antal', 'Á-pris €', 'Summa €', 'Källa', 'Inlagt av'],
        purchaseRows, ['left', 'left', 'right', 'right', 'right', 'left', 'left'], 1)
      + (d.purchases.length ? exportTotalRow('Summa', `€ ${eurAmount(d.totals.purchases)}`) : ''))}

    <div style="margin-top:auto;padding-top:14px;border-top:1px solid #eee;font-size:8px;color:#bbb;text-align:center">
      Vision Palace · ${esc(exportMonthLabel(d.month))} · underlag för redovisning
    </div>
  </div>`;
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
      pagebreak: { mode: ['css', 'legacy'] },
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
