// ── Sale cart ──
let saleCartItems = []; // { id, name, ref_code, sell_price, qty, image }
let _lastSaleClientId = null;
let _lastSaleBuyerName = '';
let _lastSaleItems = null;
let _saleHistoryCache = {};

// En korgrad är en modell, och den bär med sig de faktiska lagerraderna
// (ids) den tagit ur högen. Antalet är alltid ids.length — det är så tre
// sålda par också blir tre par borta ur lagret.
function nextFreeInGroup(key) {
  const g = invGroups[key];
  if (!g) return null;
  const taken = new Set(saleCartItems.find(i => i.id === key)?.ids || []);
  return g.ids.find(id => !taken.has(id)) || null;
}

function addToSaleCartFromCard(key) {
  const g = invGroups[key];
  if (!g) return;
  const id = nextFreeInGroup(key);
  if (!id) { showToast(`Du har redan valt alla ${g.count} i lager`, 'error'); return; }
  let entry = saleCartItems.find(i => i.id === key);
  if (!entry) {
    entry = {
      id: key, ids: [], qty: 0,
      name: g.name, ref_code: g.ref_code,
      sell_price: g.sell_price, buy_price: g.buy_price, image: g.image,
    };
    saleCartItems.push(entry);
  }
  entry.ids.push(id);
  entry.qty = entry.ids.length;
  updateSaleCartBadge();
  showToast(`${g.name} tillagd i försäljning${entry.qty > 1 ? ` (${entry.qty} st)` : ''}`, 'success');
}

function updateSaleCartBadge() {
  const total = saleCartItems.reduce((s, i) => s + i.qty, 0) + lensCartItems.reduce((s, i) => s + i.qty, 0);
  const btn = document.getElementById('inv-sell-open-btn');
  const badge = document.getElementById('sale-cart-badge');
  const shown = total > 0 || activeInvTab === 'lenses';
  btn.style.display = shown ? '' : 'none';
  badge.textContent = total > 0 ? total : '';
  // Plusknappen får inte hamna under säljstapeln
  document.getElementById('inv-fab')?.classList.toggle('raised', shown);
}

