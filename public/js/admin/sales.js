// ── Sale cart ──
let saleCartItems = []; // { id, name, ref_code, sell_price, qty, image }
let _lastSaleClientId = null;
let _lastSaleItems = null;
let _saleHistoryCache = {};

function addToSaleCartFromCard(invId) {
  const item = invItemsMap[invId];
  if (!item) return;
  const existing = saleCartItems.find(i => i.id === invId);
  if (existing) existing.qty++;
  else saleCartItems.push({ ...item, qty: 1 });
  updateSaleCartBadge();
  showToast(`${item.name} tillagd i försäljning`, 'success');
}

function updateSaleCartBadge() {
  const total = saleCartItems.reduce((s, i) => s + i.qty, 0) + lensCartItems.reduce((s, i) => s + i.qty, 0);
  const btn = document.getElementById('inv-sell-open-btn');
  const badge = document.getElementById('sale-cart-badge');
  btn.style.display = (total > 0 || activeInvTab === 'lenses') ? '' : 'none';
  badge.textContent = total > 0 ? total : '';
}

function openSaleModal(invId) {
  if (invId && invItemsMap[invId] && !saleCartItems.find(i => i.id === invId)) {
    saleCartItems.push({ ...invItemsMap[invId], qty: 1 });
  }
  const sel = document.getElementById('sale-client-pick');
  sel.innerHTML = '<option value="">Välj klient…</option>' +
    clients.filter(c => !c.is_inactive).map(c =>
      `<option value="${c.id}">${esc(c.admin_label || c.display_name)}</option>`
    ).join('');
  renderSaleCart();
  renderSaleInvList();
  renderSaleLensList();
  document.getElementById('sale-modal').classList.add('open');
}

function closeSaleModal() {
  document.getElementById('sale-modal').classList.remove('open');
  const s = document.getElementById('sale-shipping');
  if (s) s.value = '';
}

function updateSaleQty(invId, delta) {
  const item = saleCartItems.find(i => i.id === invId);
  if (!item) return;
  item.qty = Math.max(1, item.qty + delta);
  renderSaleCart();
}

function removeFromSaleCart(invId) {
  saleCartItems = saleCartItems.filter(i => i.id !== invId);
  renderSaleCart();
  renderSaleInvList();
  updateSaleCartBadge();
}

