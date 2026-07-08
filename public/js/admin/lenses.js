// ── Lens form state ──
let lensFormItemId = null;
let lensFormImage = undefined; // image URL (undefined = unchanged on edit)
let lensFormImageBlob = null;  // freshly picked image, uploaded on save
let _lensVariantRows = [];

// ── Tab toggle ──
function switchLagerTab(tab) {
  activeInvTab = tab;
  document.getElementById('lager-tab-glasses').classList.toggle('active', tab === 'glasses');
  document.getElementById('lager-tab-lenses').classList.toggle('active', tab === 'lenses');
  document.getElementById('inv-cat-glasses').style.display = tab === 'glasses' ? '' : 'none';
  document.getElementById('inv-cat-lenses').style.display  = tab === 'lenses'  ? '' : 'none';
  updateSaleCartBadge();
  if (tab === 'glasses') loadInventory();
  else loadLenses();
}

// ── Load & render ──
async function loadLenses() {
  const grid = document.getElementById('inv-grid');
  grid.innerHTML = '<div class="inv-empty" style="grid-column:1/-1">Laddar…</div>';
  const r = await api('/api/lenses');
  if (!r.ok) { grid.innerHTML = '<div class="inv-empty" style="grid-column:1/-1">Kunde inte hämta linser</div>'; return; }
  const d = await r.json();
  lensesMap = {};
  (d.lenses || []).forEach(l => { lensesMap[l.id] = l; });
  renderLenses(d.lenses || []);
}

