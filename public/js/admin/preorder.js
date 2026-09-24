// ── Förbeställningar ──
// Ett par säljs innan det finns. Det beställs från Cartier och tar 1–6 veckor.
// Varan passerar aldrig lagret i appen — den går från leverantören rakt till
// kunden — så ingenting här rör lagersaldot.

const PREORDER_DEFAULT_WEEKS = [1, 6];

function openPreorderModal() {
  const sel = document.getElementById('pre-client-pick');
  sel.innerHTML = '<option value="">Välj klient…</option>' +
    clients.filter(c => !c.is_inactive).map(c =>
      `<option value="${c.id}">${esc(c.admin_label || c.display_name)}</option>`
    ).join('') +
    '<option value="__walkin">Kund utanför appen…</option>';
  sel.value = '';
  for (const [id, val] of [['pre-walkin-name', ''],
    ['pre-eta-min', String(PREORDER_DEFAULT_WEEKS[0])], ['pre-eta-max', String(PREORDER_DEFAULT_WEEKS[1])]]) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  document.getElementById('pre-paid').checked = true;
  preLines = [];
  preLineNextId = 0;
  addPreLine();
  onPreBuyerChange();
  updatePreEtaHint();
  for (const id of ['pre-eta-min', 'pre-eta-max']) {
    document.getElementById(id).oninput = updatePreEtaHint;
  }
  document.getElementById('preorder-modal').classList.add('open');
}

function closePreorderModal() {
  document.getElementById('preorder-modal').classList.remove('open');
}

function onPreBuyerChange() {
  const walkin = document.getElementById('pre-client-pick').value === '__walkin';
  document.getElementById('pre-walkin').style.display = walkin ? '' : 'none';
  if (walkin) document.getElementById('pre-walkin-name')?.focus();
}

// Visar spannet som riktiga datum — "1–6 veckor" säger inte lika mycket som
// att se att det landar i september
function updatePreEtaHint() {
  const min = parseInt(document.getElementById('pre-eta-min').value, 10);
  const max = parseInt(document.getElementById('pre-eta-max').value, 10);
  const hint = document.getElementById('pre-eta-hint');
  if (!Number.isFinite(min) || !Number.isFinite(max)) { hint.textContent = 'Antal veckor från idag.'; return; }
  hint.textContent = `Kunden ser ${preorderWindowText(new Date(), min, max)}.`;
}

