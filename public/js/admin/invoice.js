// ── Invoice ──
const INV_COMPANY = {
  name: 'C.lunettes AB',
  vat: 'SE559168839 4SE',
  address: '411 15 Gothenburg, Sweden',
  addressSv: '411 15 Göteborg',
  bankName: 'Danske Bank',
  iban: 'SE9112000000012350396061',
  bankAddress: 'Oestra hamngatan 13, 404 22',
  bic: 'DABASESX',
  clearing: '1235',
  accountNumber: '0396061',
};

function populateInvClientPicker() {
  const sel = document.getElementById('inv-client-pick');
  const val = sel.value;
  sel.innerHTML = '<option value="">Klient i VP</option>' +
    clients.filter(c => !c.is_inactive).map(c =>
      `<option value="${c.id}">${esc(c.admin_label || c.display_name)}</option>`
    ).join('');
  if (val) sel.value = val;
  if (!document.getElementById('inv-date').value) {
    document.getElementById('inv-date').value = new Date().toISOString().split('T')[0];
  }
  if (!invLineItems.length) { addInvLine(); addInvLine(); }
  renderInvLines();
}

function fillInvClient(clientId) {
  if (!clientId) return;
  const c = clients.find(x => x.id === clientId);
  if (!c) return;
  document.getElementById('inv-cust-name').value = c.full_name || c.admin_label || c.display_name;
  const addrParts = [c.address, c.phone].filter(Boolean);
  if (addrParts.length) document.getElementById('inv-cust-addr').value = addrParts.join('\n');
}

function setInvCustType(type) {
  invCustType = type;
  document.getElementById('inv-btn-company').classList.toggle('active', type === 'company');
  document.getElementById('inv-btn-private').classList.toggle('active', type === 'private');
  document.getElementById('inv-lbl-name').textContent = type === 'private' ? 'Namn' : 'Företagsnamn';
  document.getElementById('inv-cust-name').placeholder = type === 'private' ? 'ex. Anna Svensson' : 'ex. GMC PUB SRL';
  document.getElementById('inv-biz-fields').style.display = type === 'private' ? 'none' : '';
}

function setInvLang(lang) {
  invLang = lang;
  document.getElementById('inv-btn-lang-en').classList.toggle('active', lang === 'en');
  document.getElementById('inv-btn-lang-sv').classList.toggle('active', lang === 'sv');
  renderInvLines();
}

function switchInvTab(tab) {
  document.getElementById('inv-panel-form').style.display = tab === 'form' ? '' : 'none';
  document.getElementById('inv-panel-preview').style.display = tab === 'preview' ? '' : 'none';
  document.getElementById('inv-tab-form').classList.toggle('active', tab === 'form');
  document.getElementById('inv-tab-preview').classList.toggle('active', tab === 'preview');
  if (tab === 'preview') scaleInvDoc();
}

function scaleInvDoc() {
  const outer = document.getElementById('inv-scale-outer');
  const inner = document.getElementById('inv-doc-inner');
  if (!outer || !inner) return;
  const available = outer.offsetWidth;
  const scale = Math.min(1, available / 794);
  inner.style.transform = scale < 1 ? `scale(${scale})` : '';
  outer.style.height = scale < 1 ? Math.ceil(1123 * scale) + 'px' : '';
}

function addInvLine(desc = '', qty = '1', price = '', vat = '0') {
  const id = invLineNextId++;
  invLineItems.push({ id, desc, qty, price, vat });
  renderInvLines();
}

function removeInvLine(id) {
  invLineItems = invLineItems.filter(r => r.id !== id);
  renderInvLines();
}

function updateInvLine(id, field, value) {
  const item = invLineItems.find(r => r.id === id);
  if (item) item[field] = value;
}

