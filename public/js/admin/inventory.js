async function loadInventory() {
  const grid = document.getElementById('inv-grid');
  grid.innerHTML = '<div class="inv-empty" style="grid-column:1/-1">Laddar…</div>';
  const r = await api('/api/inventory');
  if (!r.ok) { grid.innerHTML = '<div class="inv-empty" style="grid-column:1/-1">Kunde inte hämta lager</div>'; return; }
  const d = await r.json();
  renderInventory(d.items || []);
}

// Lagret har en rad per fysiskt par — köper man in tre av samma modell blir
// det tre rader. Raderna ligger kvar som de är (varje par har sitt eget
// inköpspris och sin egen rad i inköpsloggen), men de visas som ETT kort med
// antal, annars blir både lagret och katalogen full av dubbletter.
function invGroupKey(item) {
  const ref = String(item.ref_code || '').trim().toUpperCase();
  return ref ? `ref:${ref}` : `namn:${String(item.name || '').trim().toLowerCase()}`;
}

// items kommer nyast först, så det första paret i varje hög får representera den
function buildInvGroups(items) {
  const groups = {};
  for (const item of items) {
    const key = invGroupKey(item);
    if (!groups[key]) {
      groups[key] = {
        key, ids: [], items: [],
        name: item.name, ref_code: item.ref_code,
        sell_price: item.sell_price, buy_price: item.buy_price, image: item.image,
      };
    }
    const g = groups[key];
    g.ids.push(item.id);
    g.items.push(item);
    if (!g.image && item.image) g.image = item.image;
  }
  for (const g of Object.values(groups)) {
    g.count = g.ids.length;
    g.mixedPrice = g.items.some(i => String(i.sell_price ?? '') !== String(g.sell_price ?? ''));
  }
  return groups;
}

function renderInventory(items) {
  const grid = document.getElementById('inv-grid');
  invItemsMap = {};
  if (!items.length) {
    invGroups = {};
    grid.innerHTML = '<div class="inv-empty" style="grid-column:1/-1">Lagret är tomt</div>';
    return;
  }
  items.forEach(item => { invItemsMap[item.id] = item; });
  invGroups = buildInvGroups(items);
  grid.innerHTML = Object.values(invGroups).map(g => `
    <div class="inv-card">
      <div style="position:relative">
        ${g.image
          ? `<img class="inv-card-img" src="${g.image}" alt="${esc(g.name)}" loading="lazy">`
          : `<div class="inv-card-img-ph">Ingen bild</div>`}
        ${g.count > 1 ? `<span class="inv-count-badge">${g.count} st</span>` : ''}
      </div>
      <div class="inv-card-body">
        ${g.ref_code ? `<div class="inv-card-ref">${esc(g.ref_code)}</div>` : ''}
        <div class="inv-card-name">${esc(g.name)}</div>
        ${g.sell_price != null ? `<div class="inv-card-price">€ ${esc(String(g.sell_price))}</div>` : ''}
        ${g.mixedPrice ? `<div class="inv-card-warn">Olika säljpris på exemplaren — visar det senaste</div>` : ''}
        <!-- Sälj är det man gör hela dagen; redigera och ta bort ligger under
             prickarna så att den röda papperskorgen inte sitter bredvid -->
        <div class="inv-card-actions">
          <button class="inv-sell-btn" onclick="addToSaleCartFromCard('${g.key}')">+ Sälj</button>
          <button class="inv-card-more" onclick="openCardMenu('glasses','${g.key}')" aria-label="Fler val">···</button>
        </div>
      </div>
    </div>`).join('');
}

// ── Inventory CRUD ──
let invFormItemId = null;
let invFormGroupIds = null; // alla exemplar av modellen, när kortet öppnades från en hög
let invFormImage = null; // image URL or null (undefined = unchanged on edit)
let invFormImageBlob = null; // freshly picked image, uploaded on save
let _refLookupLast = '';