function renderSaleCart() {
  const list = document.getElementById('sale-cart-list');
  if (!list) return;
  const allItems = [
    ...saleCartItems.map(i => ({ ...i, _type: 'glasses' })),
    ...lensCartItems.map(i => ({ ...i, _type: 'lenses' }))
  ];
  if (!allItems.length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:10px 0">Inga varor valda ännu</div>';
    document.getElementById('sale-total').textContent = 'Totalt: € 0,00';
    return;
  }
  list.innerHTML = allItems.map(item => {
    const displayName = item._type === 'lenses'
      ? `${esc(item.name)} <span style="color:var(--text3);font-size:11px">(${esc(item.color)})</span>`
      : esc(item.name);
    const minus  = item._type === 'lenses' ? `updateLensQty('${item.id}',-1)` : `updateSaleQty('${item.id}',-1)`;
    const plus   = item._type === 'lenses' ? `updateLensQty('${item.id}',1)`  : `updateSaleQty('${item.id}',1)`;
    const remove = item._type === 'lenses' ? `removeLensFromCart('${item.id}')` : `removeFromSaleCart('${item.id}')`;
    return `<div class="sale-cart-item">
      ${item.image ? `<img class="sale-item-img" src="${item.image}" alt="">` : `<div class="sale-item-img"></div>`}
      <div class="sale-item-info">
        <div class="sale-item-name">${displayName}</div>
        <div class="sale-item-price">${item.sell_price != null ? `€ ${item.sell_price}` : '—'}</div>
      </div>
      <div class="sale-qty-row">
        <button class="sale-qty-btn" onclick="${minus}">−</button>
        <span class="sale-qty-num">${item.qty}</span>
        <button class="sale-qty-btn" onclick="${plus}">+</button>
        <button class="sale-rm-btn" onclick="${remove}">✕</button>
      </div>
    </div>`;
  }).join('');
  const shipping = parseFloat(document.getElementById('sale-shipping')?.value) || 0;
  const total = allItems.reduce((s, i) => s + (parseFloat(i.sell_price) || 0) * i.qty, 0) + shipping;
  document.getElementById('sale-total').textContent = `Totalt: € ${total.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderSaleInvList() {
  const list = document.getElementById('sale-inv-list');
  if (!list) return;
  const items = Object.values(invItemsMap);
  if (!items.length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:10px 0">Lagret är tomt</div>';
    return;
  }
  const inCart = new Set(saleCartItems.map(i => i.id));
  list.innerHTML = items.map(item => `
    <div class="sale-inv-item">
      ${item.image
        ? `<img class="sale-item-img" src="${item.image}" alt="">`
        : `<div class="sale-item-img"></div>`}
      <div class="sale-item-info" style="flex:1;min-width:0">
        <div class="sale-item-name">${esc(item.name)}</div>
        <div class="sale-item-price">${item.sell_price != null ? `€ ${item.sell_price}` : '—'}</div>
      </div>
      ${inCart.has(item.id)
        ? `<span style="color:var(--blue);font-size:12px;font-weight:700;flex-shrink:0">✓ Vald</span>`
        : `<button class="sale-inv-add" onclick="addToSaleCartFromModal('${item.id}')">+</button>`}
    </div>`).join('');
}

function addToSaleCartFromModal(invId) {
  const item = invItemsMap[invId];
  if (!item) return;
  const existing = saleCartItems.find(i => i.id === invId);
  if (existing) existing.qty++;
  else saleCartItems.push({ ...item, qty: 1 });
  renderSaleCart();
  renderSaleInvList();
}

async function createSale() {
  const clientId = document.getElementById('sale-client-pick').value;
  if (!clientId) { showToast('Välj en klient', 'error'); return; }
  if (!saleCartItems.length && !lensCartItems.length) { showToast('Inga varor valda', 'error'); return; }
  const btn = document.querySelector('#sale-modal .inv-gen-btn');
  btn.textContent = 'Skapar…'; btn.disabled = true;
  try {
    const shipping = parseFloat(document.getElementById('sale-shipping')?.value) || 0;
    const glassItems = saleCartItems.map(i => ({
      inventory_id: i.id,
      name: i.name, ref_code: i.ref_code || null,
      sell_price: i.sell_price ?? null, buy_price: i.buy_price ?? null,
      qty: i.qty, image: i.image || null
    }));
    const lensItems = lensCartItems.map(i => ({
      lens_id: i.lensId, lens_variant_id: i.variantId, lens_color: i.color,
      name: `${i.name} (${i.color})`,
      sell_price: i.sell_price ?? null, buy_price: i.buy_price ?? null,
      qty: i.qty, image: i.image || null
    }));
    const items = [...glassItems, ...lensItems];
    if (shipping > 0) items.push({ name: 'Frakt', ref_code: null, sell_price: shipping, qty: 1, image: null });
    const r = await api('/api/sales', { method: 'POST', body: JSON.stringify({ client_id: clientId, items }) });
    if (!r.ok) { const d = await r.json(); showToast(d.error || 'Fel', 'error'); return; }
    _lastSaleClientId = clientId;
    _lastSaleItems = [
      ...saleCartItems,
      ...lensCartItems.map(i => ({ ...i, name: `${i.name} (${i.color})` })),
      ...(shipping > 0 ? [{ name: 'Frakt', sell_price: shipping, qty: 1 }] : [])
    ];
    saleCartItems = [];
    lensCartItems = [];
    updateSaleCartBadge();
    closeSaleModal();
    showSaleSuccessBanner();
  } catch { showToast('Anslutningsfel', 'error'); }
  finally { btn.textContent = 'Skapa försäljning'; btn.disabled = false; }
}

function showSaleSuccessBanner() {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:20px;left:12px;right:12px;
    background:#1a3a2a;color:#66dd99;border:1px solid rgba(80,200,120,.4);
    padding:14px 16px;border-radius:14px;font-size:14px;z-index:999;
    display:flex;align-items:center;gap:12px;`;
  const fillBtn = document.createElement('button');
  fillBtn.textContent = 'Generera faktura →';
  fillBtn.style.cssText = 'background:var(--blue);border:none;border-radius:10px;color:#1a1409;padding:8px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0';
  fillBtn.onclick = () => { fillInvoiceFromSale(_lastSaleClientId, _lastSaleItems); t.remove(); };
  const msg = document.createElement('span');
  msg.textContent = 'Försäljning skapad!';
  msg.style.flex = '1';
  const close = document.createElement('button');
  close.textContent = '×';
  close.style.cssText = 'background:none;border:none;color:#66dd99;font-size:22px;cursor:pointer;padding:0;line-height:1;flex-shrink:0';
  close.onclick = () => t.remove();
  t.append(msg, fillBtn, close);
  document.body.appendChild(t);
  setTimeout(() => { if (t.parentElement) t.remove(); }, 10000);
}

