// ── Betalningar på en försäljning (kvitton på banköverföringar) ──
// Laddas lazy när en order fälls ut, så en saknad tabell (före migration 009)
// aldrig kan sänka hela historiklistan.
let payModalSaleId = null;
let payModalSid = null;
let payImageBlob = null;
const loadedPayments = new Set();

// Receipts must keep the whole frame — compressInvImage centre-crops to a
// square, which would cut the amount or reference off a bank screenshot.
function compressReceipt(file, cb) {
  const reader = new FileReader();
  reader.onload = e => {
    const image = new Image();
    image.onload = () => {
      const MAX = 1600;
      const scale = Math.min(1, MAX / Math.max(image.width, image.height));
      const w = Math.round(image.width * scale);
      const h = Math.round(image.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(image, 0, 0, w, h);
      canvas.toBlob(blob => { if (blob) cb(blob, URL.createObjectURL(blob)); }, 'image/jpeg', 0.85);
    };
    image.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function loadSalePayments(saleId, sid) {
  const box = document.getElementById('pay-' + sid);
  if (!box) return;
  try {
    const r = await api(`/api/sales/${saleId}/payments`);
    if (!r.ok) { box.innerHTML = ''; return; }
    const d = await r.json();
    renderPayments(sid, saleId, d.payments || []);
    loadedPayments.add(sid);
  } catch { box.innerHTML = ''; }
}

function renderPayments(sid, saleId, payments) {
  const box = document.getElementById('pay-' + sid);
  if (!box) return;
  const rows = payments.map(p => {
    const date = new Date(p.paid_at).toLocaleDateString('sv-SE', { day: '2-digit', month: 'short', year: 'numeric' });
    const bits = [date];
    if (p.amount != null) bits.push(`€ ${Number(p.amount).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    if (p.note) bits.push(esc(p.note));
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--border)">
      ${p.image_url
        ? `<img src="${p.image_url}" onclick="event.stopPropagation();openLightbox('${p.image_url}')" style="width:38px;height:38px;object-fit:cover;border-radius:6px;cursor:pointer;flex-shrink:0">`
        : `<div style="width:38px;height:38px;border-radius:6px;background:var(--surface);flex-shrink:0"></div>`}
      <div style="flex:1;min-width:0;font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis">${bits.join(' · ')}</div>
      <button onclick="event.stopPropagation();deletePayment('${saleId}','${p.id}','${sid}')" style="background:none;border:none;color:var(--text3);font-size:14px;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0" title="Ta bort">✕</button>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Betalningar</div>
    ${rows}
    <button onclick="event.stopPropagation();openPaymentModal('${saleId}','${sid}')" style="background:none;border:1px dashed var(--border);border-radius:8px;color:var(--text3);font-size:12px;padding:7px 12px;cursor:pointer;font-family:inherit;margin-top:8px;width:100%">+ Lägg till betalning</button>`;
}

function openPaymentModal(saleId, sid) {
  payModalSaleId = saleId;
  payModalSid = sid;
  payImageBlob = null;
  document.getElementById('pay-amount').value = '';
  document.getElementById('pay-note').value = '';
  document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('pay-file').value = '';
  document.getElementById('pay-preview').innerHTML = '';
  document.getElementById('payment-modal').classList.add('open');
}

function closePaymentModal() {
  document.getElementById('payment-modal').classList.remove('open');
}

function handlePayImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  compressReceipt(file, (blob, url) => {
    payImageBlob = blob;
    document.getElementById('pay-preview').innerHTML =
      `<img src="${url}" style="max-width:100%;max-height:180px;border-radius:8px;display:block;margin-top:8px">`;
  });
}

async function savePayment() {
  const btn = document.querySelector('#payment-modal .inv-gen-btn');
  btn.disabled = true;
  try {
    let imageUrl = null;
    if (payImageBlob) {
      btn.textContent = 'Laddar upp bild…';
      imageUrl = await uploadProductImage(payImageBlob);
      if (!imageUrl) { showToast('Bilduppladdningen misslyckades', 'error'); return; }
    }
    btn.textContent = 'Sparar…';
    const r = await api(`/api/sales/${payModalSaleId}/payments`, {
      method: 'POST',
      body: JSON.stringify({
        amount: document.getElementById('pay-amount').value,
        paid_at: document.getElementById('pay-date').value,
        image_url: imageUrl,
        note: document.getElementById('pay-note').value,
      }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); showToast(d.error || 'Kunde inte spara', 'error'); return; }
    closePaymentModal();
    showToast('Betalning registrerad', 'success');
    loadSalePayments(payModalSaleId, payModalSid);
  } catch { showToast('Anslutningsfel', 'error'); }
  finally { btn.textContent = 'Spara'; btn.disabled = false; }
}

async function deletePayment(saleId, id, sid) {
  if (!confirm('Ta bort denna betalning?')) return;
  try {
    const r = await api(`/api/sales/${saleId}/payments/${id}`, { method: 'DELETE' });
    if (!r.ok) { showToast('Kunde inte ta bort', 'error'); return; }
    loadSalePayments(saleId, sid);
  } catch { showToast('Anslutningsfel', 'error'); }
}