function openInvForm(itemId, groupKey) {
  invFormItemId = itemId;
  invFormGroupIds = groupKey ? (invGroups[groupKey]?.ids || null) : null;
  invFormImage = undefined;
  invFormImageBlob = null;
  _refLookupLast = '';
  const item = itemId ? invItemsMap[itemId] : null;
  document.getElementById('inv-form-title').textContent = !item ? 'Ny vara'
    : invFormGroupIds && invFormGroupIds.length > 1 ? `Redigera vara · ${invFormGroupIds.length} exemplar`
      : 'Redigera vara';
  document.getElementById('invf-name').value = item?.name || '';
  document.getElementById('invf-ref').value = item?.ref_code || '';
  document.getElementById('invf-sell').value = item?.sell_price ?? '';
  document.getElementById('invf-buy').value = item?.buy_price ?? '';
  document.getElementById('invf-notes').value = item?.notes || '';
  // Show existing image or placeholder
  const pick = document.getElementById('inv-img-pick');
  const existing = pick.querySelector('img.inv-preview-img');
  if (existing) existing.remove();
  if (item?.image) {
    const img = document.createElement('img');
    img.className = 'inv-preview-img';
    img.src = item.image;
    pick.appendChild(img);
  }
  document.getElementById('inv-img-input').value = '';
  document.getElementById('inv-form-modal').classList.add('open');
}

// Autofill name/price/image from a previously used ref code (new items only)
async function lookupRefCode() {
  if (invFormItemId) return; // never overwrite an existing item being edited
  const code = document.getElementById('invf-ref').value.trim();
  if (!code || code === _refLookupLast) return;
  _refLookupLast = code;
  try {
    const r = await api(`/api/inventory/ref-lookup?code=${encodeURIComponent(code)}`);
    if (!r.ok) return;
    const d = await r.json();
    const m = d.match;
    if (!m) return;
    const nameEl = document.getElementById('invf-name');
    const sellEl = document.getElementById('invf-sell');
    const buyEl = document.getElementById('invf-buy');
    if (!nameEl.value.trim() && m.name) nameEl.value = m.name;
    if (!sellEl.value && m.sell_price != null) sellEl.value = m.sell_price;
    if (!buyEl.value && m.buy_price != null) buyEl.value = m.buy_price;
    if (invFormImage === undefined && !invFormImageBlob && m.image) {
      invFormImage = m.image;
      const pick = document.getElementById('inv-img-pick');
      let img = pick.querySelector('img.inv-preview-img');
      if (!img) { img = document.createElement('img'); img.className = 'inv-preview-img'; pick.appendChild(img); }
      img.src = m.image;
    }
    showToast('Produktdata hämtad från ref-kod', 'success');
  } catch { /* lookup is best-effort */ }
}

function closeInvForm() {
  document.getElementById('inv-form-modal').classList.remove('open');
  invFormItemId = null;
  invFormGroupIds = null;
  invFormImage = undefined;
  invFormImageBlob = null;
}

function handleInvImg(input) {
  const file = input.files[0];
  if (!file) return;
  compressInvImage(file, (blob, previewUrl) => {
    invFormImageBlob = blob;
    const pick = document.getElementById('inv-img-pick');
    let img = pick.querySelector('img.inv-preview-img');
    if (!img) { img = document.createElement('img'); img.className = 'inv-preview-img'; pick.appendChild(img); }
    img.src = previewUrl;
  });
}

