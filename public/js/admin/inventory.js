async function loadInventory() {
  const grid = document.getElementById('inv-grid');
  grid.innerHTML = '<div class="inv-empty" style="grid-column:1/-1">Laddar…</div>';
  const r = await api('/api/inventory');
  if (!r.ok) { grid.innerHTML = '<div class="inv-empty" style="grid-column:1/-1">Kunde inte hämta lager</div>'; return; }
  const d = await r.json();
  renderInventory(d.items || []);
}

function renderInventory(items) {
  const grid = document.getElementById('inv-grid');
  invItemsMap = {};
  if (!items.length) { grid.innerHTML = '<div class="inv-empty" style="grid-column:1/-1">Lagret är tomt</div>'; return; }
  items.forEach(item => { invItemsMap[item.id] = item; });
  grid.innerHTML = items.map(item => `
    <div class="inv-card">
      ${item.image
        ? `<img class="inv-card-img" src="${item.image}" alt="${esc(item.name)}" loading="lazy">`
        : `<div class="inv-card-img-ph">Ingen bild</div>`}
      <div class="inv-card-body">
        ${item.ref_code ? `<div class="inv-card-ref">${esc(item.ref_code)}</div>` : ''}
        <div class="inv-card-name">${esc(item.name)}</div>
        ${item.sell_price != null ? `<div class="inv-card-price">€ ${esc(String(item.sell_price))}</div>` : ''}
        <div class="inv-card-actions">
          <button class="inv-edit-btn" onclick="openInvForm('${item.id}')">Redigera</button>
          <button class="inv-sell-btn" onclick="addToSaleCartFromCard('${item.id}')">+ Sälj</button>
          <button class="inv-del-btn" onclick="deleteInvItem('${item.id}')" title="Ta bort">🗑</button>
        </div>
      </div>
    </div>`).join('');
}

// ── Inventory CRUD ──
let invFormItemId = null;
let invFormImage = null; // base64 or null (undefined = unchanged on edit)

function openInvForm(itemId) {
  invFormItemId = itemId;
  invFormImage = undefined;
  const item = itemId ? invItemsMap[itemId] : null;
  document.getElementById('inv-form-title').textContent = item ? 'Redigera vara' : 'Ny vara';
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

function closeInvForm() {
  document.getElementById('inv-form-modal').classList.remove('open');
  invFormItemId = null;
  invFormImage = undefined;
}

function handleInvImg(input) {
  const file = input.files[0];
  if (!file) return;
  compressInvImage(file, base64 => {
    invFormImage = base64;
    const pick = document.getElementById('inv-img-pick');
    let img = pick.querySelector('img.inv-preview-img');
    if (!img) { img = document.createElement('img'); img.className = 'inv-preview-img'; pick.appendChild(img); }
    img.src = base64;
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
      cb(canvas.toDataURL('image/jpeg', 0.85));
    };
    image.src = e.target.result;
  };
  reader.readAsDataURL(file);
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
  // Only include image if changed (new image selected, or new item)
  if (invFormImage !== undefined) body.image = invFormImage;

  const btn = document.querySelector('#inv-form-modal .inv-gen-btn');
  btn.textContent = 'Sparar…'; btn.disabled = true;

  const r = invFormItemId
    ? await api(`/api/inventory/${invFormItemId}`, { method: 'PATCH', body: JSON.stringify(body) })
    : await api('/api/inventory', { method: 'POST', body: JSON.stringify(body) });

  btn.textContent = 'Spara'; btn.disabled = false;

  if (!r.ok) { showToast('Kunde inte spara varan', 'error'); return; }
  closeInvForm();
  loadInventory();
}

async function deleteInvItem(id) {
  if (!confirm('Ta bort denna vara permanent?')) return;
  const r = await api(`/api/inventory/${id}`, { method: 'DELETE' });
  if (!r.ok) { showToast('Kunde inte ta bort varan', 'error'); return; }
  delete invItemsMap[id];
  loadInventory();
}

async function generateCatalogPDF() {
  const items = Object.values(invItemsMap);
  if (!items.length) { showToast('Lagret är tomt', 'error'); return; }

  const btn = document.querySelector('.inv-catalog-btn');
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
      if (item.image) {
        try {
          const fmt = item.image.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(item.image, fmt, x + IMG_X_OFF, y, IMG_SZ, IMG_SZ, undefined, 'NONE');
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
    btn.textContent = 'Katalog PDF'; btn.disabled = false;
  }
}

function showCatalogClientPicker() {
  const items = Object.values(invItemsMap);
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
  const items = Object.values(invItemsMap);
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
      if (item.image) {
        try { const fmt = item.image.startsWith('data:image/png') ? 'PNG' : 'JPEG'; doc.addImage(item.image, fmt, x + IMG_X_OFF, y, IMG_SZ, IMG_SZ, undefined, 'NONE'); }
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
