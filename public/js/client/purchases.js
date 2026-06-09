async function loadPurchases() {
  try {
    const r = await fetch('/api/purchases/me', { headers: { 'x-session-token': session.session_token } });
    if (!r.ok) return;
    const d = await r.json();
    renderPurchases(d.sales || []);
  } catch(e) {}
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
  scroll.innerHTML = sales.map(sale => {
    const items = sale.sale_items || [];
    const date = new Date(sale.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const total = items.reduce((s, i) => s + (i.sell_price || 0) * (i.qty || 1), 0);
    const itemsHTML = items.map(item => `
      <div class="sale-item-row">
        ${item.image ? `<img class="sale-item-img" src="${item.image}" loading="lazy">` : `<div class="sale-item-img-ph"></div>`}
        <div class="sale-item-body">
          <div class="sale-item-name">${esc(item.name || '—')}</div>
          ${item.ref_code ? `<div class="sale-item-ref">${esc(item.ref_code)}</div>` : ''}
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
        <div style="display:flex;align-items:center;gap:8px">
          <div class="sale-card-date">${date}</div>
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
      ${trackingHTML}
      <div class="sale-card-footer">
        <span class="sale-total-label">Total</span>
        <span class="sale-total-val">€${total.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
      </div>
    </div>`;
  }).join('');
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