function compressInvImage(file, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    const image = new Image();
    image.onload = () => {
      const MAX = 1200;
      const size = Math.min(image.width, image.height);
      const scale = Math.min(1, MAX / size);
      const out = Math.round(size * scale);
      const sx = Math.round((image.width - size) / 2);
      const sy = Math.round((image.height - size) / 2);
      const canvas = document.createElement('canvas');
      canvas.width = out; canvas.height = out;
      canvas.getContext('2d').drawImage(image, sx, sy, size, size, 0, 0, out, out);
      canvas.toBlob(blob => { if (blob) cb(blob, URL.createObjectURL(blob)); }, 'image/jpeg', 0.85);
    };
    image.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Upload a product image to storage and return its URL (thumb preferred).
// Product images used to be saved as base64 straight into the DB row —
// new/changed images go to Supabase Storage instead; old rows keep working.
async function uploadProductImage(blob) {
  try {
    const form = new FormData();
    form.append('files', blob, 'produkt.jpg');
    const r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    if (!r.ok) return null;
    const d = await r.json();
    return d.files?.[0]?.thumbUrl || d.files?.[0]?.url || null;
  } catch { return null; }
}

// jsPDF needs image data, not URLs — convert storage URLs on demand
async function imgToDataUrl(src) {
  if (!src || src.startsWith('data:')) return src || null;
  try {
    const r = await fetch(src);
    if (!r.ok) return null;
    const blob = await r.blob();
    return await new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => res(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}

async function saveInvItem() {
  const name = document.getElementById('invf-name').value.trim();
  if (!name) { document.getElementById('invf-name').focus(); return; }
  const body = {
    name,
    ref_code: document.getElementById('invf-ref').value.trim() || null,
    sell_price: parseFloat(document.getElementById('invf-sell').value) || null,
    buy_price: parseFloat(document.getElementById('invf-buy').value) || null,
    notes: document.getElementById('invf-notes').value.trim() || null,
  };

  const btn = document.querySelector('#inv-form-modal .inv-gen-btn');
  btn.disabled = true;

  // A freshly picked image is uploaded to storage first; the row stores its URL
  if (invFormImageBlob) {
    btn.textContent = 'Laddar upp bild…';
    const url = await uploadProductImage(invFormImageBlob);
    if (!url) {
      showToast('Bilduppladdningen misslyckades — varan sparades inte', 'error');
      btn.textContent = 'Spara'; btn.disabled = false;
      return;
    }
    invFormImage = url;
    invFormImageBlob = null;
  }
  // Only include image if changed (new image selected, or new item)
  if (invFormImage !== undefined) body.image = invFormImage;

  btn.textContent = 'Sparar…';

  // Redigerar man en modell som finns i flera exemplar ska ändringen gälla alla
  const groupIds = invFormGroupIds && invFormGroupIds.length > 1 ? invFormGroupIds : null;
  const r = !invFormItemId
    ? await api('/api/inventory', { method: 'POST', body: JSON.stringify(body) })
    : groupIds
      ? await api('/api/inventory', { method: 'PATCH', body: JSON.stringify({ ...body, ids: groupIds }) })
      : await api(`/api/inventory/${invFormItemId}`, { method: 'PATCH', body: JSON.stringify(body) });

  btn.textContent = 'Spara'; btn.disabled = false;

  if (!r.ok) { showToast('Kunde inte spara varan', 'error'); return; }
  if (groupIds) showToast(`${groupIds.length} exemplar uppdaterade`, 'success');
  closeInvForm();
  loadInventory();
}

async function deleteInvItem(id) {
  if (!confirm('Ta bort detta exemplar permanent?')) return;
  const r = await api(`/api/inventory/${id}`, { method: 'DELETE' });
  if (!r.ok) { showToast('Kunde inte ta bort varan', 'error'); return; }
  delete invItemsMap[id];
  loadInventory();
}

async function deleteInvGroup(key) {
  const g = invGroups[key];
  if (!g) return;
  const what = g.count > 1 ? `alla ${g.count} exemplar av "${g.name}"` : `"${g.name}"`;
  if (!confirm(`Ta bort ${what} permanent?`)) return;
  const r = await api('/api/inventory/delete', { method: 'POST', body: JSON.stringify({ ids: g.ids }) });
  if (!r.ok) { showToast('Kunde inte ta bort varan', 'error'); return; }
  g.ids.forEach(id => delete invItemsMap[id]);
  loadInventory();
}

// Knappen ligger i Mer-menyn, som är stängd medan PDF:en byggs — därför visas
// förloppet som en notis och dubbeltryck stoppas av flaggan i stället
let _catalogBusy = false;
async function generateCatalogPDF() {
  // En modell per uppslag, inte ett kort per fysiskt par — annars blev
  // katalogen sidor lång av samma glasögon om och om igen
  const items = Object.values(invGroups);
  if (!items.length) { showToast('Lagret är tomt', 'error'); return; }
  if (_catalogBusy) return;
  _catalogBusy = true;
  showToast('Skapar katalog…', 'ok');

  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setProperties({ title: 'Vision Palace – Katalog', creator: 'Vision Palace' });

    const PW = 210, PH = 297, M = 14, COLS = 2, CGAP = 6, RGAP = 8;
    const CW = (PW - M * 2 - CGAP) / COLS;
    const IH = 76, TH = 24, CH = IH + TH;
    const IMG_SZ = IH, IMG_X_OFF = (CW - IH) / 2;

    const drawHeader = (first) => {
      if (first) {
        doc.setFont('times', 'italic'); doc.setFontSize(21); doc.setTextColor(26, 26, 26);
        doc.text('Vision Palace', PW / 2, M + 7, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(160, 160, 160);
        doc.text('K  A  T  A  L  O  G', PW / 2, M + 13, { align: 'center' });
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
    for (const item of items) {
      if (y + CH > PH - M) { doc.addPage(); y = drawHeader(false); col = 0; }
      const x = M + col * (CW + CGAP);
      doc.setFillColor(255, 255, 255); doc.rect(x, y, CW, IH, 'F');
      const imgData = await imgToDataUrl(item.image);
      if (imgData) {
        try {
          const fmt = imgData.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(imgData, fmt, x + IMG_X_OFF, y, IMG_SZ, IMG_SZ, undefined, 'NONE');
        } catch { /* keep background */ }
      }
      doc.setDrawColor(221, 217, 209); doc.setLineWidth(0.2); doc.rect(x, y, CW, CH);
      doc.line(x, y + IH, x + CW, y + IH);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(171, 171, 171);
      doc.text(String(item.ref_code || '').toUpperCase(), x + 4, y + IH + 5.5);
      doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(26, 26, 26);
      const ns = doc.splitTextToSize(item.name, CW - 8);
      doc.text(ns[0] + (ns.length > 1 ? '…' : ''), x + 4, y + IH + 13);
      doc.setFontSize(13);
      doc.text(item.sell_price != null ? `€ ${Number(item.sell_price).toLocaleString('sv-SE')}` : '—', x + 4, y + IH + 21);
      // Antalet i lager, högerställt på prisraden — köparen ser direkt om vi
      // kan leverera flera av samma modell
      if (item.count > 1) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(140, 140, 140);
        doc.text(`${item.count} in stock`, x + CW - 4, y + IH + 21, { align: 'right' });
      }
      col++; if (col >= COLS) { col = 0; y += CH + RGAP; }
    }

    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p); doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5); doc.setTextColor(180, 180, 180);
      doc.text(`${p} / ${total}`, PW / 2, PH - 6, { align: 'center' });
    }

    const today = new Date().toLocaleDateString('sv-SE').replace(/\//g, '-');
    doc.save(`katalog-clunettes-${today}.pdf`);
    showToast('Katalog skapad', 'success');
  } catch (e) {
    showToast('PDF-fel: ' + e.message, 'error');
  } finally {
    _catalogBusy = false;
  }
}

function showCatalogClientPicker() {
  const items = Object.values(invGroups);
  if (!items.length) { showToast('Lagret är tomt', 'error'); return; }
  const list = document.getElementById('cat-picker-list');
  const active = clients.filter(c => !c.is_inactive);
  if (!active.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:14px">Inga aktiva klienter</div>';
  } else {
    list.innerHTML = active.map(c => `
      <div style="display:flex;align-items:center;padding:14px 16px;gap:12px;border-bottom:1px solid var(--border);cursor:pointer" onclick="sendCatalogToClient('${c.id}')">
        <div>
          <div style="font-size:15px;font-weight:500">${esc(c.admin_label || c.display_name)}</div>
          ${c.admin_label ? `<div style="font-size:12px;color:var(--text3)">${esc(c.display_name)}</div>` : ''}
        </div>
      </div>`).join('');
  }
  document.getElementById('cat-picker-modal').classList.add('open');
}

function closeCatalogClientPicker() {
  document.getElementById('cat-picker-modal').classList.remove('open');
}

async function sendCatalogToClient(clientId) {
  closeCatalogClientPicker();
  const items = Object.values(invGroups);
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
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setProperties({ title: 'Vision Palace – Katalog', creator: 'Vision Palace' });
    const PW = 210, PH = 297, M = 14, COLS = 2, CGAP = 6, RGAP = 8;
    const CW = (PW - M * 2 - CGAP) / COLS;
    const IH = 76, TH = 24, CH = IH + TH;
    const IMG_SZ = IH, IMG_X_OFF = (CW - IH) / 2;
    const drawHeader = (first) => {
      if (first) {
        doc.setFont('times', 'italic'); doc.setFontSize(21); doc.setTextColor(26, 26, 26);
        doc.text('Vision Palace', PW / 2, M + 7, { align: 'center' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(160, 160, 160);
        doc.text('K  A  T  A  L  O  G', PW / 2, M + 13, { align: 'center' });
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
    for (const item of items) {
      if (y + CH > PH - M) { doc.addPage(); y = drawHeader(false); col = 0; }
      const x = M + col * (CW + CGAP);
      doc.setFillColor(255, 255, 255); doc.rect(x, y, CW, IH, 'F');
      const imgData = await imgToDataUrl(item.image);
      if (imgData) {
        try { const fmt = imgData.startsWith('data:image/png') ? 'PNG' : 'JPEG'; doc.addImage(imgData, fmt, x + IMG_X_OFF, y, IMG_SZ, IMG_SZ, undefined, 'NONE'); }
        catch { /* keep background */ }
      }
      doc.setDrawColor(221, 217, 209); doc.setLineWidth(0.2); doc.rect(x, y, CW, CH);
      doc.line(x, y + IH, x + CW, y + IH);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6); doc.setTextColor(171, 171, 171);
      doc.text(String(item.ref_code || '').toUpperCase(), x + 4, y + IH + 5.5);
      doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(26, 26, 26);
      const ns = doc.splitTextToSize(item.name, CW - 8);
      doc.text(ns[0] + (ns.length > 1 ? '…' : ''), x + 4, y + IH + 13);
      doc.setFontSize(13);
      doc.text(item.sell_price != null ? `€ ${Number(item.sell_price).toLocaleString('sv-SE')}` : '—', x + 4, y + IH + 21);
      // Antalet i lager, högerställt på prisraden — köparen ser direkt om vi
      // kan leverera flera av samma modell
      if (item.count > 1) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(140, 140, 140);
        doc.text(`${item.count} in stock`, x + CW - 4, y + IH + 21, { align: 'right' });
      }
      col++; if (col >= COLS) { col = 0; y += CH + RGAP; }
    }
    const total = doc.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p); doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5); doc.setTextColor(180, 180, 180);
      doc.text(`${p} / ${total}`, PW / 2, PH - 6, { align: 'center' });
    }

    // Upload PDF blob
    const blob = doc.output('blob');
    const form = new FormData();
    form.append('files', blob, 'katalog.pdf');
    const up = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    if (!up.ok) { showToast('Uppladdning misslyckades', 'error'); return; }
    const ud = await up.json();
    const pdfUrl = ud.files?.[0]?.url;
    if (!pdfUrl) { showToast('Ingen URL från uppladdning', 'error'); return; }

    // Send as message
    const r = await api(`/api/messages/${clientId}`, {
      method: 'POST',
      body: JSON.stringify({
        text: 'Vision Palace – Katalog',
        message_type: 'pdf',
        metadata: { url: pdfUrl }
      })
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
