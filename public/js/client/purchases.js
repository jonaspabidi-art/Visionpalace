let allPurchases = [];
let purchaseFilter = 'all';   // 'all' | 'unpaid' | 'arriving'

async function loadPurchases() {
  try {
    const r = await fetch('/api/purchases/me', { headers: { 'x-session-token': session.session_token } });
    if (!r.ok) return;
    const d = await r.json();
    allPurchases = d.sales || [];
    renderPurchases(allPurchases);
  } catch(e) {}
}

function setPurchaseFilter(f) {
  purchaseFilter = purchaseFilter === f ? 'all' : f;
  renderPurchases(allPurchases);
}

// On its way: a pre-order that has not landed yet, or a parcel in transit
function isArriving(sale) {
  if (sale.status === 'cancelled') return false;
  if (sale.is_preorder && !sale.arrived_at) return true;
  return sale.status === 'shipped';
}

function saleTotal(sale) {
  return (sale.sale_items || []).reduce((s, i) => s + (i.sell_price || 0) * (i.qty || 1), 0);
}

const money = n => `€${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// Two numbers worth acting on: what is owed, and what is on the way.
// Lifetime spend is deliberately left out — it is a negotiating lever, not
// information the buyer needs.
function purchaseSummaryHTML(sales) {
  const live = sales.filter(s => s.status !== 'cancelled');
  const unpaid = live.filter(s => (s.status || 'unpaid') === 'unpaid');
  const arriving = live.filter(isArriving);
  const owed = unpaid.reduce((s, x) => s + saleTotal(x), 0);
  if (!unpaid.length && !arriving.length) return '';
  const tile = (on, tone, big, small, onclick) => `
    <button onclick="${onclick}" style="flex:1;min-width:0;text-align:left;background:${on ? tone.bgOn : 'var(--surface2, #16151a)'};
      border:1px solid ${on ? tone.border : 'rgba(255,255,255,.07)'};border-radius:12px;padding:11px 13px;cursor:pointer;font-family:inherit">
      <div style="font-size:19px;font-weight:800;color:${tone.fg};line-height:1.15">${big}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px">${small}</div>
    </button>`;
  const red = { fg: '#ff9944', bgOn: 'rgba(255,153,68,.13)', border: 'rgba(255,153,68,.4)' };
  const purple = { fg: '#bb88ff', bgOn: 'rgba(187,136,255,.13)', border: 'rgba(187,136,255,.4)' };
  return `<div style="display:flex;gap:10px;flex-shrink:0">
    ${unpaid.length ? tile(purchaseFilter === 'unpaid', red, money(owed),
      `Outstanding · ${unpaid.length} order${unpaid.length > 1 ? 's' : ''}`, "setPurchaseFilter('unpaid')") : ''}
    ${arriving.length ? tile(purchaseFilter === 'arriving', purple, String(arriving.length),
      arriving.length > 1 ? 'On the way' : 'On the way', "setPurchaseFilter('arriving')") : ''}
  </div>`;
}

function renderPurchases(sales) {
  const scroll = document.getElementById('purchases-scroll');
  if (!sales.length) {
    scroll.innerHTML = `<div class="purchases-empty">
      <div class="feed-empty-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M16 10a4 4 0 0 1-8 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <p>No purchases yet</p>
    </div>`;
    return;
  }
  const statusBadge = (status) => {
    const map = {
      unpaid:    { label: 'Unpaid',    color: '#ff9944', bg: 'rgba(255,153,68,.13)' },
      paid:      { label: 'Paid',      color: '#66aaff', bg: 'rgba(100,170,255,.13)' },
      shipped:   { label: 'Shipped',   color: '#bb88ff', bg: 'rgba(187,136,255,.13)' },
      delivered: { label: 'Delivered', color: '#66dd99', bg: 'rgba(100,220,150,.13)' },
      cancelled: { label: 'Cancelled', color: '#ff7a7a', bg: 'rgba(255,100,100,.13)' },
    };
    const s = map[status] || map.unpaid;
    return `<span style="background:${s.bg};color:${s.color};border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700">${s.label}</span>`;
  };
  // A pre-order is bought before it exists — ordered from the supplier and
  // 1-6 weeks away. Showing how long ago it was ordered and how long is left
  // is the whole point: otherwise the buyer has no idea whether to worry.
  const preorderBlock = (sale) => {
    if (!sale.is_preorder) return '';
    const from = new Date(sale.created_at);
    const days = Math.max(0, Math.floor((Date.now() - from) / 86400000));
    const ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
    const addWeeks = w => { const d = new Date(from); d.setDate(d.getDate() + w * 7); return d; };
    const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const min = sale.eta_weeks_min, max = sale.eta_weeks_max;
    const hasWindow = min != null || max != null;
    const lo = addWeeks(Math.min(min ?? 0, max ?? 0));
    const hi = addWeeks(Math.max(min ?? 0, max ?? 0));

    let line, tone = '#bb88ff', pct = 0;
    if (sale.arrived_at) {
      line = 'Arrived — shipping to you shortly';
      tone = '#66dd99'; pct = 100;
    } else if (!hasWindow) {
      line = `Ordered ${ago}`;
      pct = 0;
    } else if (Date.now() > hi.getTime()) {
      line = 'Taking longer than expected — we are chasing it with the supplier';
      tone = '#ff9944'; pct = 100;
    } else {
      line = `Estimated arrival ${fmt(lo)} – ${fmt(hi)}`;
      const span = hi.getTime() - from.getTime();
      pct = span > 0 ? Math.min(100, Math.max(3, ((Date.now() - from.getTime()) / span) * 100)) : 0;
    }
    return `<div style="padding:10px 0;border-top:1px solid rgba(255,255,255,.06)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:7px">
        <span style="font-size:13px;color:${tone};font-weight:600">${line}</span>
        <span style="font-size:11px;color:var(--text3);white-space:nowrap">Ordered ${ago}</span>
      </div>
      <div style="height:5px;background:rgba(255,255,255,.07);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${tone};border-radius:3px;transition:width .4s"></div>
      </div>
    </div>`;
  };
  const buildTrackingUrl = (carrier, number) => {
    if (!number) return null;
    const c = (carrier || '').toLowerCase();
    if (c.includes('postnord')) return `https://www.postnord.se/vara-verktyg/spara-brev-paket-och-pall?shipmentId=${number}`;
    if (c.includes('dhl')) return `https://www.dhl.com/se-en/home/tracking.html?tracking-id=${number}`;
    if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${number}`;
    if (c.includes('bring')) return `https://tracking.bring.com/tracking/${number}`;
    if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
    return null;
  };
  const shown = sales.filter(s =>
    purchaseFilter === 'unpaid' ? (s.status || 'unpaid') === 'unpaid' && s.status !== 'cancelled'
      : purchaseFilter === 'arriving' ? isArriving(s)
        : true);

  const cardHTML = sale => {
    const items = sale.sale_items || [];
    const date = new Date(sale.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const total = items.reduce((s, i) => s + (i.sell_price || 0) * (i.qty || 1), 0);
    const itemsHTML = items.map(item => `
      <div class="sale-item-row">
        ${item.image ? `<img class="sale-item-img" src="${item.image}" loading="lazy">` : `<div class="sale-item-img-ph"></div>`}
        <div class="sale-item-body">
          <div class="sale-item-name">${esc(item.name || '—')}</div>
          ${item.ref_code ? `<div class="sale-item-ref">${esc(item.ref_code)}</div>` : ''}
          <button onclick="orderAgain('${encodeURIComponent(item.name || '')}','${encodeURIComponent(item.ref_code || '')}')"
                  style="background:none;border:none;padding:3px 0 0;color:#7aabff;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">Order again</button>
        </div>
        <div class="sale-item-right">
          ${item.sell_price != null ? `<div class="sale-item-price">€${item.sell_price}</div>` : ''}
          ${(item.qty || 1) > 1 ? `<div class="sale-item-qty">×${item.qty}</div>` : ''}
        </div>
      </div>`).join('');
    const saleData = encodeURIComponent(JSON.stringify(sale));
    const status = sale.status || 'unpaid';
    const tUrl = buildTrackingUrl(sale.shipping_carrier, sale.tracking_number);
    const trackingHTML = (status === 'shipped' || status === 'delivered') && sale.tracking_number
      ? `<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid rgba(255,255,255,.06);font-size:13px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#bb88ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          <span style="color:var(--text3)">${esc(sale.shipping_carrier || 'Frakt')}</span>
          ${tUrl
            ? `<a href="${tUrl}" target="_blank" style="color:#bb88ff;font-weight:600;margin-left:auto">${esc(sale.tracking_number)} →</a>`
            : `<span style="color:#bb88ff;font-weight:600;margin-left:auto">${esc(sale.tracking_number)}</span>`}
        </div>` : '';
    return `<div class="sale-card">
      <div class="sale-card-header">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div class="sale-card-date">${date}</div>
          ${sale.is_preorder ? `<span style="background:rgba(187,136,255,.13);color:#bb88ff;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700">Pre-order</span>` : ''}
          ${statusBadge(status)}
        </div>
        <div class="sale-card-meta">
          ${sale.invoice_number ? `<div class="sale-card-inv">${esc(sale.invoice_number)}</div>` : ''}
          <button class="sale-invoice-btn" onclick="openInvoice('${saleData}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Invoice
          </button>
        </div>
      </div>
      <div class="sale-items">${itemsHTML}</div>
      ${preorderBlock(sale)}
      ${trackingHTML}
      <div class="sale-card-footer">
        <span class="sale-total-label">Total</span>
        <span class="sale-total-val">€${total.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
      </div>
    </div>`;
  };

  // Grouped by month with a monthly total — the buyers are resellers and need
  // the figure for their own books
  const months = [];
  const byMonth = {};
  for (const sale of shown) {
    const key = String(sale.created_at || '').substring(0, 7);
    if (!byMonth[key]) { byMonth[key] = []; months.push(key); }
    byMonth[key].push(sale);
  }
  const monthLabel = key => {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  };
  const body = months.length
    ? months.map(key => {
      const list = byMonth[key];
      const spent = list.filter(s => s.status !== 'cancelled').reduce((s, x) => s + saleTotal(x), 0);
      // Hela månaden är ETT flex-barn. Scrollytan är en flex-kolumn, och
      // flex-barn krymper när innehållet blir högre än skärmen — utan
      // flex-shrink:0 pressas korten ihop till bara sin rubrik så fort
      // listan blir längre än en skärm.
      return `<div style="flex-shrink:0;display:flex;flex-direction:column;gap:12px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding-top:4px">
            <span style="font-size:13px;font-weight:700;color:var(--text2, #8a8a92)">${monthLabel(key)}</span>
            <span style="font-size:12px;color:var(--text3)">${money(spent)} · ${list.length} order${list.length > 1 ? 's' : ''}</span>
          </div>
          ${list.map(cardHTML).join('')}
        </div>`;
    }).join('')
    : `<div style="padding:40px 20px;text-align:center;color:var(--text3);font-size:14px">
        Nothing here — tap the tile above to show everything again.
      </div>`;

  scroll.innerHTML = purchaseSummaryHTML(sales) + body + statementHTML();
}

