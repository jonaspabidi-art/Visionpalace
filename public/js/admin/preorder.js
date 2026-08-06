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
  for (const [id, val] of [['pre-walkin-name', ''], ['pre-ref', ''], ['pre-name', ''],
    ['pre-qty', '1'], ['pre-sell', ''], ['pre-buy', ''],
    ['pre-eta-min', String(PREORDER_DEFAULT_WEEKS[0])], ['pre-eta-max', String(PREORDER_DEFAULT_WEEKS[1])]]) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }
  document.getElementById('pre-paid').checked = true;
  document.getElementById('pre-ref-hint').textContent = '';
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

// Har vi sålt modellen förut kommer namn och priser tillbaka — samma uppslag
// som fakturaimporten använder
async function lookupPreorderRef() {
  const ref = document.getElementById('pre-ref').value.trim().toUpperCase();
  const hint = document.getElementById('pre-ref-hint');
  document.getElementById('pre-ref').value = ref;
  if (!ref) { hint.textContent = ''; return; }
  try {
    const r = await api(`/api/inventory/ref-lookup?code=${encodeURIComponent(ref)}`);
    if (!r.ok) { hint.textContent = ''; return; }
    const d = await r.json();
    const m = d.match;
    if (!m) { hint.textContent = 'Ny modell — fyll i namn och priser själv.'; return; }
    const nameEl = document.getElementById('pre-name');
    const sellEl = document.getElementById('pre-sell');
    const buyEl = document.getElementById('pre-buy');
    if (!nameEl.value.trim() && m.name) nameEl.value = m.name;
    if (!sellEl.value && m.sell_price != null) sellEl.value = m.sell_price;
    if (!buyEl.value && m.buy_price != null) buyEl.value = m.buy_price;
    _preorderImage = m.image || null;
    hint.textContent = 'Känd modell — namn och priser hämtade.';
  } catch { hint.textContent = ''; }
}
let _preorderImage = null;

async function createPreorder() {
  const picked = document.getElementById('pre-client-pick').value;
  const isWalkin = picked === '__walkin';
  const clientId = isWalkin ? '' : picked;
  const walkinName = document.getElementById('pre-walkin-name').value.trim();
  const name = document.getElementById('pre-name').value.trim();
  const ref = document.getElementById('pre-ref').value.trim().toUpperCase();
  const qty = parseInt(document.getElementById('pre-qty').value, 10) || 1;
  const sell = document.getElementById('pre-sell').value;
  const buy = document.getElementById('pre-buy').value;
  const min = parseInt(document.getElementById('pre-eta-min').value, 10);
  const max = parseInt(document.getElementById('pre-eta-max').value, 10);
  const paid = document.getElementById('pre-paid').checked;

  if (!clientId && !isWalkin) { showToast('Välj en köpare', 'error'); return; }
  if (isWalkin && !walkinName) { showToast('Skriv namnet på köparen', 'error'); return; }
  if (!name) { showToast('Skriv namn på varan', 'error'); return; }
  if (!(parseFloat(sell) > 0)) { showToast('Ange säljpris', 'error'); return; }

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
        items: [{
          name, ref_code: ref || null, qty,
          sell_price: sell === '' ? null : parseFloat(sell),
          buy_price: buy === '' ? null : parseFloat(buy),
          image: _preorderImage,
        }],
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
    _preorderImage = null;
    showToast('Förbeställning skapad', 'success');
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