function renderInvLines() {
  const container = document.getElementById('inv-line-items');
  if (!container) return;
  container.innerHTML = '';
  invLineItems.forEach(item => {
    const div = document.createElement('div');
    div.className = 'inv-line-item';
    div.innerHTML = `
      <button class="inv-line-remove" title="Ta bort">×</button>
      <div class="inv-field">
        <label>Beskrivning / Artikelnr</label>
        <input class="inv-input" type="text" placeholder="ex. CT0622S-005" data-field="desc">
      </div>
      <div class="inv-row-grid">
        <div class="inv-field">
          <label>Antal</label>
          <input class="inv-input" type="number" min="0" step="any" inputmode="decimal" data-field="qty">
        </div>
        <div class="inv-field">
          <label>Pris (${invLang === 'sv' ? 'kr' : '€'})</label>
          <input class="inv-input" type="number" min="0" step="0.01" placeholder="0.00" inputmode="decimal" data-field="price">
        </div>
      </div>
      <div class="inv-field">
        <label>Momssats (%)</label>
        <select class="inv-input" data-field="vat">
          <option value="0">0%</option>
          <option value="6">6%</option>
          <option value="12">12%</option>
          <option value="25">25%</option>
        </select>
      </div>`;
    div.querySelector('[data-field="desc"]').value = item.desc;
    div.querySelector('[data-field="qty"]').value = item.qty;
    div.querySelector('[data-field="price"]').value = item.price;
    div.querySelector('[data-field="vat"]').value = item.vat;
    div.querySelector('.inv-line-remove').addEventListener('click', () => removeInvLine(item.id));
    div.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('change', () => updateInvLine(item.id, input.dataset.field, input.value));
    });
    container.appendChild(div);
  });
}

// Letter-spaced heading text, e.g. ls('BILLED TO') → 'B I L L E D &nbsp; T O'
function ls(text) {
  return text.split(' ').map(w => w.split('').join(' ')).join(' &nbsp; ');
}

const INV_TEXT = {
  en: {
    title: 'INVOICE', payTo: 'PAY TO', custCompany: 'BILLED TO', custPrivate: 'CUSTOMER',
    colDesc: 'Description', colQty: 'Quantity', colVat: 'VAT', colPrice: 'Unit Price', colAmount: 'Amount',
    net: 'Netto', vatLabel: 'VAT', total: 'TOTAL',
    bankDetails: 'Bank details', bankName: 'Bank Name', bankAddress: 'Bank Address',
    paymentTerms: 'Payment terms',
    paymentText: days => `Payment is required within ${days} business days of invoice date.<br>Thank you for your business.`,
    vatFieldLabel: v => `VAT: ${v}`, regFieldLabel: r => `Reg: ${r}`,
    currency: (fmt, n) => `€ ${fmt(n)}`,
    address: () => INV_COMPANY.address,
  },
  sv: {
    title: 'FAKTURA', payTo: 'BETALA TILL', custCompany: 'KUND', custPrivate: 'KUND',
    colDesc: 'Beskrivning', colQty: 'Antal', colVat: 'Moms', colPrice: 'Á-pris', colAmount: 'Belopp',
    net: 'Netto', vatLabel: 'Moms', total: 'TOTALT',
    bankDetails: 'Bankuppgifter', bankName: 'Bank', bankAddress: 'Bankadress',
    paymentTerms: 'Betalningsvillkor',
    paymentText: days => `Betalning ska ske inom ${days} bankdagar från fakturadatum.<br>Tack för ditt köp.`,
    vatFieldLabel: v => `Moms-/Org.nr: ${v}`, regFieldLabel: r => `Reg.nr: ${r}`,
    currency: (fmt, n) => `${fmt(n)} kr`,
    address: () => INV_COMPANY.addressSv,
  },
};