function renderLenses(items) {
  const grid = document.getElementById('inv-grid');
  if (!items.length) { grid.innerHTML = '<div class="inv-empty" style="grid-column:1/-1">Inga linser ännu</div>'; return; }
  grid.innerHTML = items.map(lens => {
    const vars = lens.lens_variants || [];
    const chips = vars.map(v =>
      `<span class="lens-var-chip">${esc(v.color_name)} <b>${v.stock_count}</b></span>`
    ).join('');
    return `<div class="inv-card">
      ${lens.image
        ? `<img class="inv-card-img" src="${lens.image}" alt="${esc(lens.name)}" loading="lazy">`
        : `<div class="inv-card-img-ph">Ingen bild</div>`}
      <div class="inv-card-body">
        ${lens.ref_code ? `<div class="inv-card-ref">${esc(lens.ref_code)}</div>` : ''}
        <div class="inv-card-name">${esc(lens.name)}</div>
        ${lens.sell_price != null ? `<div class="inv-card-price">€ ${esc(String(lens.sell_price))}</div>` : ''}
        ${chips ? `<div class="lens-var-chips">${chips}</div>` : ''}
        <div class="inv-card-actions">
          <button class="inv-edit-btn" onclick="openLensForm('${lens.id}')">Redigera</button>
          <button class="inv-del-btn" onclick="deleteLensItem('${lens.id}')" title="Ta bort">🗑</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── CRUD ──
function openLensForm(lensId) {
  lensFormItemId = lensId || null;
  lensFormImage = undefined;
  lensFormImageBlob = null;
  _lensVariantRows = [];
  const lens = lensId ? lensesMap[lensId] : null;
  document.getElementById('lens-form-title').textContent = lens ? 'Redigera lins' : 'Ny lins';
  document.getElementById('lensf-name').value  = lens?.name || '';
  document.getElementById('lensf-ref').value   = lens?.ref_code || '';
  document.getElementById('lensf-sell').value  = lens?.sell_price ?? '';
  document.getElementById('lensf-buy').value   = lens?.buy_price ?? '';
  document.getElementById('lensf-notes').value = lens?.notes || '';
  const pick = document.getElementById('lens-img-pick');
  const existing = pick.querySelector('img.inv-preview-img');
  if (existing) existing.remove();
  if (lens?.image) {
    const img = document.createElement('img');
    img.className = 'inv-preview-img';
    img.src = lens.image;
    pick.appendChild(img);
  }
  document.getElementById('lens-img-input').value = '';
  document.getElementById('lens-variants-list').innerHTML = '';
  (lens?.lens_variants || []).forEach(v => _addLensVariantRow(v.color_name, v.stock_count));
  document.getElementById('lens-form-modal').classList.add('open');
}

function closeLensForm() {
  document.getElementById('lens-form-modal').classList.remove('open');
  lensFormItemId = null;
  lensFormImage = undefined;
  lensFormImageBlob = null;
  _lensVariantRows = [];
}

function handleLensImg(input) {
  const file = input.files[0];
  if (!file) return;
  compressInvImage(file, (blob, previewUrl) => {
    lensFormImageBlob = blob;
    const pick = document.getElementById('lens-img-pick');
    let img = pick.querySelector('img.inv-preview-img');
    if (!img) { img = document.createElement('img'); img.className = 'inv-preview-img'; pick.appendChild(img); }
    img.src = previewUrl;
  });
}

function _addLensVariantRow(colorName = '', stockCount = 0) {
  const rowId = 'lvr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  const div = document.createElement('div');
  div.className = 'lens-variant-row';
  div.id = rowId;
  div.innerHTML = `
    <input class="inv-input lens-var-color" placeholder="Färg (t.ex. Blå)" value="${esc(colorName)}">
    <input class="inv-input lens-var-stock" type="number" min="0" inputmode="numeric" value="${stockCount}" placeholder="Antal">
    <button onclick="removeLensVariantRow('${rowId}')" class="lens-var-rm">✕</button>`;
  _lensVariantRows.push({ rowId, div });
  document.getElementById('lens-variants-list').appendChild(div);
}

function addLensVariantRow() { _addLensVariantRow(); }

function removeLensVariantRow(rowId) {
  _lensVariantRows = _lensVariantRows.filter(r => r.rowId !== rowId);
  const el = document.getElementById(rowId);
  if (el) el.remove();
}

async function saveLensItem() {
  const name = document.getElementById('lensf-name').value.trim();
  if (!name) { document.getElementById('lensf-name').focus(); return; }
  const variants = _lensVariantRows.map(r => ({
    color_name:  r.div.querySelector('.lens-var-color').value.trim(),
    stock_count: parseInt(r.div.querySelector('.lens-var-stock').value) || 0
  })).filter(v => v.color_name);
  const body = {
    name,
    ref_code:   document.getElementById('lensf-ref').value.trim() || null,
    sell_price: parseFloat(document.getElementById('lensf-sell').value) || null,
    buy_price:  parseFloat(document.getElementById('lensf-buy').value) || null,
    notes:      document.getElementById('lensf-notes').value.trim() || null,
    variants
  };
  const btn = document.querySelector('#lens-form-modal .inv-gen-btn');
  btn.disabled = true;

  // A freshly picked image is uploaded to storage first; the row stores its URL
  if (lensFormImageBlob) {
    btn.textContent = 'Laddar upp bild…';
    const url = await uploadProductImage(lensFormImageBlob);
    if (!url) {
      showToast('Bilduppladdningen misslyckades — linsen sparades inte', 'error');
      btn.textContent = 'Spara'; btn.disabled = false;
      return;
    }
    lensFormImage = url;
    lensFormImageBlob = null;
  }
  if (lensFormImage !== undefined) body.image = lensFormImage;

  btn.textContent = 'Sparar…';
  const r = lensFormItemId
    ? await api(`/api/lenses/${lensFormItemId}`, { method: 'PATCH', body: JSON.stringify(body) })
    : await api('/api/lenses', { method: 'POST', body: JSON.stringify(body) });
  btn.textContent = 'Spara'; btn.disabled = false;
  if (!r.ok) { showToast('Kunde inte spara linsen', 'error'); return; }
  closeLensForm();
  loadLenses();
}

async function deleteLensItem(id) {
  if (!confirm('Ta bort denna lins permanent?')) return;
  const r = await api(`/api/lenses/${id}`, { method: 'DELETE' });
  if (!r.ok) { showToast('Kunde inte ta bort linsen', 'error'); return; }
  delete lensesMap[id];
  loadLenses();
}

// ── Lens catalog PDF ──
async function generateLensCatalogPDF() {
  const items = Object.values(lensesMap);
  if (!items.length) { showToast('Inga linser i lager', 'error'); return; }
  const btn = document.getElementById('lens-cat-pdf-btn');
  btn.textContent = 'Genererar…'; btn.disabled = true;
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  try {
    const doc = await _buildLensCatalogDoc(items);
    const today = new Date().toLocaleDateString('sv-SE').replace(/\//g, '-');
    doc.save(`lins-katalog-${today}.pdf`);
    showToast('Katalog skapad', 'success');
  } catch (e) {
    showToast('PDF-fel: ' + e.message, 'error');
  } finally {
    btn.textContent = 'Katalog PDF'; btn.disabled = false;
  }
}

function showLensCatalogClientPicker() {
  const items = Object.values(lensesMap);
  if (!items.length) { showToast('Inga linser i lager', 'error'); return; }
  const list = document.getElementById('cat-picker-list');
  const active = clients.filter(c => !c.is_inactive);
  list.innerHTML = !active.length
    ? '<div style="padding:20px;text-align:center;color:var(--text3);font-size:14px">Inga aktiva klienter</div>'
    : active.map(c => `
      <div style="display:flex;align-items:center;padding:14px 16px;gap:12px;border-bottom:1px solid var(--border);cursor:pointer" onclick="sendLensCatalogToClient('${c.id}')">
        <div>
          <div style="font-size:15px;font-weight:500">${esc(c.admin_label || c.display_name)}</div>
          ${c.admin_label ? `<div style="font-size:12px;color:var(--text3)">${esc(c.display_name)}</div>` : ''}
        </div>
      </div>`).join('');
  document.getElementById('cat-picker-modal').classList.add('open');
}

async function sendLensCatalogToClient(clientId) {
  closeCatalogClientPicker();
  const items = Object.values(lensesMap);
  if (!items.length) return;
  showToast('Genererar och skickar katalog…', 'success');
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  try {
    const doc = await _buildLensCatalogDoc(items);
    const blob = doc.output('blob');
    const form = new FormData();
    form.append('files', blob, 'lins-katalog.pdf');
    const up = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    if (!up.ok) { showToast('Uppladdning misslyckades', 'error'); return; }
    const ud = await up.json();
    const pdfUrl = ud.files?.[0]?.url;
    if (!pdfUrl) { showToast('Ingen URL från uppladdning', 'error'); return; }
    const r = await api(`/api/messages/${clientId}`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Vision Palace – Linskatalog', message_type: 'pdf', metadata: { url: pdfUrl } })
    });
    if (r.ok) {
      const d = await r.json();
      if (currentClientId === clientId) appendMsg(d.message);
      showToast('Katalog skickad', 'success');
    } else {
      showToast('Kunde inte skicka katalogen', 'error');
    }
  } catch (e) {
    showToast('Fel: ' + e.message, 'error');
  }
}

async function _buildLensCatalogDoc(items) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setProperties({ title: 'Vision Palace – Linskatalog', creator: 'Vision Palace' });
  const PW = 210, PH = 297, M = 14, COLS = 2, CGAP = 6, RGAP = 6;
  const CW = (PW - M * 2 - CGAP) / COLS;
  const IH = 65, TH = 32, CH = IH + TH;
  const IMG_SZ = IH, IMG_X_OFF = (CW - IH) / 2;

  const drawHeader = (first) => {
    if (first) {
      doc.setFont('times', 'italic'); doc.setFontSize(21); doc.setTextColor(26, 26, 26);
      doc.text('Vision Palace', PW / 2, M + 7, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(160, 160, 160);
      doc.text('L  I  N  S  K  A  T  A  L  O  G', PW / 2, M + 13, { align: 'center' });
      doc.text(new Date().toLocaleDateString('sv-SE'), PW / 2, M + 18, { align: 'center' });
      doc.setDrawColor(221, 217, 209); doc.setLineWidth(0.25);
      doc.line(M, M + 22, PW - M, M + 22);
      return M + 27;
    } else {
      doc.setFont('times', 'italic'); doc.setFontSize(9); doc.setTextColor(190, 185, 175);
      doc.text('Vision Palace', PW / 2, M + 4, { align: 'center' });
      doc.setDrawColor(221, 217, 209); doc.setLineWidth(0.2);
      doc.line(M, M + 6, PW - M, M + 6);
      return M + 11;
    }
  };

  let y = drawHeader(true), col = 0;
  for (const lens of items) {
    if (y + CH > PH - M) { doc.addPage(); y = drawHeader(false); col = 0; }
    const x = M + col * (CW + CGAP);
    doc.setFillColor(255, 255, 255); doc.rect(x, y, CW, IH, 'F');
    const imgData = await imgToDataUrl(lens.image);
    if (imgData) {
      try {
        const fmt = imgData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(imgData, fmt, x + IMG_X_OFF, y, IMG_SZ, IMG_SZ, undefined, 'NONE');
      } catch { /* keep background */ }
    }
    doc.setDrawColor(221, 217, 209); doc.setLineWidth(0.2); doc.rect(x, y, CW, CH);
    doc.line(x, y + IH, x + CW, y + IH);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(171, 171, 171);
    doc.text(String(lens.ref_code || '').toUpperCase(), x + 4, y + IH + 5.5);
    doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(26, 26, 26);
    const ns = doc.splitTextToSize(lens.name, CW - 8);
    doc.text(ns[0] + (ns.length > 1 ? '…' : ''), x + 4, y + IH + 13);
    doc.setFontSize(12);
    doc.text(lens.sell_price != null ? `€ ${Number(lens.sell_price).toLocaleString('sv-SE')}` : '—', x + 4, y + IH + 21);
    const vars = (lens.lens_variants || []).map(v => `${v.color_name} ×${v.stock_count}`).join('  ');
    if (vars) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120, 115, 105);
      const vs = doc.splitTextToSize(vars, CW - 8);
      doc.text(vs[0] + (vs.length > 1 ? '…' : ''), x + 4, y + IH + 28);
    }
    col++; if (col >= COLS) { col = 0; y += CH + RGAP; }
  }

  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(180, 180, 180);
    doc.text(`${p} / ${total}`, PW / 2, PH - 6, { align: 'center' });
  }
  return doc;
}

// ── Sale modal — lens section ──
async function renderSaleLensList() {
  const list = document.getElementById('sale-lens-list');
  if (!list) return;
  if (!Object.keys(lensesMap).length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:10px 0">Laddar linser…</div>';
    const r = await api('/api/lenses');
    if (r.ok) {
      const d = await r.json();
      lensesMap = {};
      (d.lenses || []).forEach(l => { lensesMap[l.id] = l; });
    }
  }
  const lenses = Object.values(lensesMap);
  if (!lenses.length) {
    list.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:10px 0">Inga linser i lager</div>';
    return;
  }
  list.innerHTML = lenses.map(lens => {
    const vars = lens.lens_variants || [];
    if (!vars.length) return '';
    const varBtns = vars.map(v => {
      const key = `${lens.id}-${v.id}`;
      const inCart = lensCartItems.some(i => i.id === key);
      return `<button class="lens-sale-chip${inCart ? ' active' : ''}"
        onclick="${inCart ? `removeLensFromCart('${key}')` : `addLensToCart('${lens.id}','${v.id}')`}">
        ${esc(v.color_name)}<span class="lens-sale-chip-stock">×${v.stock_count}</span>
      </button>`;
    }).join('');
    return `<div class="sale-inv-item lens-sale-row">
      ${lens.image ? `<img class="sale-item-img" src="${lens.image}" alt="">` : `<div class="sale-item-img"></div>`}
      <div style="flex:1;min-width:0">
        <div class="sale-item-name">${esc(lens.name)}</div>
        <div class="sale-item-price">${lens.sell_price != null ? `€ ${lens.sell_price}` : '—'}</div>
        <div class="lens-sale-chips">${varBtns}</div>
      </div>
    </div>`;
  }).filter(Boolean).join('');
}

function addLensToCart(lensId, variantId) {
  const lens = lensesMap[lensId];
  if (!lens) return;
  const variant = (lens.lens_variants || []).find(v => v.id === variantId);
  if (!variant) return;
  const key = `${lensId}-${variantId}`;
  const existing = lensCartItems.find(i => i.id === key);
  if (existing) existing.qty++;
  else lensCartItems.push({
    id: key, lensId, variantId,
    name: lens.name, color: variant.color_name,
    sell_price: lens.sell_price, buy_price: lens.buy_price,
    qty: 1, image: lens.image || null
  });
  renderSaleCart();
  renderSaleLensList();
}

function removeLensFromCart(key) {
  lensCartItems = lensCartItems.filter(i => i.id !== key);
  renderSaleCart();
  renderSaleLensList();
}

function updateLensQty(key, delta) {
  const item = lensCartItems.find(i => i.id === key);
  if (!item) return;
  item.qty = Math.max(1, item.qty + delta);
  renderSaleCart();
}