function openSaleModal(groupKey) {
  if (groupKey && invGroups[groupKey] && !saleCartItems.find(i => i.id === groupKey)) {
    addToSaleCartFromCard(groupKey);
  }
  const sel = document.getElementById('sale-client-pick');
  sel.innerHTML = '<option value="">Välj klient…</option>' +
    clients.filter(c => !c.is_inactive).map(c =>
      `<option value="${c.id}">${esc(c.admin_label || c.display_name)}</option>`
    ).join('') +
    '<option value="__walkin">Kund utanför appen…</option>';
  sel.value = '';
  const walkin = document.getElementById('sale-walkin-name');
  if (walkin) walkin.value = '';
  onSaleBuyerChange();
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

function updateSaleQty(key, delta) {
  const entry = saleCartItems.find(i => i.id === key);
  if (!entry) return;
  if (delta > 0) {
    const id = nextFreeInGroup(key);
    // Går aldrig att sälja fler än vad som faktiskt står i lagret
    if (!id) { showToast(`Det finns bara ${invGroups[key]?.count ?? entry.qty} i lager`, 'error'); return; }
    entry.ids.push(id);
  } else {
    if (entry.ids.length <= 1) return;
    entry.ids.pop();
  }
  entry.qty = entry.ids.length;
  renderSaleCart();
  renderSaleInvList();
  updateSaleCartBadge();
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
  const groups = Object.values(invGroups);
  if (!groups.length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:10px 0">Lagret är tomt</div>';
    return;
  }
  list.innerHTML = groups.map(g => {
    const chosen = saleCartItems.find(i => i.id === g.key)?.qty || 0;
    const left = g.count - chosen;
    return `<div class="sale-inv-item">
      ${g.image
        ? `<img class="sale-item-img" src="${g.image}" alt="">`
        : `<div class="sale-item-img"></div>`}
      <div class="sale-item-info" style="flex:1;min-width:0">
        <div class="sale-item-name">${esc(g.name)}${g.count > 1 ? ` <span style="color:var(--text3);font-size:11px">${g.count} st</span>` : ''}</div>
        <div class="sale-item-price">${g.sell_price != null ? `€ ${g.sell_price}` : '—'}${chosen ? ` · ${chosen} vald${chosen > 1 ? 'a' : ''}` : ''}</div>
      </div>
      ${left > 0
        ? `<button class="sale-inv-add" onclick="addToSaleCartFromModal('${g.key}')">+</button>`
        : `<span style="color:var(--blue);font-size:12px;font-weight:700;flex-shrink:0">✓ Alla</span>`}
    </div>`;
  }).join('');
}

function addToSaleCartFromModal(key) {
  addToSaleCartFromCard(key);
  renderSaleCart();
  renderSaleInvList();
}

function onSaleBuyerChange() {
  const walkin = document.getElementById('sale-client-pick').value === '__walkin';
  const box = document.getElementById('sale-walkin');
  if (box) box.style.display = walkin ? '' : 'none';
  if (walkin) document.getElementById('sale-walkin-name')?.focus();
}

async function createSale() {
  const picked = document.getElementById('sale-client-pick').value;
  const isWalkin = picked === '__walkin';
  const clientId = isWalkin ? '' : picked;
  const walkinName = (document.getElementById('sale-walkin-name')?.value || '').trim();
  if (!clientId && !isWalkin) { showToast('Välj en köpare', 'error'); return; }
  if (isWalkin && !walkinName) { showToast('Skriv namnet på köparen', 'error'); return; }
  if (!saleCartItems.length && !lensCartItems.length) { showToast('Inga varor valda', 'error'); return; }
  const btn = document.querySelector('#sale-modal .inv-gen-btn');
  btn.textContent = 'Skapar…'; btn.disabled = true;
  try {
    const shipping = parseFloat(document.getElementById('sale-shipping')?.value) || 0;
    // No image in the payload — the server copies it from the DB row.
    // Legacy items carry base64 images; sending those made the request
    // multi-MB and the sale appeared to hang on "Skapar…" over mobile.
    const glassItems = saleCartItems.map(i => ({
      // Alla utpekade par följer med, så servern tar bort exakt dem ur lagret
      inventory_ids: i.ids,
      inventory_id: i.ids[0],
      name: i.name, ref_code: i.ref_code || null,
      sell_price: i.sell_price ?? null, buy_price: i.buy_price ?? null,
      qty: i.ids.length
    }));
    const lensItems = lensCartItems.map(i => ({
      lens_id: i.lensId, lens_variant_id: i.variantId, lens_color: i.color,
      name: `${i.name} (${i.color})`,
      sell_price: i.sell_price ?? null, buy_price: i.buy_price ?? null,
      qty: i.qty
    }));
    const items = [...glassItems, ...lensItems];
    if (shipping > 0) items.push({ name: 'Frakt', ref_code: null, sell_price: shipping, qty: 1, image: null });
    let r = null;
    try {
      r = await api('/api/sales', {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId || null, customer_name: isWalkin ? walkinName : null, items }),
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(30000) : undefined
      });
    } catch (e) {
      // No reply (timeout or dropped connection). The sale may still have
      // been created server-side — verify before showing an error, so the
      // user never creates the same sale twice.
      btn.textContent = 'Kontrollerar…';
      const created = await verifySaleCreated(clientId, walkinName, saleItemsSummary(items));
      if (!created) {
        showToast('Fick inget svar från servern. Kontrollera i Historik om försäljningen skapades innan du försöker igen.', 'error');
        return;
      }
    }
    if (r && !r.ok) { const d = await r.json().catch(() => ({})); showToast(d.error || 'Fel vid skapande av försäljning', 'error'); return; }
    // The sale IS created at this point — a UI hiccup below must never
    // masquerade as a failed sale
    try { finishSaleUI(clientId, shipping, isWalkin ? walkinName : ''); }
    catch (e) {
      console.error('UI-uppdatering efter sälj misslyckades:', e);
      closeSaleModal();
      showSaleSuccessBanner();
    }
  } catch { showToast('Anslutningsfel', 'error'); }
  finally { btn.textContent = 'Skapa försäljning'; btn.disabled = false; }
}

// One line per item, order-independent — used to recognise "our" sale when
// the POST got no reply and we have to check whether it landed anyway
function saleItemsSummary(items) {
  return items.map(i => `${i.name}×${i.qty || 1}`).sort().join('|');
}

async function verifySaleCreated(clientId, buyerName, sentSummary) {
  try {
    // Utan klient finns ingen klientlista att titta i — då får hela listan
    // gås igenom och köparens namn avgöra
    const r = await api(clientId ? `/api/sales/client/${clientId}` : '/api/sales');
    if (!r.ok) return false;
    const d = await r.json();
    return (d.sales || []).some(s =>
      Date.now() - new Date(s.created_at) < 10 * 60 * 1000 &&
      (clientId || (s.customer_name || '').trim() === buyerName) &&
      saleItemsSummary(s.sale_items || []) === sentSummary
    );
  } catch { return false; }
}

