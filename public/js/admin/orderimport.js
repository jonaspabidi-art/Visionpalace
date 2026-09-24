// ── Läs in order (AI-avläsning av leverantörsfaktura) ──
// Modellen föreslår, du bekräftar. En feltolkad ref skapar inte bara fel vara —
// den förgiftar ref-uppslaget för all framtid, eftersom uppslaget läser ur
// lagret och sålda varor. Därför alltid ett granskningssteg.
let orderRows = [];
let orderDocBlob = null;
let orderDocUrl = null;
// Kursen som fakturans belopp räknades om med. Sparas med inköpet så att
// omräkningen går att granska i efterhand.
let orderEurSekRate = null;
// Raden som väntar på en bild från filväljaren. Alla rader delar samma dolda
// input, annars får varje rad sin egen och de blir aldrig uppstädade.
let orderImgRow = null;

function openOrderImport() {
  orderRows = [];
  orderDocBlob = null;
  orderDocUrl = null;
  orderEurSekRate = null;
  orderImgRow = null;
  document.getElementById('order-file').value = '';
  document.getElementById('order-status').textContent = '';
  document.getElementById('order-rows').innerHTML = '';
  document.getElementById('order-import-btn').style.display = 'none';
  document.getElementById('order-modal').classList.add('open');
}

function closeOrderImport() {
  document.getElementById('order-modal').classList.remove('open');
}

async function handleOrderFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  orderDocBlob = file;
  const status = document.getElementById('order-status');
  status.textContent = 'Läser av fakturan…';
  document.getElementById('order-rows').innerHTML = '';
  document.getElementById('order-import-btn').style.display = 'none';

  try {
    const form = new FormData();
    form.append('file', file, file.name);
    const r = await fetch('/api/orders/parse', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { status.textContent = d.error || 'Kunde inte läsa av dokumentet.'; return; }
    if (!d.rows?.length) { status.textContent = 'Hittade inga artikelrader i dokumentet.'; return; }

    status.textContent = `Hittade ${d.rows.length} rader${d.currency ? ` i ${d.currency}` : ''}. Kontrollera innan du importerar.`;
    orderEurSekRate = d.eur_sek_rate ?? null;
    // Look each ref up so known products come back with name, image and price
    orderRows = await Promise.all(d.rows.map(async row => {
      const match = await lookupOrderRef(row.ref_code);
      return {
        ...row,
        known: !!match,
        // Names on the invoices don't match what the products are called here,
        // so they are never read off — a known ref brings its saved name back,
        // an unknown one is left blank to be typed in
        name: match?.name || '',
        sell_price: match?.sell_price ?? '',
        image: match?.image || null,
      };
    }));
    renderOrderRows();
    document.getElementById('order-import-btn').style.display = '';
  } catch {
    status.textContent = 'Anslutningsfel vid avläsning.';
  }
}