function preorderDate(from, weeks) {
  const d = new Date(from);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function preorderWindowText(from, min, max) {
  const fmt = d => d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  const lo = preorderDate(from, Math.min(min, max));
  const hi = preorderDate(from, Math.max(min, max));
  return `${fmt(lo)} – ${fmt(hi)}`;
}

// ── Varorna i en förbeställning ──
// Förut gick det bara att beställa ett par i taget, trots att servern redan
// tog emot en lista. Beställer man tre par till samma kund ska det bli EN
// order med tre rader — annars får kunden tre notiser, tre leveransfönster
// och tre rader i sin köphistorik för ett och samma köp.
let preLines = [];
let preLineNextId = 0;

function addPreLine(ref = '', name = '', qty = '1', sell = '', buy = '') {
  preLines.push({ id: ++preLineNextId, ref, name, qty, sell, buy, image: null, hint: '' });
  renderPreLines();
}

function removePreLine(id) {
  // Sista raden tas aldrig bort — en förbeställning utan varor går inte att skapa
  if (preLines.length <= 1) return;
  preLines = preLines.filter(l => l.id !== id);
  renderPreLines();
}

function updatePreLine(id, field, value) {
  const line = preLines.find(l => l.id === id);
  if (line) line[field] = value;
  updatePreTotal();
}

function preLineTotal() {
  return preLines.reduce((sum, l) =>
    sum + (parseFloat(l.sell) || 0) * (parseInt(l.qty, 10) || 0), 0);
}

function updatePreTotal() {
  const el = document.getElementById('pre-total');
  if (!el) return;
  const pairs = preLines.reduce((n, l) => n + (parseInt(l.qty, 10) || 0), 0);
  const total = preLineTotal();
  // Utan inköpspris räknas raden som genomgång och ger noll i vinst — i
  // Historik, i exporten och i avräkningen. Det ska inte gå att missa.
  const utanInkop = preLines.filter(l =>
    parseFloat(l.sell) > 0 && (l.buy === '' || l.buy == null)).length;
  el.innerHTML = total > 0
    ? `${pairs} par · totalt € ${total.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      + (utanInkop ? `<div style="font-size:11px;font-weight:400;color:#ffb066;margin-top:3px;line-height:1.4">${utanInkop} rad${utanInkop > 1 ? 'er' : ''} saknar inköpspris och räknas inte in i vinsten</div>` : '')
    : '';
}

// En modell som aldrig sålts förut har ingen bild i ref-uppslaget, och då gick
// förbeställningen iväg helt utan bild.
function preLineImgCell(line) {
  const src = line.image || line.previewUrl || null;
  return `<button data-role="img-pick" title="${src ? 'Byt bild' : 'Lägg till bild'}"
    style="width:48px;height:48px;flex-shrink:0;padding:0;border-radius:8px;cursor:pointer;overflow:hidden;
           border:1px dashed ${src ? 'transparent' : 'var(--border)'};background:${src ? 'none' : 'rgba(255,255,255,.03)'};
           color:var(--text3);font-size:18px;font-family:inherit;line-height:1;${line.imgUploading ? 'opacity:.5' : ''}">
    ${src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block">` : '+'}
  </button>`;
}

function pickPreLineImage(lineId) {
  pickProductImage(({ previewUrl, uploading, url }) => {
    const line = preLines.find(l => l.id === lineId);
    if (!line) return;
    line.previewUrl = previewUrl;
    line.imgUploading = uploading;
    if (!uploading) {
      if (url) line.image = url;
      else showToast('Bilden kunde inte laddas upp', 'error');
    }
    renderPreLines();
  });
}

function renderPreLines() {
  const wrap = document.getElementById('pre-lines');
  if (!wrap) return;
  wrap.innerHTML = '';
  preLines.forEach((line, i) => {
    const div = document.createElement('div');
    div.className = 'inv-line-item';
    div.innerHTML = `
      ${preLines.length > 1 ? '<button class="inv-line-remove" title="Ta bort">×</button>' : ''}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-right:28px">
        ${preLineImgCell(line)}
        <div style="font-size:11px;color:var(--text3);line-height:1.4;min-width:0">
          ${line.imgUploading ? 'Laddar upp bilden…'
            : (line.image || line.previewUrl) ? 'Tryck på rutan för att byta bild'
            : 'Ingen bild — tryck på rutan för att lägga till'}
        </div>
      </div>
      <div class="inv-field">
        <label>Referenskod</label>
        <input class="inv-input" data-field="ref" placeholder="ex. CT0582S-005"
               autocomplete="off" style="font-weight:700">
        <div class="pre-hint" style="font-size:11px;color:var(--text3);margin-top:5px;line-height:1.45"></div>
      </div>
      <div class="inv-field">
        <label>Namn på varan</label>
        <input class="inv-input" data-field="name" placeholder="Skriv namn" autocomplete="off">
      </div>
      <div class="inv-row-grid">
        <div class="inv-field" style="margin-bottom:0">
          <label>Antal</label>
          <input class="inv-input" data-field="qty" type="number" min="1" step="1" inputmode="numeric">
        </div>
        <div class="inv-field" style="margin-bottom:0">
          <label>Säljpris (€)</label>
          <input class="inv-input" data-field="sell" type="number" step="0.01" inputmode="decimal" placeholder="0">
        </div>
      </div>
      <div class="inv-field" style="margin-top:10px;margin-bottom:0">
        <label>Inköpspris (€)</label>
        <input class="inv-input" data-field="buy" type="number" step="0.01" inputmode="decimal" placeholder="0">
      </div>`;
    for (const field of ['ref', 'name', 'qty', 'sell', 'buy']) {
      const input = div.querySelector(`[data-field="${field}"]`);
      input.value = line[field];
      input.addEventListener('change', () => updatePreLine(line.id, field, input.value));
    }
    div.querySelector('.pre-hint').textContent = line.hint;
    div.querySelector('[data-role="img-pick"]').addEventListener('click', () => pickPreLineImage(line.id));
    // Uppslaget fyller i namn och priser på just den här raden
    div.querySelector('[data-field="ref"]').addEventListener('change', () => lookupPreorderRef(line.id));
    div.querySelector('.inv-line-remove')?.addEventListener('click', () => removePreLine(line.id));
    wrap.appendChild(div);
  });
  updatePreTotal();
}

// Har vi sålt modellen förut kommer namn och priser tillbaka — samma uppslag
// som fakturaimporten använder
async function lookupPreorderRef(lineId) {
  const line = preLines.find(l => l.id === lineId);
  if (!line) return;
  const ref = String(line.ref || '').trim().toUpperCase();
  line.ref = ref;
  if (!ref) { line.hint = ''; renderPreLines(); return; }
  try {
    const r = await api(`/api/inventory/ref-lookup?code=${encodeURIComponent(ref)}`);
    if (!r.ok) { line.hint = ''; renderPreLines(); return; }
    const d = await r.json();
    const m = d.match;
    if (!m) { line.hint = 'Ny modell — fyll i namn och priser själv.'; renderPreLines(); return; }
    if (!String(line.name).trim() && m.name) line.name = m.name;
    if (!line.sell && m.sell_price != null) line.sell = String(m.sell_price);
    if (!line.buy && m.buy_price != null) line.buy = String(m.buy_price);
    line.image = m.image || null;
    line.hint = 'Känd modell — namn och priser hämtade.';
  } catch { line.hint = ''; }
  renderPreLines();
}


async function createPreorder() {
  const picked = document.getElementById('pre-client-pick').value;
  const isWalkin = picked === '__walkin';
  const clientId = isWalkin ? '' : picked;
  const walkinName = document.getElementById('pre-walkin-name').value.trim();
  const min = parseInt(document.getElementById('pre-eta-min').value, 10);
  const max = parseInt(document.getElementById('pre-eta-max').value, 10);
  const paid = document.getElementById('pre-paid').checked;

  if (!clientId && !isWalkin) { showToast('Välj en köpare', 'error'); return; }
  if (preLines.some(l => l.imgUploading)) {
    showToast('Vänta tills bilden laddats upp', 'error'); return;
  }
  if (isWalkin && !walkinName) { showToast('Skriv namnet på köparen', 'error'); return; }
  // Varje rad måste vara komplett. Ett tomt namn eller pris på rad tre är lätt
  // att missa, och felet syns inte förrän fakturan går iväg.
  const items = [];
  for (let i = 0; i < preLines.length; i++) {
    const l = preLines[i];
    const nr = preLines.length > 1 ? ` på rad ${i + 1}` : '';
    if (!String(l.name).trim()) { showToast(`Skriv namn på varan${nr}`, 'error'); return; }
    if (!(parseFloat(l.sell) > 0)) { showToast(`Ange säljpris${nr}`, 'error'); return; }
    items.push({
      name: String(l.name).trim(),
      ref_code: String(l.ref || '').trim().toUpperCase() || null,
      qty: Math.max(1, parseInt(l.qty, 10) || 1),
      sell_price: parseFloat(l.sell),
      buy_price: l.buy === '' || l.buy == null ? null : parseFloat(l.buy),
      image: l.image || null,
    });
  }

  const btn = document.querySelector('#preorder-modal .inv-gen-btn');
  btn.textContent = 'Skapar…'; btn.disabled = true;
  try {
    const r = await api('/api/sales', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId || null,
        customer_name: isWalkin ? walkinName : null,
        is_preorder: true,
        eta_weeks_min: Number.isFinite(min) ? min : null,
        eta_weeks_max: Number.isFinite(max) ? max : null,
        items,
      }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); showToast(d.error || 'Kunde inte skapa förbeställningen', 'error'); return; }
    const d = await r.json();
    // Kunden förbetalar oftast — då ska den räknas i avräkningen direkt
    if (paid && d.sale?.id) {
      await api(`/api/sales/${d.sale.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) })
        .catch(() => {});
    }
    closePreorderModal();
    showToast(items.length > 1 ? `Förbeställning skapad — ${items.length} varor` : 'Förbeställning skapad', 'success');
    if (typeof loadSalesHistory === 'function') loadSalesHistory();
  } catch { showToast('Anslutningsfel', 'error'); }
  finally { btn.textContent = 'Skapa förbeställning'; btn.disabled = false; }
}