function generateInvoice() {
  const T = INV_TEXT[invLang] || INV_TEXT.en;
  const invNumber = document.getElementById('inv-number').value.trim() || '—';
  const invDate = document.getElementById('inv-date').value;
  const invDays = document.getElementById('inv-days').value || '14';
  const custName = document.getElementById('inv-cust-name').value.trim() || '—';
  const custAddr = document.getElementById('inv-cust-addr').value.trim().replace(/\n/g, '<br>') || '';
  const custVat = document.getElementById('inv-cust-vat').value.trim();
  const custReg = document.getElementById('inv-cust-reg').value.trim();
  const dateFormatted = invDate ? new Date(invDate + 'T12:00:00').toLocaleDateString('sv-SE') : '—';

  const vatGroups = {};
  let subtotal = 0;
  invLineItems.forEach(item => {
    const qty = parseFloat(item.qty) || 0;
    const price = parseFloat(item.price) || 0;
    const vat = parseFloat(item.vat) || 0;
    const net = qty * price;
    subtotal += net;
    if (!vatGroups[vat]) vatGroups[vat] = 0;
    vatGroups[vat] += net * (vat / 100);
  });
  const totalVat = Object.values(vatGroups).reduce((a, b) => a + b, 0);
  const total = subtotal + totalVat;

  function fmt(n) { return n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  const money = n => T.currency(fmt, n);

  const rowsHtml = invLineItems.map(item => {
    const qty = parseFloat(item.qty) || 0;
    const price = parseFloat(item.price) || 0;
    const vat = parseFloat(item.vat) || 0;
    return `<tr>
      <td style="font-weight:600;padding:12px 0;border-bottom:1px solid #eee;font-size:12px">${esc(item.desc) || '—'}</td>
      <td style="text-align:right;padding:12px 0;border-bottom:1px solid #eee;font-size:12px">${qty % 1 === 0 ? qty : fmt(qty)}</td>
      <td style="text-align:right;padding:12px 0;border-bottom:1px solid #eee;font-size:12px">${vat}%</td>
      <td style="text-align:right;padding:12px 0;border-bottom:1px solid #eee;font-size:12px">${money(price)}</td>
      <td style="text-align:right;padding:12px 0;border-bottom:1px solid #eee;font-size:12px">${money(qty * price)}</td>
    </tr>`;
  }).join('');

  const vatRowsHtml = Object.entries(vatGroups).map(([rate, amount]) =>
    `<div style="display:flex;gap:32px;font-size:11px;color:#555;margin-top:6px">
      <span style="min-width:120px;text-align:right">${T.vatLabel} ${rate}%</span>
      <span style="min-width:80px;text-align:right">${money(amount)}</span>
    </div>`).join('');

  const isPrivate = invCustType === 'private';
  const custExtra = isPrivate ? '' : [
    custVat ? T.vatFieldLabel(esc(custVat)) : '',
    custReg ? T.regFieldLabel(esc(custReg)) : '',
  ].filter(Boolean).join('<br>');

  const bankRowsHtml = invLang === 'sv' ? `
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">${T.bankName}</span><span style="font-weight:500">${esc(INV_COMPANY.bankName)}</span></div>
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">Clearingnummer</span><span style="font-weight:500">${esc(INV_COMPANY.clearing)}</span></div>
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">Kontonummer</span><span style="font-weight:500">${esc(INV_COMPANY.accountNumber)}</span></div>
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">${T.bankAddress}</span><span style="font-weight:500">${esc(INV_COMPANY.bankAddress)}</span></div>` : `
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">${T.bankName}</span><span style="font-weight:500">${esc(INV_COMPANY.bankName)}</span></div>
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">IBAN</span><span style="font-weight:500">${esc(INV_COMPANY.iban)}</span></div>
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">${T.bankAddress}</span><span style="font-weight:500">${esc(INV_COMPANY.bankAddress)}</span></div>
        <div style="display:flex;gap:8px;font-size:11px;margin-bottom:4px"><span style="color:#999;min-width:90px">BIC / Swift</span><span style="font-weight:500">${esc(INV_COMPANY.bic)}</span></div>`;

  const docHtml = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:48px">
      <div style="font-size:36px;font-weight:800;letter-spacing:10px;text-transform:uppercase;color:#111">${ls(T.title)}</div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:700;color:#111;letter-spacing:2px;margin-bottom:4px"># ${esc(invNumber)}</div>
        <div style="font-size:12px;color:#555">${dateFormatted}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:40px;padding-bottom:32px;border-bottom:2px solid #111">
      <div>
        <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:10px;font-weight:600">${ls(T.payTo)}</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">${esc(INV_COMPANY.name)}</div>
        <div style="font-size:11px;color:#444;line-height:1.8">${esc(INV_COMPANY.vat)}<br>${esc(T.address())}</div>
      </div>
      <div>
        <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#999;margin-bottom:10px;font-weight:600">${isPrivate ? ls(T.custPrivate) : ls(T.custCompany)}</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">${esc(custName)}</div>
        <div style="font-size:11px;color:#444;line-height:1.8">${custAddr}${custExtra ? '<br>' + custExtra : ''}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
      <thead>
        <tr style="border-bottom:1px solid #111">
          <th style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;padding:0 0 10px;text-align:left;font-weight:600;width:40%">${T.colDesc}</th>
          <th style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;padding:0 0 10px;text-align:right;font-weight:600">${T.colQty}</th>
          <th style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;padding:0 0 10px;text-align:right;font-weight:600">${T.colVat}</th>
          <th style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;padding:0 0 10px;text-align:right;font-weight:600">${T.colPrice}</th>
          <th style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;padding:0 0 10px;text-align:right;font-weight:600">${T.colAmount}</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="margin-top:16px;border-top:2px solid #111;padding-top:16px;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
      <div style="display:flex;gap:32px;font-size:11px;color:#555">
        <span style="min-width:120px;text-align:right">${T.net}</span>
        <span style="min-width:80px;text-align:right">${money(subtotal)}</span>
      </div>
      ${vatRowsHtml}
      <div style="display:flex;gap:32px;font-size:16px;font-weight:800;margin-top:8px;letter-spacing:1px;border-top:1.5px solid #111;padding-top:8px">
        <span style="min-width:120px;text-align:right">${ls(T.total)}</span>
        <span style="min-width:80px;text-align:right">${money(total)}</span>
      </div>
    </div>
    <div style="margin-top:auto;padding-top:40px;border-top:1px solid #ddd;display:grid;grid-template-columns:1fr 1fr;gap:40px">
      <div>
        <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:10px;font-weight:600">${T.bankDetails}</div>${bankRowsHtml}
      </div>
      <div>
        <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#999;margin-bottom:10px;font-weight:600">${T.paymentTerms}</div>
        <div style="font-size:10px;color:#888;line-height:1.7;padding-top:8px">
          ${T.paymentText(esc(invDays))}
        </div>
      </div>
    </div>`;

  // Create scale wrapper on first generate
  let outer = document.getElementById('inv-scale-outer');
  let inner = document.getElementById('inv-doc-inner');
  if (!outer) {
    const docEl = document.getElementById('inv-doc');
    docEl.removeAttribute('class');
    docEl.style.cssText = 'overflow:hidden;background:none';
    outer = document.createElement('div');
    outer.id = 'inv-scale-outer';
    outer.style.cssText = 'overflow:hidden;width:100%';
    inner = document.createElement('div');
    inner.id = 'inv-doc-inner';
    inner.style.cssText = 'background:#fff;width:794px;min-height:1123px;padding:60px 64px;box-shadow:0 4px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;font-size:12px;line-height:1.5;color:#111;transform-origin:top left;flex-shrink:0;font-family:Helvetica Neue,Arial,sans-serif';
    outer.appendChild(inner);
    docEl.innerHTML = '';
    docEl.appendChild(outer);
  }
  inner.innerHTML = docHtml;
  switchInvTab('preview');
}

async function saveInvPDF() {
  const inner = document.getElementById('inv-doc-inner');
  if (!inner) { alert('Generera fakturan först'); return; }
  if (!window.html2pdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    }).catch(() => { alert('Kunde inte ladda PDF-biblioteket'); });
  }
  if (!window.html2pdf) return;
  const invNumber = document.getElementById('inv-number').value.trim() || 'invoice';
  const outer = document.getElementById('inv-scale-outer');
  const savedTransform = inner.style.transform;
  const savedOuterHeight = outer ? outer.style.height : '';
  inner.style.transform = '';
  inner.style.minHeight = '0';
  if (outer) outer.style.height = '';
  await html2pdf().set({
    margin: 0,
    filename: `invoice-${invNumber}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  }).from(inner).save();
  inner.style.transform = savedTransform;
  inner.style.minHeight = '';
  if (outer) outer.style.height = savedOuterHeight;
  scaleInvDoc();
}