function fillInvoiceFromSale(clientId, items, invoiceNumber) {
  switchTab('invoice');
  populateInvClientPicker();
  setTimeout(() => {
    const sel = document.getElementById('inv-client-pick');
    sel.value = clientId;
    fillInvClient(clientId);
    if (invoiceNumber) {
      const numEl = document.getElementById('inv-number');
      if (numEl) numEl.value = invoiceNumber;
    }
    invLineItems = [];
    invLineNextId = 0;
    items.forEach(item => addInvLine(
      item.ref_code ? `${item.name} (${item.ref_code})` : item.name,
      String(item.qty || 1),
      item.sell_price != null ? String(item.sell_price) : '',
      '0'
    ));
    renderInvLines();
    generateInvoice();
  }, 50);
}

function openSaleInvoice(saleId) {
  const sale = _saleHistoryCache[saleId];
  if (!sale) return;
  fillInvoiceFromSale(sale.client_id, sale.sale_items || [], sale.invoice_number);
}

// ── Sale status helpers ──
function saleStatusBadge(status) {
  const map = {
    unpaid:    { label: 'Obetald',   color: '#ff9944', bg: 'rgba(255,153,68,.13)' },
    paid:      { label: 'Betald',    color: '#66aaff', bg: 'rgba(100,170,255,.13)' },
    shipped:   { label: 'Skickad',   color: '#bb88ff', bg: 'rgba(187,136,255,.13)' },
    delivered: { label: 'Levererad', color: '#66dd99', bg: 'rgba(100,220,150,.13)' },
    cancelled: { label: 'Avbruten',  color: '#ff7a7a', bg: 'rgba(255,100,100,.13)' },
  };
  const s = map[status] || map.unpaid;
  return `<span style="background:${s.bg};color:${s.color};border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700">${s.label}</span>`;
}

function trackingUrl(carrier, number) {
  if (!number) return null;
  const c = (carrier || '').toLowerCase();
  if (c.includes('postnord')) return `https://www.postnord.se/vara-verktyg/spara-brev-paket-och-pall?shipmentId=${number}`;
  if (c.includes('dhl')) return `https://www.dhl.com/se-en/home/tracking.html?tracking-id=${number}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${number}`;
  if (c.includes('bring')) return `https://tracking.bring.com/tracking/${number}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
  return null;
}

function statusActionsHTML(sale, sid) {
  const s = sale.status || 'unpaid';
  const btn = (label, onclick, color) =>
    `<button onclick="${onclick}" style="background:${color.bg};border:1px solid ${color.border};color:${color.text};border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;font-family:inherit">${label}</button>`;
  if (s === 'unpaid') return `<div style="display:flex;gap:8px;flex-wrap:wrap">
    ${btn('✓ Markera betald', `doStatusUpdate('${sale.id}','${sid}','paid')`, {bg:'rgba(100,170,255,.13)',border:'rgba(100,170,255,.3)',text:'#66aaff'})}
    ${btn('Avbryt köp', `doStatusUpdate('${sale.id}','${sid}','cancelled')`, {bg:'rgba(255,100,100,.1)',border:'rgba(255,100,100,.2)',text:'#ff7a7a'})}
  </div>`;
  if (s === 'paid') return `<div id="shipwrap-${sid}">
    ${btn('Markera skickad →', `showShipForm('${sid}','${sale.id}')`, {bg:'rgba(187,136,255,.13)',border:'rgba(187,136,255,.3)',text:'#bb88ff'})}
  </div>`;
  if (s === 'shipped') {
    const tUrl = trackingUrl(sale.shipping_carrier, sale.tracking_number);
    const trackHtml = sale.tracking_number
      ? `<div style="font-size:13px;color:var(--text2);margin-bottom:8px">${sale.shipping_carrier ? `<b>${esc(sale.shipping_carrier)}</b> · ` : ''}${tUrl ? `<a href="${tUrl}" target="_blank" style="color:#bb88ff">${esc(sale.tracking_number)}</a>` : esc(sale.tracking_number)}</div>` : '';
    return `${trackHtml}${btn('✓ Markera levererad', `doStatusUpdate('${sale.id}','${sid}','delivered')`, {bg:'rgba(100,220,150,.12)',border:'rgba(100,220,150,.25)',text:'#66dd99'})}`;
  }
  if (s === 'delivered') {
    const tUrl = trackingUrl(sale.shipping_carrier, sale.tracking_number);
    return sale.tracking_number
      ? `<div style="font-size:13px;color:var(--text2)">${sale.shipping_carrier ? `<b>${esc(sale.shipping_carrier)}</b> · ` : ''}${tUrl ? `<a href="${tUrl}" target="_blank" style="color:#bb88ff">${esc(sale.tracking_number)}</a>` : esc(sale.tracking_number)}</div>` : '';
  }
  return '';
}

function showShipForm(sid, saleId) {
  const wrap = document.getElementById('shipwrap-' + sid);
  if (!wrap) return;
  wrap.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">
    <input id="sc-${sid}" placeholder="Fraktbolag (PostNord, DHL…)" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;color:var(--text);font-family:inherit;outline:none">
    <input id="st-${sid}" placeholder="Spårningsnummer" style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;color:var(--text);font-family:inherit;outline:none">
    <div style="display:flex;gap:8px">
      <button onclick="submitShipForm('${sid}','${saleId}')" style="flex:1;background:rgba(187,136,255,.13);border:1px solid rgba(187,136,255,.3);color:#bb88ff;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;font-family:inherit">Skicka →</button>
      <button onclick="cancelShipForm('${sid}','${saleId}')" style="background:var(--surface2);border:1px solid var(--border);color:var(--text3);border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer;font-family:inherit">Avbryt</button>
    </div>
  </div>`;
}