async function lookupOrderRef(code) {
  if (!code) return null;
  try {
    const r = await api(`/api/inventory/ref-lookup?code=${encodeURIComponent(code)}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d.match || null;
  } catch { return null; }
}

// Bilden går att sätta redan här. Tidigare gick bara namn och pris att fylla i,
// och en helt ny vara hamnade i lagret utan bild — man fick leta upp den efteråt
// och lägga till bilden en gång till, för varje vara.
function orderImgCell(row, i) {
  const src = row.image || row.previewUrl || null;
  const busy = row.uploading ? 'opacity:.5' : '';
  return `<button onclick="pickOrderImage(${i})" title="${src ? 'Byt bild' : 'Lägg till bild'}"
    style="width:44px;height:44px;flex-shrink:0;padding:0;border-radius:8px;cursor:pointer;overflow:hidden;
           border:1px dashed ${src ? 'transparent' : 'var(--border)'};background:${src ? 'none' : 'rgba(255,255,255,.03)'};
           color:var(--text3);font-size:17px;font-family:inherit;line-height:1;${busy}">
    ${src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block">` : '+'}
  </button>`;
}

function orderImgHint(row) {
  if (row.uploading) return 'Laddar upp bilden…';
  if (row.imageFailed) return '<span style="color:#ff7a7a">Bilden kunde inte laddas upp — tryck för att försöka igen</span>';
  if (row.image || row.previewUrl) return '';
  return 'Ingen bild — tryck på rutan för att lägga till';
}

function pickOrderImage(i) {
  orderImgRow = i;
  const input = document.getElementById('order-img-file');
  input.value = '';        // annars ger samma fil två gånger ingen händelse
  input.click();
}

function onOrderImagePicked(input) {
  const file = input.files?.[0];
  const row = orderRows[orderImgRow];
  input.value = '';
  if (!file || !row) return;

  // Samma beskärning och komprimering som lagerformuläret använder, så att
  // bilderna ser likadana ut oavsett var de lades till
  compressInvImage(file, async (blob, previewUrl) => {
    row.previewUrl = previewUrl;   // visas direkt, innan uppladdningen är klar
    row.uploading = true;
    row.imageFailed = false;
    renderOrderRows();

    const url = await uploadProductImage(blob);
    row.uploading = false;
    if (url) {
      row.image = url;
      row.imageFailed = false;
    } else {
      // Behåll förhandsvisningen så man ser vilken bild som inte gick fram
      row.imageFailed = true;
      showToast('Bilden kunde inte laddas upp', 'error');
    }
    renderOrderRows();
  });
}

function renderOrderRows() {
  const box = document.getElementById('order-rows');
  box.innerHTML = orderRows.map((row, i) => {
    const known = row.known;
    const suspect = row.suspicious_ref && !known;
    const tint = suspect ? 'rgba(255,90,90,.08)' : known ? 'rgba(100,220,150,.07)' : 'rgba(255,153,68,.07)';
    const edge = suspect ? 'rgba(255,90,90,.35)' : known ? 'rgba(100,220,150,.25)' : 'rgba(255,153,68,.3)';
    const orig = row.currency_original && row.currency_original !== 'EUR'
      ? `${row.unit_original.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${row.currency_original}/st`
      : '';
    return `<div style="background:${tint};border:1px solid ${edge};border-radius:10px;padding:10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        ${orderImgCell(row, i)}
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;color:var(--text3)">${known ? 'Känd sedan tidigare' : 'Ny vara — fyll i namn och säljpris'}${orig ? ` · ${orig}` : ''}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">${orderImgHint(row)}</div>
        </div>
        <button onclick="removeOrderRow(${i})" style="background:none;border:none;color:var(--text3);font-size:15px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0" title="Ta bort raden">✕</button>
      </div>
      <div class="inv-field" style="margin-bottom:8px">
        <label>Referenskod</label>
        <input class="inv-input" value="${esc(row.ref_code)}" style="font-weight:700${suspect ? ';border-color:rgba(255,90,90,.5)' : ''}"
               onchange="updateOrderRow(${i},'ref_code',this.value)">
        ${suspect ? `<div style="font-size:11px;color:#ff7a7a;margin-top:4px;line-height:1.4">⚠ Kontrollera koden mot fakturan. Tecknet före bindestrecket är en siffra — där brukar det stå en bokstav (S läses lätt som 5).</div>` : ''}
      </div>
      <div class="inv-field" style="margin-bottom:8px">
        <label>Namn</label>
        <input class="inv-input" value="${esc(row.name)}" placeholder="Skriv namn på varan"
               style="${row.name ? '' : 'border-color:rgba(255,153,68,.45)'}" onchange="updateOrderRow(${i},'name',this.value)">
      </div>
      <div class="inv-row-grid">
        <div class="inv-field" style="margin-bottom:0">
          <label>Antal</label>
          <input class="inv-input" type="number" min="1" value="${row.qty}" onchange="updateOrderRow(${i},'qty',this.value)">
        </div>
        <div class="inv-field" style="margin-bottom:0">
          <label>Inköpspris (€)</label>
          <input class="inv-input" type="number" step="0.01" value="${row.buy_price_eur ?? ''}"
                 placeholder="${row.needs_manual_price ? 'fyll i' : ''}" onchange="updateOrderRow(${i},'buy_price_eur',this.value)">
        </div>
      </div>
      <div class="inv-field" style="margin-top:8px;margin-bottom:0">
        <label>Säljpris (€)</label>
        <input class="inv-input" type="number" step="0.01" value="${row.sell_price ?? ''}"
               placeholder="${known ? '' : 'fyll i'}" onchange="updateOrderRow(${i},'sell_price',this.value)">
      </div>
    </div>`;
  }).join('');
  const total = orderRows.reduce((s, r) => s + (parseInt(r.qty, 10) || 0), 0);
  document.getElementById('order-import-btn').textContent = `Lägg in ${total} varor i lagret`;
}

async function updateOrderRow(i, field, value) {
  const row = orderRows[i];
  if (!row) return;
  row[field] = value;
  if (field === 'qty') {
    const total = orderRows.reduce((s, r) => s + (parseInt(r.qty, 10) || 0), 0);
    document.getElementById('order-import-btn').textContent = `Lägg in ${total} varor i lagret`;
  }
  // A corrected ref may well be one we already know — look it up again so the
  // saved name, image and sell price come back instead of being retyped
  if (field === 'ref_code') {
    const ref = String(value || '').trim().toUpperCase();
    row.ref_code = ref;
    row.suspicious_ref = /^[A-Z]{1,3}\d+-\d+$/.test(ref);
    const match = await lookupOrderRef(ref);
    if (match) {
      row.known = true;
      row.name = match.name || row.name;
      row.sell_price = match.sell_price ?? row.sell_price;
      row.image = match.image || row.image;
    } else {
      row.known = false;
    }
    renderOrderRows();
  }
}

function removeOrderRow(i) {
  orderRows.splice(i, 1);
  if (!orderRows.length) { closeOrderImport(); return; }
  renderOrderRows();
}

async function importOrderRows() {
  // En bild som fortfarande laddas upp har ingen url än. Importerade vi nu hade
  // varan hamnat i lagret utan bild, tyst, trots att man precis valt en.
  if (orderRows.some(r => r.uploading)) {
    showToast('Vänta tills bilderna laddats upp', 'error');
    return;
  }
  const missing = orderRows.filter(r => !String(r.name || '').trim());
  if (missing.length) {
    showToast(`Fyll i namn på ${missing.length === 1 ? `${missing[0].ref_code}` : `${missing.length} varor`}`, 'error');
    return;
  }

  const btn = document.getElementById('order-import-btn');
  const original = btn.textContent;
  btn.disabled = true;
  try {
    // Archive the invoice itself — it is the bookkeeping evidence for the purchase
    if (orderDocBlob && !orderDocUrl) {
      btn.textContent = 'Sparar fakturan…';
      const form = new FormData();
      form.append('files', orderDocBlob, orderDocBlob.name || 'faktura');
      const up = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      if (up.ok) {
        const ud = await up.json();
        orderDocUrl = ud.files?.[0]?.url || null;
      }
    }
    btn.textContent = 'Lägger in i lagret…';
    const r = await api('/api/orders/import', {
      method: 'POST',
      body: JSON.stringify({
        document_url: orderDocUrl,
        items: orderRows.map(row => ({
          ref_code: row.ref_code,
          name: String(row.name).trim(),
          qty: parseInt(row.qty, 10) || 1,
          buy_price: row.buy_price_eur === '' ? null : row.buy_price_eur,
          // Fakturans eget belopp följer med till bokföringen. Utan det går
          // inköpet inte att stämma av mot fakturan det kom ifrån.
          buy_original: row.unit_original ?? null,
          buy_currency: row.currency_original || null,
          fx_rate: orderEurSekRate,
          sell_price: row.sell_price === '' ? null : row.sell_price,
          image: row.image || null,
        })),
      }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); showToast(d.error || 'Importen misslyckades', 'error'); return; }
    const d = await r.json();
    closeOrderImport();
    showToast(`${d.created} varor tillagda i lagret`, 'success');
    loadInventory();
  } catch { showToast('Anslutningsfel', 'error'); }
  finally { btn.disabled = false; btn.textContent = original; }
}