// A statement for the buyer's own bookkeeping
function statementHTML() {
  const years = [...new Set(allPurchases.map(s => String(s.created_at || '').substring(0, 4)))]
    .filter(Boolean).sort().reverse();
  if (!years.length) return '';
  return `<div style="flex-shrink:0;padding:14px 0 8px;text-align:center">
    <button onclick="downloadStatement()" style="background:none;border:1px solid rgba(255,255,255,.12);border-radius:10px;
      color:var(--text2, #8a8a92);font-size:13px;padding:10px 18px;cursor:pointer;font-family:inherit">Download statement</button>
    <div style="font-size:11px;color:var(--text3);margin-top:7px">All your purchases as a spreadsheet</div>
  </div>`;
}

async function downloadStatement() {
  try {
    const r = await fetch('/api/purchases/me/statement', { headers: { 'x-session-token': session.session_token } });
    if (!r.ok) return;
    const blob = await r.blob();
    const name = 'vision-palace-statement.csv';
    const file = new File([blob], name, { type: 'text/csv' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (e) {}
}

// Turns the history into a way to buy again instead of just an archive
function orderAgain(name, ref) {
  const n = decodeURIComponent(name || '');
  const r = decodeURIComponent(ref || '');
  switchTab('messages');
  setTimeout(() => {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.value = `Hi! I'd like to order more of ${n}${r ? ` (${r})` : ''}. How many can you do?`;
    input.focus();
    if (typeof autoResize === 'function') autoResize(input);
  }, 120);
}

function buildInvoiceHTML(sale) {
  const items = sale.sale_items || [];
  const invNumber = sale.invoice_number || '—';
  const date = new Date(sale.created_at).toLocaleDateString('sv-SE');
  const clientName = session.full_name || session.display_name || '—';
  const clientAddr = [session.address, session.phone].filter(Boolean).join('<br>');

  function fmt(n) { return Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  const subtotal = items.reduce((s, i) => s + (parseFloat(i.sell_price) || 0) * (parseInt(i.qty) || 1), 0);

  const rowsHtml = items.map(item => {
    const qty = parseInt(item.qty) || 1;
    const price = parseFloat(item.sell_price) || 0;
    return `<tr>
      <td style="font-weight:600;padding:12px 0;border-bottom:1px solid #eee;font-size:12px">
        ${esc(item.name || '—')}${item.ref_code ? `<div style="font-size:10px;color:#999;margin-top:2px">${esc(item.ref_code)}</div>` : ''}
      </td>
      <td style="text-align:right;padding:12px 0;border-bottom:1px solid #eee;font-size:12px">${qty}</td>
      <td style="text-align:right;padding:12px 0;border-bottom:1px solid #eee;font-size:12px">€ ${fmt(price)}</td>
      <td style="text-align:right;padding:12px 0;border-bottom:1px solid #eee;font-size:12px">€ ${fmt(qty * price)}</td>
    </tr>`;
  }).join('');

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:48px">
      <div style="font-size:36px;font-weight:800;letter-spacing:10px;text-transform:uppercase;color:#111">I N V O I C E</div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:700;color:#111;letter-spacing:2px;margin-bottom:4px"># ${esc(invNumber)}</div>
        <div style="font-size:12px;color:#555">${date}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:40px;padding-bottom:32px;border-bottom:2px solid #111">
      <div>
        <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:10px;font-weight:600">P A Y &nbsp; T O</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">${esc(INV_COMPANY.name)}</div>
        <div style="font-size:11px;color:#444;line-height:1.8">${esc(INV_COMPANY.vat)}<br>${esc(INV_COMPANY.address)}</div>
      </div>
      <div>
        <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:10px;font-weight:600">C U S T O M E R</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">${esc(clientName)}</div>
        <div style="font-size:11px;color:#444;line-height:1.8">${clientAddr}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
      <thead>
        <tr style="border-bottom:1px solid #111">
          <th style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;padding:0 0 10px;text-align:left;font-weight:600;width:45%">Description</th>
          <th style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;padding:0 0 10px;text-align:right;font-weight:600">Quantity</th>
          <th style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;padding:0 0 10px;text-align:right;font-weight:600">Unit Price</th>
          <th style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;padding:0 0 10px;text-align:right;font-weight:600">Amount</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="margin-top:16px;border-top:2px solid #111;padding-top:16px;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
      <div style="display:flex;gap:32px;font-size:16px;font-weight:800;letter-spacing:1px">
        <span style="min-width:120px;text-align:right">T O T A L</span>
        <span style="min-width:80px;text-align:right">€ ${fmt(subtotal)}</span>
      </div>
    </div>
    <div style="margin-top:48px;padding-top:32px;border-top:1px solid #ddd;display:grid;grid-template-columns:1fr 1fr;gap:40px">
      <div>
        <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:10px;font-weight:600">Bank details</div>
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">Bank Name</span><span style="font-weight:500">${esc(INV_COMPANY.bankName)}</span></div>
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">IBAN</span><span style="font-weight:500">${esc(INV_COMPANY.iban)}</span></div>
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">Bank Address</span><span style="font-weight:500">${esc(INV_COMPANY.bankAddress)}</span></div>
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">BIC / Swift</span><span style="font-weight:500">${esc(INV_COMPANY.bic)}</span></div>
      </div>
      <div>
        <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:10px;font-weight:600">Payment terms</div>
        <div style="font-size:10px;color:#888;line-height:1.7;padding-top:8px">Payment is due within 14 business days of invoice date.<br>Thank you for your business.</div>
      </div>
    </div>`;
}

let _currentInvoiceSale = null;

function openInvoice(saleJSON) {
  const sale = JSON.parse(decodeURIComponent(saleJSON));
  _currentInvoiceSale = sale;

  let outer = document.getElementById('inv-client-outer');
  if (!outer) {
    const doc = document.getElementById('invoice-doc');
    doc.innerHTML = '';
    outer = document.createElement('div');
    outer.id = 'inv-client-outer';
    outer.style.cssText = 'overflow:hidden;width:100%';
    const inner = document.createElement('div');
    inner.id = 'inv-client-inner';
    inner.style.cssText = 'background:#fff;width:794px;min-height:800px;padding:60px 64px;box-shadow:0 4px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;font-size:12px;line-height:1.5;color:#111;transform-origin:top left;font-family:Helvetica Neue,Arial,sans-serif';
    outer.appendChild(inner);
    doc.appendChild(outer);
  }
  document.getElementById('inv-client-inner').innerHTML = buildInvoiceHTML(sale);

  const sheet = document.getElementById('invoice-sheet');
  requestAnimationFrame(() => {
    const w = sheet.clientWidth - 32;
    const scale = w / 794;
    const inner = document.getElementById('inv-client-inner');
    inner.style.transform = `scale(${scale})`;
    outer.style.height = (inner.offsetHeight * scale) + 'px';
  });

  document.getElementById('invoice-modal').classList.add('open');
}

function closeInvoice() {
  document.getElementById('invoice-modal').classList.remove('open');
}

async function printInvoice() {
  if (!_currentInvoiceSale) return;
  const btn = document.querySelector('.invoice-dl-btn');
  btn.textContent = 'Generating…'; btn.disabled = true;
  try {
    if (!window.html2pdf) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const inner = document.getElementById('inv-client-inner');
    const saved = inner.style.transform;
    inner.style.transform = '';
    inner.style.minHeight = '0';
    const invNum = _currentInvoiceSale.invoice_number || 'invoice';
    await html2pdf().set({
      margin: 0,
      filename: `invoice-${invNum}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(inner).save();
    inner.style.transform = saved;
    inner.style.minHeight = '';
  } catch { alert('Could not generate PDF. Try again.'); }
  finally { btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Download / Print'; btn.disabled = false; }
}