function cancelShipForm(sid, saleId) {
  const wrap = document.getElementById('shipwrap-' + sid);
  if (!wrap) return;
  wrap.innerHTML = `<button onclick="showShipForm('${sid}','${saleId}')" style="background:rgba(187,136,255,.13);border:1px solid rgba(187,136,255,.3);color:#bb88ff;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;font-family:inherit">Markera skickad →</button>`;
}

async function submitShipForm(sid, saleId) {
  const carrier = document.getElementById('sc-' + sid)?.value.trim() || null;
  const tracking = document.getElementById('st-' + sid)?.value.trim() || null;
  await doStatusUpdate(saleId, sid, 'shipped', carrier, tracking);
}

async function doStatusUpdate(saleId, sid, newStatus, carrier, tracking) {
  try {
    const body = { status: newStatus };
    if (carrier) body.shipping_carrier = carrier;
    if (tracking) body.tracking_number = tracking;
    const r = await api(`/api/sales/${saleId}/status`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!r.ok) { showToast('Kunde inte uppdatera', 'error'); return; }
    const d = await r.json();
    const badge = document.getElementById('sbadge-' + sid);
    if (badge) badge.innerHTML = saleStatusBadge(d.sale.status);
    const sa = document.getElementById('sa-' + sid);
    if (sa) sa.innerHTML = statusActionsHTML(d.sale, sid);
    showToast('Status uppdaterad', 'ok');
  } catch { showToast('Anslutningsfel', 'error'); }
}