// Success path: clear the cart, update inventory UI and show the banner
function finishSaleUI(clientId, shipping, buyerName) {
  _lastSaleClientId = clientId;
  _lastSaleBuyerName = buyerName || '';
  _lastSaleItems = [
    ...saleCartItems,
    ...lensCartItems.map(i => ({ ...i, name: `${i.name} (${i.color})` })),
    ...(shipping > 0 ? [{ name: 'Frakt', sell_price: shipping, qty: 1 }] : [])
  ];
  const soldInvIds = saleCartItems.flatMap(i => i.ids || []);
  const soldLenses = lensCartItems.length > 0;
  saleCartItems = [];
  lensCartItems = [];
  // Update inventory UI immediately (the socket event does the same for other admins)
  soldInvIds.forEach(id => delete invItemsMap[id]);
  if (activeInvTab === 'glasses') renderInventory(Object.values(invItemsMap));
  else if (soldLenses) loadLenses();
  renderSaleInvList();
  updateSaleCartBadge();
  closeSaleModal();
  showSaleSuccessBanner();
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
  fillBtn.onclick = () => { fillInvoiceFromSale(_lastSaleClientId, _lastSaleItems, null, _lastSaleBuyerName); t.remove(); };
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

function fillInvoiceFromSale(clientId, items, invoiceNumber, buyerName) {
  switchTab('invoice');
  populateInvClientPicker();
  setTimeout(() => {
    const sel = document.getElementById('inv-client-pick');
    sel.value = clientId || '';
    fillInvClient(clientId);
    // Köpare utanför appen har ingen klientpost — då är namnet allt vi har
    if (!clientId && buyerName) {
      const nameEl = document.getElementById('inv-cust-name');
      if (nameEl) nameEl.value = buyerName;
    }
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
  fillInvoiceFromSale(sale.client_id, sale.sale_items || [], sale.invoice_number, sale.customer_name);
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
    // Marking a sale paid moves its commission from pending into the balance
    if (typeof loadSettlement === 'function') loadSettlement();
    // The moment payment is confirmed is the natural moment to attach the
    // receipt — offer it right away instead of relying on remembering later
    if (newStatus === 'paid' && typeof openPaymentModal === 'function') {
      openPaymentModal(saleId, sid);
    }
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
        // Sälj utan klient bär köparens namn direkt på raden
        const clientName = sale.clients?.admin_label || sale.clients?.display_name
          || (sale.customer_name ? `${esc(sale.customer_name)} <span style="color:var(--text3);font-size:11px">· utanför appen</span>` : '—');
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
          <div onclick="toggleSaleDetail('${sid}','${sale.id}')" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;cursor:pointer">
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
            <div id="pay-${sid}" style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              <button onclick="event.stopPropagation();openSaleInvoice('${sale.id}')" style="background:none;border:1px solid rgba(100,150,255,.3);border-radius:8px;color:#7aabff;font-size:13px;padding:6px 12px;cursor:pointer;font-family:inherit">Faktura</button>
              <button onclick="event.stopPropagation();deleteSale('${sale.id}', loadSalesHistory)" style="background:none;border:1px solid rgba(255,100,100,.3);border-radius:8px;color:#ff7a7a;font-size:13px;padding:6px 12px;cursor:pointer;font-family:inherit">Ta bort försäljning</button>
            </div>
          </div>
        </div>`;
      }).join('');
      return `<div style="margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
          <div style="font-size:13px;font-weight:700;color:var(--text2);text-transform:capitalize">${monthName}</div>
          <div style="font-size:12px;color:var(--text3)">€ ${revenue.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})} · vinst € ${profit.toLocaleString('sv-SE',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <button onclick="exportBookkeeping('${key}')" style="background:none;border:none;color:#7aabff;font-size:12px;padding:0 0 10px;cursor:pointer;font-family:inherit">Exportera bokföring — hela bolaget →</button>
        ${saleRows}
      </div>`;
    }).join('');
  } catch { listEl.innerHTML = '<div style="color:#ff7a7a;text-align:center;padding:40px 0">Fel vid laddning</div>'; }
}

// Bookkeeping export for one month. Delivered through the share sheet on
// mobile — a plain download link lands somewhere hard to find in an iOS PWA.
async function exportBookkeeping(month) {
  showToast('Skapar underlag…', 'ok');
  try {
    const r = await api(`/api/export/bookkeeping?month=${month}`);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.error || 'Kunde inte skapa exporten', 'error');
      return;
    }
    const blob = await r.blob();
    const name = `bokforing-${month}.csv`;
    const file = new File([blob], name, { type: 'text/csv' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch { showToast('Anslutningsfel', 'error'); }
}

function toggleSaleDetail(sid, saleId) {
  const detail = document.getElementById('detail-' + sid);
  const chev = document.getElementById('chev-' + sid);
  if (!detail) return;
  const open = detail.style.display === 'none';
  detail.style.display = open ? 'block' : 'none';
  if (chev) chev.style.transform = open ? 'rotate(180deg)' : '';
  // Payments load on first expand — keeps them off the list payload and means
  // a missing sale_payments table can't take the whole history down
  if (open && saleId && !loadedPayments.has(sid)) loadSalePayments(saleId, sid);
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