// ── I Historik ──
async function markPreorderArrived(saleId) {
  if (!confirm('Markera att varan har kommit in?')) return;
  try {
    const r = await api(`/api/sales/${saleId}/arrived`, { method: 'POST' });
    if (!r.ok) { const d = await r.json().catch(() => ({})); showToast(d.error || 'Kunde inte spara', 'error'); return; }
    showToast('Markerad som inkommen — kunden har fått en notis', 'success');
    loadSalesHistory();
  } catch { showToast('Anslutningsfel', 'error'); }
}

// Leverantörsfakturan hängs på ordern. Den är inköpets underlag i bokföringen,
// eftersom paret aldrig går genom lagret och alltså aldrig loggas av importen.
function pickSupplierDoc(saleId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,application/pdf';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    showToast('Laddar upp…', 'ok');
    try {
      const form = new FormData();
      form.append('files', file, file.name);
      const up = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!up.ok) { showToast('Uppladdningen misslyckades', 'error'); return; }
      const ud = await up.json();
      const url = ud.files?.[0]?.url;
      if (!url) { showToast('Uppladdningen misslyckades', 'error'); return; }
      const r = await api(`/api/sales/${saleId}/supplier-doc`, { method: 'POST', body: JSON.stringify({ document_url: url }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); showToast(d.error || 'Kunde inte spara', 'error'); return; }
      const d = await r.json();
      showToast(d.logged ? 'Faktura sparad och inköpet bokfört' : 'Faktura sparad', 'success');
      loadSalesHistory();
    } catch { showToast('Anslutningsfel', 'error'); }
  };
  input.click();
}