// ── Sales history / profit ──
async function loadSalesHistory() {
  const summaryEl = document.getElementById('historik-summary');
  const listEl = document.getElementById('historik-list');
  listEl.innerHTML = '<div style="color:var(--text3);font-size:14px;text-align:center;padding:40px 0">Laddar…</div>';
  summaryEl.innerHTML = '';
  try {
    const r = await api('/api/sales');
    const d = await r.json();
    const sales = d.sales || [];
    if (!sales.length) {
      listEl.innerHTML = '<div style="color:var(--text3);font-size:14px;text-align:center;padding:40px 0">Inga försäljningar ännu</div>';
      return;
    }

    // Group by month (YYYY-MM)
    const months = {};
    let totalRevAll = 0, totalProfAll = 0;
    for (const sale of sales) {
      const key = sale.created_at.substring(0, 7);
      if (!months[key]) months[key] = { sales: [], revenue: 0, profit: 0 };
      months[key].sales.push(sale);
      for (const item of (sale.sale_items || [])) {
        const rev = (parseFloat(item.sell_price) || 0) * (item.qty || 1);
        const cost = (parseFloat(item.buy_price) || 0) * (item.qty || 1);
        months[key].revenue += rev;
        months[key].profit += item.buy_price != null ? (rev - cost) : 0;
        totalRevAll += rev;
        totalProfAll += item.buy_price != null ? (rev - cost) : 0;
      }
    }

    // All-time summary cards
    summaryEl.innerHTML = `
      <div style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px 14px">
        <div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Total omsättning</div>
        <div style="font-size:20px;font-weight:700;color:var(--text)">€ ${totalRevAll.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      </div>
      <div style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px 14px">
        <div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Total vinst</div>
        <div style="font-size:20px;font-weight:700;color:${totalProfAll >= 0 ? '#66dd99' : '#ff7a7a'}">€ ${totalProfAll.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      </div>`;

    // Per-month sections
    _saleHistoryCache = {};
    listEl.innerHTML = Object.keys(months).sort((a,b) => b.localeCompare(a)).map(key => {
      const { sales: ms, revenue, profit } = months[key];
      const [yr, mo] = key.split('-');
      const monthName = new Date(yr, mo - 1).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
      const saleRows = ms.map(sale => {
        _saleHistoryCache[sale.id] = sale;
        const clientName = sale.clients?.admin_label || sale.clients?.display_name || '—';
        const saleRev = (sale.sale_items || []).reduce((s, i) => s + (parseFloat(i.sell_price) || 0) * (i.qty || 1), 0);
        const saleProfit = (sale.sale_items || []).reduce((s, i) => {
          if (i.buy_price == null) return s;
          return s + ((parseFloat(i.sell_price) || 0) - (parseFloat(i.buy_price) || 0)) * (i.qty || 1);
        }, 0);
        const hasCost = (sale.sale_items || []).some(i => i.buy_price != null);
        const date = new Date(sale.created_at).toLocaleDateString('sv-SE', { day: '2-digit', month: 'short' });
        const itemCount = (sale.sale_items || []).length;
        const itemLines = (sale.sale_items || []).map(item => {
          const rev = (parseFloat(item.sell_price) || 0) * (item.qty || 1);
          const cost = item.buy_price != null ? (parseFloat(item.buy_price) || 0) * (item.qty || 1) : null;
          const margin = cost != null ? (rev - cost) : null;
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">
            <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
              ${item.image ? `<img src="${item.image}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;flex-shrink:0">` : ''}
              <span style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name)}${item.qty > 1 ? ` ×${item.qty}` : ''}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px">
              <span style="color:var(--text)">€ ${rev.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              ${margin != null ? `<span style="color:${margin>=0?'#66dd99':'#ff7a7a'};font-size:12px;min-width:60px;text-align:right">${margin>=0?'+':''}€ ${margin.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>` : ''}
            </div>
          </div>`;
        }).join('');
        const sid = sale.id.replace(/-/g,'');
        return `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:10px">
          <div onclick="toggleSaleDetail('${sid}')" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;cursor:pointer">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="font-size:14px;font-weight:700;color:var(--text)">${esc(clientName)}</span>
                <span id="sbadge-${sid}">${saleStatusBadge(sale.status || 'unpaid')}</span>
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">${date}${sale.invoice_number ? ` · ${esc(sale.invoice_number)}` : ''} · ${itemCount} vara${itemCount !== 1 ? 'r' : ''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;margin-left:12px">
              <div style="text-align:right">
                <div style="font-size:14px;font-weight:700;color:var(--text)">€ ${saleRev.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                ${hasCost ? `<div style="font-size:12px;color:${saleProfit>=0?'#66dd99':'#ff7a7a'}">${saleProfit>=0?'+':''}€ ${saleProfit.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>` : ''}
              </div>
              <span id="chev-${sid}" style="color:var(--text3);font-size:12px;transition:transform .2s">▼</span>
            </div>
          </div>
          <div id="detail-${sid}" style="display:none;padding:0 14px 12px;border-top:1px solid var(--border)">
            ${itemLines}
            <div id="sa-${sid}" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
              ${statusActionsHTML(sale, sid)}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              <button onclick="event.stopPropagation();openSaleInvoice('${sale.id}')" style="background:none;border:1px solid rgba(100,150,255,.3);border-radius:8px;color:#7aabff;font-size:13px;padding:6px 12px;cursor:pointer;font-family:inherit">Faktura</button>
              <button onclick="event.stopPropagation();deleteSale('${sale.id}', loadSalesHistory)" style="background:none;border:1px solid rgba(255,100,100,.3);border-radius:8px;color:#ff7a7a;font-size:13px;padding:6px 12px;cursor:pointer;font-family:inherit">Ta bort försäljning</button>
            </div>
          </div>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
          <div style="font-size:13px;font-weight:700;color:var(--text2);text-transform:capitalize">${monthName}</div>
          <div style="font-size:12px;color:var(--text3)">€ ${revenue.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})} · vinst € ${profit.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        ${saleRows}
      </div>`;
    }).join('');
  } catch { listEl.innerHTML = '<div style="color:#ff7a7a;text-align:center;padding:40px 0">Fel vid laddning</div>'; }
}

function toggleSaleDetail(sid) {
  const detail = document.getElementById('detail-' + sid);
  const chev = document.getElementById('chev-' + sid);
  if (!detail) return;
  const open = detail.style.display === 'none';
  detail.style.display = open ? 'block' : 'none';
  if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
}

async function deleteSale(saleId, onDone) {
  if (!confirm('Ta bort denna försäljning?')) return;
  try {
    const r = await api(`/api/sales/${saleId}`, { method: 'DELETE' });
    if (!r.ok) { showToast('Kunde inte ta bort', 'error'); return; }
    showToast('Försäljning borttagen', 'ok');
    onDone();
  } catch { showToast('Anslutningsfel', 'error'); }
}

// ── Client purchase history ──
async function openClientPurchases() {
  if (!currentClientId) return;
  const c = clients.find(x => x.id === currentClientId);
  document.getElementById('purchases-sheet-title').textContent =
    `Köphistorik — ${c?.admin_label || c?.display_name || ''}`;
  const body = document.getElementById('purchases-sheet-body');
  body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">Laddar…</div>';
  document.getElementById('client-purchases-sheet').classList.add('open');
  try {
    const r = await api(`/api/sales/client/${currentClientId}`);
    const d = await r.json();
    const sales = d.sales || [];
    if (!sales.length) {
      body.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text3);font-size:14px">Inga köp ännu</div>';
      return;
    }
    body.innerHTML = sales.map(sale => {
      const date = new Date(sale.created_at).toLocaleDateString('sv-SE', { day: '2-digit', month: 'short', year: 'numeric' });
      const saleTotal = (sale.sale_items || []).reduce((s, i) => s + (parseFloat(i.sell_price) || 0) * (i.qty || 1), 0);
      const itemRows = (sale.sale_items || []).map(item => `
        <div class="purchase-row">
          ${item.image
            ? `<img class="purchase-row-img" src="${item.image}" alt="">`
            : `<div class="purchase-row-img"></div>`}
          <div class="purchase-row-info">
            <div class="purchase-row-name">${esc(item.name)}${item.qty > 1 ? ` ×${item.qty}` : ''}</div>
            ${item.ref_code ? `<div class="purchase-row-meta">${esc(item.ref_code)}</div>` : ''}
          </div>
          <div class="purchase-row-price">${item.sell_price != null ? `€ ${item.sell_price}` : '—'}</div>
        </div>`).join('');
      return `<div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0 4px;border-top:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:600;color:var(--text3)">
              ${date}${sale.invoice_number ? ` · #${esc(sale.invoice_number)}` : ''}
              ${(sale.sale_items||[]).length > 1 ? ` · € ${saleTotal.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})}` : ''}
            </span>
            ${saleStatusBadge(sale.status || 'unpaid')}
          </div>
          <button onclick="deleteSale('${sale.id}', openClientPurchases)" style="background:none;border:none;color:#ff7a7a;font-size:14px;cursor:pointer;padding:0 0 0 8px;line-height:1" title="Ta bort">✕</button>
        </div>
        ${itemRows}
      </div>`;
    }).join('');
  } catch {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">Kunde inte hämta köphistorik</div>';
  }
}

function closeClientPurchases() {
  document.getElementById('client-purchases-sheet').classList.remove('open');
}
