// ── Avräkning (provisionskonto) ──
// Saldot räknas fram på servern ur försäljningarna; här visas det bara.
let settlementData = null;
let settlementEntryType = 'payout';

// The ledger is kept in kronor — that's the currency actually paid out
function kr(n) {
  return `${(Number(n) || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
}
// Same, but drops ",00" — öre are noise on the headline figures
function krShort(n) {
  const v = Number(n) || 0;
  const round = Math.abs(v % 1) < 0.005;
  return `${v.toLocaleString('sv-SE', { minimumFractionDigits: round ? 0 : 2, maximumFractionDigits: 2 })} kr`;
}
function eur(n) {
  return `€ ${(Number(n) || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadSettlement() {
  const card = document.getElementById('settlement-card');
  if (!card) return;
  try {
    const r = await api('/api/settlement');
    // 403 = this admin isn't part of the settlement; hide it entirely
    if (r.status === 403) { card.style.display = 'none'; card.innerHTML = ''; return; }
    const d = await r.json().catch(() => ({}));
    // Not configured yet — stay silent so nothing changes until the SQL is run
    if (d.not_configured) { card.style.display = 'none'; card.innerHTML = ''; return; }
    if (!r.ok) { renderSettlementNotice(d.error || 'Kunde inte läsa avräkningen'); return; }
    settlementData = d;
    renderSettlement(d);
  } catch {
    renderSettlementNotice('Anslutningsfel');
  }
}

function renderSettlementNotice(msg) {
  const card = document.getElementById('settlement-card');
  if (!card) return;
  card.style.display = '';
  card.innerHTML = `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:12px;color:var(--text3)">${esc(msg)}</div>`;
}

function renderSettlement(d) {
  const card = document.getElementById('settlement-card');
  if (!card) return;
  card.style.display = '';
  const isSeller = d.role === 'seller';
  const label = isSeller ? 'Att få ut' : 'Att betala ut';
  const positive = d.balance >= 0;

  const monthRows = Object.keys(d.months || {}).sort((a, b) => b.localeCompare(a)).slice(0, 12).map(key => {
    const [yr, mo] = key.split('-');
    const name = new Date(yr, mo - 1).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
    return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
      <span style="color:var(--text2);text-transform:capitalize">${esc(name)}</span>
      <span style="color:var(--text)">${kr(d.months[key])}</span>
    </div>`;
  }).join('') || '<div style="color:var(--text3);font-size:12px;padding:6px 0">Inga betalda försäljningar ännu</div>';

  const entryRows = (d.entries || []).map(e => {
    const date = new Date(e.occurred_at).toLocaleDateString('sv-SE', { day: '2-digit', month: 'short', year: 'numeric' });
    const isPayout = e.type === 'payout';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">
      <div style="flex:1;min-width:0">
        <div style="color:var(--text)">${isPayout ? 'Utbetalning' : 'Ingående saldo'}${e.note ? ` · <span style="color:var(--text3)">${esc(e.note)}</span>` : ''}</div>
        <div style="color:var(--text3);font-size:11px;margin-top:1px">${date}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <span style="color:${isPayout ? '#66dd99' : 'var(--text2)'};font-weight:600">${isPayout ? '−' : '+'} ${kr(e.amount)}</span>
        <button onclick="deleteSettlementEntry('${e.id}')" style="background:none;border:none;color:var(--text3);font-size:14px;cursor:pointer;padding:0 2px;line-height:1" title="Ta bort">✕</button>
      </div>
    </div>`;
  }).join('') || '<div style="color:var(--text3);font-size:12px;padding:6px 0">Inga utbetalningar registrerade</div>';

  // The front of the card answers one question: how much is owed right now.
  // Everything explaining HOW that number came about lives behind Detaljer.
  const warning = d.missing_buy_price
    ? `<div style="color:#ff9944;font-size:12px;margin-top:8px">⚠ ${d.missing_buy_price} sälj saknar inköpspris — ger 0 i provision</div>`
    : '';

  const sumRow = (label, value, opts = {}) => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;${opts.total ? 'border-top:1px solid var(--border);margin-top:4px;padding-top:10px' : ''}">
      <span style="color:${opts.total ? 'var(--text)' : 'var(--text2)'};font-size:13px;${opts.total ? 'font-weight:700' : ''}">${label}</span>
      <span style="color:${opts.total ? (positive ? '#66dd99' : '#ff7a7a') : 'var(--text)'};font-size:13px;font-weight:${opts.total ? '800' : '600'}">${value}</span>
    </div>`;

  card.innerHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:16px">
      <div style="font-size:12px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.06em">${label}</div>
      <div style="font-size:34px;font-weight:800;color:${positive ? '#66dd99' : '#ff7a7a'};margin:4px 0 0;line-height:1.1">${krShort(d.balance)}</div>
      ${d.pending ? `<div style="font-size:12px;color:var(--text3);margin-top:6px">+ ${krShort(d.pending)} när obetalda köp betalas</div>` : ''}
      ${warning}
      <div style="display:flex;gap:8px;margin-top:14px">
        <button onclick="openSettlementModal()" style="flex:1;background:var(--blue);border:none;border-radius:10px;color:#1a1409;padding:11px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Registrera utbetalning</button>
        <button id="stl-detail-btn" onclick="toggleSettlementDetail()" style="background:var(--surface);border:1px solid var(--border);border-radius:10px;color:var(--text2);padding:11px 14px;font-size:14px;cursor:pointer;font-family:inherit">Detaljer</button>
      </div>

      <div id="settlement-detail" style="display:none;margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
        <div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:2px">Så räknas saldot</div>
        ${sumRow(`Intjänat (${d.commission_pct} % av vinsten)`, kr(d.earned))}
        ${d.opening ? sumRow('Ingående saldo', kr(d.opening)) : ''}
        ${sumRow('Utbetalt', `− ${kr(d.paid_out)}`)}
        ${sumRow(label, kr(d.balance), { total: true })}
        <div style="font-size:11px;color:var(--text3);margin-top:8px;line-height:1.5">
          Vinsten räknas i euro (${eur(d.earned_eur)}) och växlas till kronor med kursen 1 € = ${d.eur_sek_rate} kr.
        </div>

        <div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin:18px 0 4px">Intjänat per månad</div>
        ${monthRows}

        <div style="font-size:10px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin:18px 0 4px">Utbetalningar</div>
        ${entryRows}
      </div>
    </div>`;
}

function toggleSettlementDetail() {
  const el = document.getElementById('settlement-detail');
  const btn = document.getElementById('stl-detail-btn');
  if (!el) return;
  const open = el.style.display === 'none';
  el.style.display = open ? 'block' : 'none';
  if (btn) btn.textContent = open ? 'Dölj' : 'Detaljer';
}

function openSettlementModal() {
  setSettlementType('payout');
  document.getElementById('stl-amount').value = '';
  document.getElementById('stl-note').value = '';
  document.getElementById('stl-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('settlement-modal').classList.add('open');
}

function closeSettlementModal() {
  document.getElementById('settlement-modal').classList.remove('open');
}

function setSettlementType(type) {
  settlementEntryType = type === 'opening' ? 'opening' : 'payout';
  document.getElementById('stl-btn-payout').classList.toggle('active', settlementEntryType === 'payout');
  document.getElementById('stl-btn-opening').classList.toggle('active', settlementEntryType === 'opening');
  document.getElementById('stl-hint').textContent = settlementEntryType === 'payout'
    ? 'Pengar han har betalat ut till er. Minskar saldot.'
    : 'Skuld från tiden innan appen räknade — fylls i en gång. Ökar saldot.';
}

async function saveSettlementEntry() {
  const amount = document.getElementById('stl-amount').value;
  if (!(parseFloat(amount) > 0)) { showToast('Ange ett belopp', 'error'); return; }
  const btn = document.querySelector('#settlement-modal .inv-gen-btn');
  btn.textContent = 'Sparar…'; btn.disabled = true;
  try {
    const r = await api('/api/settlement/entry', {
      method: 'POST',
      body: JSON.stringify({
        type: settlementEntryType,
        amount,
        occurred_at: document.getElementById('stl-date').value,
        note: document.getElementById('stl-note').value,
      }),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); showToast(d.error || 'Kunde inte spara', 'error'); return; }
    closeSettlementModal();
    showToast('Registrerad', 'success');
    loadSettlement();
  } catch { showToast('Anslutningsfel', 'error'); }
  finally { btn.textContent = 'Spara'; btn.disabled = false; }
}

async function deleteSettlementEntry(id) {
  if (!confirm('Ta bort denna post?')) return;
  try {
    const r = await api(`/api/settlement/entry/${id}`, { method: 'DELETE' });
    if (!r.ok) { showToast('Kunde inte ta bort', 'error'); return; }
    loadSettlement();
  } catch { showToast('Anslutningsfel', 'error'); }
}