// Raden i Historik: vad som återstår att göra med förbeställningen
function preorderActionsHTML(sale) {
  const doc = sale.supplier_doc_url;
  return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
    <div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Förbeställning</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${sale.arrived_at
        ? `<span style="font-size:12px;color:#66dd99;padding:6px 0">✓ Inkommen ${new Date(sale.arrived_at).toLocaleDateString('sv-SE')}</span>`
        : `<button onclick="event.stopPropagation();markPreorderArrived('${sale.id}')" style="background:rgba(187,136,255,.13);border:1px solid rgba(187,136,255,.3);border-radius:8px;color:#bb88ff;font-size:13px;padding:6px 12px;cursor:pointer;font-family:inherit">Varan har kommit</button>`}
      ${doc
        ? `<a href="${esc(doc)}" target="_blank" onclick="event.stopPropagation()" style="font-size:13px;color:#7aabff;padding:6px 12px;text-decoration:none;border:1px solid rgba(100,150,255,.3);border-radius:8px">Leverantörsfaktura →</a>`
        : `<button onclick="event.stopPropagation();pickSupplierDoc('${sale.id}')" style="background:none;border:1px solid var(--border);border-radius:8px;color:var(--text2);font-size:13px;padding:6px 12px;cursor:pointer;font-family:inherit">Lägg till leverantörsfaktura</button>`}
    </div>
    ${doc ? '' : `<div style="font-size:11px;color:var(--text3);margin-top:6px;line-height:1.45">Cartier-fakturan är inköpets underlag i bokföringen — varan går aldrig genom lagret.</div>`}
  </div>`;
}

// Texten kunden och ni ser: hur länge sedan, och hur långt kvar
function preorderStatusText(sale) {
  const from = new Date(sale.created_at);
  const days = Math.max(0, Math.floor((Date.now() - from) / 86400000));
  const since = days === 0 ? 'idag' : days === 1 ? 'igår' : `för ${days} dagar sedan`;
  if (sale.arrived_at) return `Beställd ${since} · inkommen`;
  const min = sale.eta_weeks_min, max = sale.eta_weeks_max;
  if (min == null && max == null) return `Beställd ${since}`;
  const latest = preorderDate(from, Math.max(min ?? 0, max ?? 0));
  if (Date.now() > latest.getTime()) return `Beställd ${since} · försenad`;
  return `Beställd ${since} · väntas ${preorderWindowText(from, min ?? 0, max ?? 0)}`;
}
