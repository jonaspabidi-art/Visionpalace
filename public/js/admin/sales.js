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
  const disc = document.getElementById('sale-discount');
  if (disc) disc.value = '';
  setDiscountMode('abs');
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
  const d = document.getElementById('sale-discount');
  if (d) d.value = '';
  setDiscountMode('abs');
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

// Rabatt på hela köpet. Anges i euro eller procent — procent är naturligt när
// någon tar flera par, belopp när man rundar av.
let saleDiscountMode = 'abs';   // 'abs' | 'pct'

function setDiscountMode(mode) {
  saleDiscountMode = mode === 'pct' ? 'pct' : 'abs';
  document.getElementById('sale-disc-abs').classList.toggle('active', saleDiscountMode === 'abs');
  document.getElementById('sale-disc-pct').classList.toggle('active', saleDiscountMode === 'pct');
  document.getElementById('sale-disc-unit').textContent = saleDiscountMode === 'pct' ? '%' : '€';
  renderSaleCart();
}

// Varornas summa före frakt och rabatt
function saleSubtotal() {
  return [...saleCartItems, ...lensCartItems]
    .reduce((s, i) => s + (parseFloat(i.sell_price) || 0) * i.qty, 0);
}

// Rabatten i euro, oavsett hur den skrevs in. Kan aldrig bli större än varorna
// — en försäljning med negativ summa vore fel i både faktura och bokföring.
function saleDiscountAmount() {
  const raw = parseFloat(document.getElementById('sale-discount')?.value) || 0;
  if (raw <= 0) return 0;
  const sub = saleSubtotal();
  const amount = saleDiscountMode === 'pct' ? sub * Math.min(raw, 100) / 100 : raw;
  return Math.min(Math.round(amount * 100) / 100, sub);
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
  const discount = saleDiscountAmount();
  const eur = n => n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const total = allItems.reduce((s, i) => s + (parseFloat(i.sell_price) || 0) * i.qty, 0) + shipping - discount;
  document.getElementById('sale-total').textContent = `Totalt: € ${eur(total)}`;
  const hint = document.getElementById('sale-disc-hint');
  if (hint) {
    const sub = saleSubtotal();
    hint.textContent = discount > 0
      ? `− € ${eur(discount)} på varorna (${eur(sub)} → ${eur(sub - discount)}). Dras av på fakturan och i vinsten.`
      : 'Gäller hela köpet. Lämna tomt om ingen rabatt ges.';
  }
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
    const discount = saleDiscountAmount();
    // Varunamnen syns för kunden, som läser appen på engelska
    if (shipping > 0) items.push({ name: 'Shipping', ref_code: null, sell_price: shipping, qty: 1, image: null });
    // buy_price 0, inte null: rader utan inköpspris räknas som genomgång och
    // hoppas över i vinsten. Då hade rabatten sänkt omsättningen men inte
    // vinsten, och ni fått provision på pengar som aldrig kom in.
    if (discount > 0) items.push({ name: 'Discount', ref_code: null, sell_price: -discount, buy_price: 0, qty: 1, image: null });
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
    try { finishSaleUI(clientId, shipping, isWalkin ? walkinName : '', discount); }
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
function finishSaleUI(clientId, shipping, buyerName, discount) {
  _lastSaleClientId = clientId;
  _lastSaleBuyerName = buyerName || '';
  _lastSaleItems = [
    ...saleCartItems,
    ...lensCartItems.map(i => ({ ...i, name: `${i.name} (${i.color})` })),
    ...(shipping > 0 ? [{ name: 'Shipping', sell_price: shipping, qty: 1 }] : []),
    ...(discount > 0 ? [{ name: 'Discount', sell_price: -discount, qty: 1 }] : [])
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
    // Försäljningarna är prissatta i euro. Stod valutan kvar på kronor från en
    // tidigare faktura skulle samma siffror gå ut märkta "kr" — en faktura på
    // fel belopp, utan att något ser trasigt ut.
    setInvCurrency('EUR');
    // Anteckningarna hör till den faktura de skrevs för. Utan den här raden
    // följer förra kundens text med till nästa.
    const notesEl = document.getElementById('inv-notes');
    if (notesEl) notesEl.value = '';
    invLineItems = [];
    invLineNextId = 0;
    // Rabatterna ligger som egna minusrader i ordern. En parrabatt hör till sin
    // vara och följer med som avdrag PER styck på den raden, så kunden ser vad
    // ett par kostar efter rabatt — samma sak som i appens faktura. Rabatten
    // längst ner hör inte till någon vara och blir en egen rad.
    const PAR = 'Discount — ';
    const ärRabatt = i => {
      const n = String(i.name || '');
      return n === 'Discount' || n.startsWith(PAR);
    };
    // Nyckeln är namn OCH ref-kod: två modeller kan heta likadant med olika ref,
    // och då slogs deras rabatter ihop så att båda fick hela avdraget.
    const nyckel = (namn, ref) => `${namn}|${String(ref || '').trim().toUpperCase()}`;
    const perVara = new Map();
    let generell = 0;
    for (const i of items.filter(ärRabatt)) {
      const n = String(i.name || '');
      const qty = Math.max(1, parseInt(i.qty, 10) || 1);
      const total = Math.abs((parseFloat(i.sell_price) || 0) * qty);
      if (n.startsWith(PAR)) {
        const k = nyckel(n.slice(PAR.length), i.ref_code);
        perVara.set(k, (perVara.get(k) || 0) + total);
      } else generell += total;
    }
    items.filter(i => !ärRabatt(i)).forEach(item => {
      const qty = Math.max(1, parseInt(item.qty, 10) || 1);
      const avdrag = perVara.get(nyckel(String(item.name || ''), item.ref_code)) || 0;
      addInvLine(
        item.ref_code ? `${item.name} (${item.ref_code})` : item.name,
        String(item.qty || 1),
        item.sell_price != null ? String(item.sell_price) : '',
        '0',
        avdrag ? String(Math.round((avdrag / qty) * 100) / 100) : ''
      );
    });
    if (generell !== 0) addInvLine('Discount', '1', String(-generell), '0');
    renderInvLines();
    generateInvoice();
  }, 50);
}

// ── Redigera en obetald order ──
// Priser blir fel, en kund vill lägga till ett par, eller så ska en rabatt in
// i efterhand. Bara obetalda ordrar: en betald har passerat både kundens
// plånbok och avräkningen mellan delägarna.
//
// Raderna som redan finns bär sitt id. Nya rader plockas ur lagret och tar med
// sig vilka lagerrader de tagit, så att lagret stämmer efteråt.
let editSaleId = null;
let editLines = [];
let editRestock = true;
let editStockLoading = false;
let editStockFailed = false;
let editIsPreorder = false;

async function openEditSale(saleId) {
  const sale = _saleHistoryCache[saleId];
  if (!sale) return;
  if ((sale.status || 'unpaid') !== 'unpaid') {
    showToast('Bara obetalda ordrar går att ändra', 'error');
    return;
  }
  editSaleId = saleId;
  editRestock = true;
  editLines = (sale.sale_items || []).map(it => ({
    id: it.id,
    name: it.name,
    ref_code: it.ref_code || '',
    qty: it.qty || 1,
    maxQty: it.qty || 1,          // befintliga rader kan bara sänkas
    sell: it.sell_price == null ? '' : String(it.sell_price),
    buy: it.buy_price == null ? '' : String(it.buy_price),
    image: it.image || null,
    inventory_ids: null,
    discount: '',                 // avdrag per par för just den här varan
    discountId: null,             // raden i databasen rabatten redan har
    discountExact: null,          // exakt total från en äldre order, tills den rörs
  }));
  foldPairDiscounts();
  document.getElementById('edit-sale-title').textContent =
    `Ändra ${sale.invoice_number || 'order'}`;
  document.getElementById('edit-restock').checked = true;
  // En förbeställning tar aldrig ur lagret — varan finns ju inte hemma än. Där
  // måste man kunna skriva in en vara för hand; på en vanlig order vore det att
  // sälja något man inte har.
  editIsPreorder = !!sale.is_preorder;
  document.getElementById('edit-add-preorder-btn').style.display =
    editIsPreorder ? '' : 'none';
  renderEditLines();
  editStockLoading = true;
  renderEditStockList();
  document.getElementById('edit-sale-modal').classList.add('open');

  // Lagret finns bara i minnet om man varit inne på Lager-fliken. Gick man rakt
  // till Historik stod listan tom fast det fanns par att lägga till. Hämta det
  // alltid: lagret hinner ändras mellan att fliken lästes och ordern ändras.
  const ok = await ensureInvGroups();
  editStockLoading = false;
  if (editSaleId !== saleId) return;          // rutan hann stängas
  editStockFailed = !ok;
  renderEditStockList();
}

function closeEditSale() {
  document.getElementById('edit-sale-modal').classList.remove('open');
  editSaleId = null;
  editLines = [];
}

// En rabatt som hör till ett visst par sparas som en egen minusrad, döpt efter
// varan: "Discount — Cartier Première". Det kräver ingen ändring i databasen,
// det syns för kunden på fakturan, och vinsten sänks precis som för rabatten
// längst ner. I rutan vill man däremot se den som ett fält på varans rad, inte
// som en egen rad — annars blir listan dubbelt så lång.
const PAIR_DISCOUNT_PREFIX = 'Discount — ';
const pairDiscountName = name => PAIR_DISCOUNT_PREFIX + name;

function foldPairDiscounts() {
  const rest = [];
  for (const l of editLines) {
    if (!l.name.startsWith(PAIR_DISCOUNT_PREFIX)) { rest.push(l); continue; }
    const varan = l.name.slice(PAIR_DISCOUNT_PREFIX.length);
    const mål = editLines.find(x => x.name === varan && !x.name.startsWith(PAIR_DISCOUNT_PREFIX));
    // Hittas inte varan raden hörde till får rabatten stå kvar som egen rad,
    // hellre det än att den tyst försvinner ur ordern
    if (!mål) { rest.push(l); continue; }
    // Rabatten sparas numera per par: raden har samma antal som varan och
    // beloppet är avdraget PER par. Äldre ordrar har den som en enda rad med
    // hela beloppet, så summan räknas ut ur belopp × antal och delas på varans
    // antal. discountExact håller kvar den gamla totalen exakt tills fältet
    // eller antalet rörs, så ett odelbart gammalt belopp inte tappar ören.
    const total = Math.abs(parseFloat(l.sell) || 0) * (parseInt(l.qty, 10) || 1);
    const antal = Math.max(1, parseInt(mål.qty, 10) || 1);
    mål.discount = String(Math.round((total / antal) * 100) / 100);
    mål.discountExact = total;
    mål.discountId = l.id || null;
  }
  editLines = rest;
}

// Fältet är avdraget PER par. Ett par som säljs i tre exemplar med 100 i rabatt
// ger 300 i avdrag — förut drogs 100 från hela raden oavsett antal.
function lineDiscountPer(l) {
  return Math.abs(parseFloat(l.discount) || 0);
}

function lineDiscountTotal(l) {
  if (!lineDiscountPer(l) && !l.discountExact) return 0;
  if (l.discountExact != null) return l.discountExact;
  return lineDiscountPer(l) * Math.max(1, parseInt(l.qty, 10) || 1);
}

// Rabattraden längst ner heter "Discount", en parrabatt "Discount — <vara>".
// Ställena som kände igen en rabatt på exakt namn såg bara den första. Normalt
// är parrabatterna invikta i sina varurader och syns inte här, men hittar
// foldPairDiscounts inte varan raden hörde till blir den stående som egen rad —
// och då måste den behandlas som den rabatt den är, annars stoppar den sparandet
// med "Ange säljpris för Discount — …".
function isDiscountLine(l) {
  return l.name === 'Discount' || l.name.startsWith(PAIR_DISCOUNT_PREFIX);
}

// Rabatten skrivs in som ett positivt tal men är ett avdrag. Räknades den som
// ett plus här visade rutan fel summa ända fram tills man sparade.
function editLineSell(l) {
  const v = parseFloat(l.sell) || 0;
  return isDiscountLine(l) ? -Math.abs(v) : v;
}

// En rad utan inköpspris räknas som genomgång: den höjer omsättningen men ger
// noll i vinst. För frakten är det rätt. För en vara är det nästan alltid att
// man glömt fylla i inköpspriset — och då blir vinsten för låg här, i Historik,
// i exporten och i avräkningen, utan att något säger till.
function lineMissingBuy(l) {
  if (isDiscountLine(l) || l.name === 'Shipping') return false;
  if (!(parseFloat(l.sell) > 0)) return false;
  return l.buy === '' || l.buy == null;
}

// Med flera par måste det stå svart på vitt att avdraget gäller per par —
// annars ser "100" ut som hundra kronor på hela raden.
function discHintText(line, eur) {
  const per = lineDiscountPer(line);
  const total = lineDiscountTotal(line);
  if (!total) return '';
  const antal = Math.max(1, parseInt(line.qty, 10) || 1);
  const netto = editLineSell(line) * antal - total;
  const perDel = antal > 1 ? `${antal} × € ${eur(per)} = € ${eur(total)} · ` : '';
  return `${perDel}raden blir € ${eur(netto)}`;
}

function editTotals() {
  const revenue = editLines.reduce((s, l) =>
    s + editLineSell(l) * (parseInt(l.qty, 10) || 0) - lineDiscountTotal(l), 0);
  const profit = editLines.reduce((s, l) => {
    if (l.buy === '' || l.buy == null) return s;   // frakt är genomgång, ingen vinst
    // Rabatten sparas med inköpspris 0 och sänker därför vinsten krona för krona
    return s + (editLineSell(l) - (parseFloat(l.buy) || 0)) * (parseInt(l.qty, 10) || 0) - lineDiscountTotal(l);
  }, 0);
  const utanInkop = editLines.filter(lineMissingBuy).length;
  return { revenue, profit, utanInkop };
}

function updateEditLine(i, field, value) {
  const line = editLines[i];
  if (!line) return;
  let byggOm = false;
  if (field === 'qty') {
    let q = Math.max(1, parseInt(value, 10) || 1);
    // Fler par än ordern redan tagit ur lagret kräver att man vet VILKA par —
    // det gör man bara genom att lägga till dem ur lagret nedan
    if (line.maxQty && q > line.maxQty) {
      q = line.maxQty;
      showToast('Lägg till fler par ur lagret längre ned', 'error');
      byggOm = true;              // fältet måste skrivas tillbaka till det kapade värdet
    }
    line.qty = q;
  } else {
    line[field] = value;
  }
  // Så snart avdraget eller antalet rörs är det per-par-talet som gäller. Den
  // exakta gamla totalen fanns bara för att en äldre order inte skulle tappa
  // ören bara för att man öppnade den.
  if (field === 'discount' || field === 'qty') line.discountExact = null;
  // Att bygga om hela listan för varje tecken kastade bort alla fält och gjorde
  // nya — det tappade markören och kändes trögt på telefonen. Nu räcker det att
  // räkna om summorna; listan byggs om bara när den faktiskt ändrar form.
  if (byggOm) renderEditLines();
  else refreshEditTotals();
}

// Summan, varningen och radens "Raden blir …" — utan att röra fälten
function refreshEditTotals() {
  const eur = n => n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const { revenue, profit, utanInkop } = editTotals();
  const el = document.getElementById('edit-total');
  if (el) el.textContent = `€ ${eur(revenue)} · vinst € ${eur(profit)}`;
  const varning = document.getElementById('edit-total-warn');
  if (varning) {
    varning.textContent = utanInkop
      ? `${utanInkop} rad${utanInkop > 1 ? 'er' : ''} saknar inköpspris och räknas inte in i vinsten`
      : '';
    varning.style.display = utanInkop ? '' : 'none';
  }
  document.querySelectorAll('#edit-lines .inv-line-item').forEach((div, i) => {
    const sum = div.querySelector('[data-role="disc-sum"]');
    if (!sum) return;
    const line = editLines[i];
    if (!line) return;
    sum.textContent = discHintText(line, eur);
  });
}

function removeEditLine(i) {
  editLines.splice(i, 1);
  renderEditLines();
  renderEditStockList();
}

function addEditDiscount() {
  if (editLines.some(l => l.name === 'Discount')) { showToast('Det finns redan en rabattrad', 'error'); return; }
  // Samma form som vid försäljning: negativt belopp med inköpspris 0, så att
  // rabatten sänker både omsättning och vinst
  editLines.push({ id: null, name: 'Discount', ref_code: '', qty: 1,
    maxQty: null, sell: '', buy: '0', image: null, inventory_ids: null,
    discount: '', discountId: null, discountExact: null });
  renderEditLines();
}

// En rad utan koppling till lagret. Fylls i för hand, precis som när en
// förbeställning skapas, och ref-koden slår upp namn och priser om modellen
// sålts förut.
function addEditPreorderLine() {
  editLines.push({
    id: null, name: '', ref_code: '', qty: 1, maxQty: null,
    sell: '', buy: '', image: null, inventory_ids: null,
    discount: '', discountId: null, discountExact: null, manual: true, hint: '',
  });
  renderEditLines();
}

// En ny modell har ingen bild i ref-uppslaget. Utan den här gick varan in i
// ordern helt utan bild, och kunden såg en tom ruta på sin förbeställning.
function pickEditLineImage(i) {
  pickProductImage(({ previewUrl, uploading, url }) => {
    const line = editLines[i];
    if (!line) return;
    line.previewUrl = previewUrl;
    line.imgUploading = uploading;
    if (!uploading) {
      if (url) { line.image = url; line.imgFailed = false; }
      else { line.imgFailed = true; showToast('Bilden kunde inte laddas upp', 'error'); }
    }
    renderEditLines();
  });
}

function editLineImgCell(line, i) {
  const src = line.image || line.previewUrl || null;
  return `<button data-role="img-pick" title="${src ? 'Byt bild' : 'Lägg till bild'}"
    style="width:44px;height:44px;flex-shrink:0;padding:0;border-radius:8px;cursor:pointer;overflow:hidden;
           border:1px dashed ${src ? 'transparent' : 'var(--border)'};background:${src ? 'none' : 'rgba(255,255,255,.03)'};
           color:var(--text3);font-size:17px;font-family:inherit;line-height:1;${line.imgUploading ? 'opacity:.5' : ''}">
    ${src ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block">` : '+'}
  </button>`;
}

// Samma uppslag som förbeställningen och fakturaimporten använder
async function lookupEditRef(i) {
  const line = editLines[i];
  if (!line) return;
  const ref = String(line.ref_code || '').trim().toUpperCase();
  line.ref_code = ref;
  if (!ref) { line.hint = ''; renderEditLines(); return; }
  try {
    const r = await api(`/api/inventory/ref-lookup?code=${encodeURIComponent(ref)}`);
    if (!r.ok) { line.hint = ''; renderEditLines(); return; }
    const d = await r.json();
    const m = d.match;
    if (!m) { line.hint = 'Ny modell — fyll i namn och priser själv.'; renderEditLines(); return; }
    if (!String(line.name).trim() && m.name) line.name = m.name;
    if (!line.sell && m.sell_price != null) line.sell = String(m.sell_price);
    if (!line.buy && m.buy_price != null) line.buy = String(m.buy_price);
    line.image = m.image || null;
    line.hint = 'Känd modell — namn och priser hämtade.';
  } catch { line.hint = ''; }
  renderEditLines();
}

function addEditFromStock(key) {
  const g = invGroups[key];
  if (!g) return;
  const taken = new Set(editLines.flatMap(l => l.inventory_ids || []));
  const free = g.ids.filter(id => !taken.has(id));
  if (!free.length) { showToast(`Alla ${g.count} i lager är redan valda`, 'error'); return; }
  const existing = editLines.find(l => !l.id && l.ref_code === (g.ref_code || '') && l.name === g.name);
  if (existing) {
    existing.inventory_ids.push(free[0]);
    existing.qty = existing.inventory_ids.length;
  } else {
    editLines.push({
      id: null, name: g.name, ref_code: g.ref_code || '', qty: 1, maxQty: null,
      sell: g.sell_price == null ? '' : String(g.sell_price),
      buy: g.buy_price == null ? '' : String(g.buy_price),
      image: g.image || null, inventory_ids: [free[0]],
      discount: '', discountId: null, discountExact: null,
    });
  }
  renderEditLines();
  renderEditStockList();
}

function renderEditStockList() {
  const list = document.getElementById('edit-stock-list');
  if (!list) return;
  const taken = new Set(editLines.flatMap(l => l.inventory_ids || []));
  const rows = Object.values(invGroups || {}).map(g => {
    const free = g.ids.filter(id => !taken.has(id)).length;
    if (!free) return '';
    return `<button class="inv-add-row" style="text-align:left;margin-bottom:6px"
      onclick="addEditFromStock('${g.key}')">
      + ${esc(g.name)}${g.ref_code ? ` <span style="color:var(--text3)">(${esc(g.ref_code)})</span>` : ''}
      <span style="color:var(--text3)"> · ${free} i lager</span></button>`;
  }).join('');
  const tom = editStockLoading ? 'Hämtar lagret…'
    : editStockFailed ? 'Kunde inte hämta lagret. Stäng och försök igen.'
    : 'Inget kvar i lagret att lägga till.';
  list.innerHTML = rows || `<div style="color:var(--text3);font-size:12px;padding:6px 0">${tom}</div>`;
}

function renderEditLines() {
  const wrap = document.getElementById('edit-lines');
  if (!wrap) return;
  wrap.innerHTML = '';
  editLines.forEach((line, i) => {
    const isDiscount = isDiscountLine(line);
    const div = document.createElement('div');
    div.className = 'inv-line-item';
    div.innerHTML = `
      <button class="inv-line-remove" title="Ta bort raden">×</button>
      <div style="display:flex;align-items:center;gap:10px;padding-right:28px;margin-bottom:8px">
        ${line.manual ? editLineImgCell(line, i) : ''}
        <div style="font-size:13px;font-weight:600;color:var(--text);min-width:0">
          ${line.manual ? 'Förbeställd vara' : esc(line.name)}${!line.manual && line.ref_code ? ` <span style="color:var(--text3);font-weight:400">(${esc(line.ref_code)})</span>` : ''}
          ${line.id ? '' : '<span style="color:var(--blue);font-size:11px;font-weight:600"> · ny</span>'}
          ${line.manual && !line.image && !line.previewUrl ? '<div style="font-size:11px;color:var(--text3);font-weight:400;margin-top:2px">Ingen bild — tryck på rutan</div>' : ''}
          ${line.imgUploading ? '<div style="font-size:11px;color:var(--text3);font-weight:400;margin-top:2px">Laddar upp bilden…</div>' : ''}
        </div>
      </div>
      ${!line.manual ? '' : `
      <div class="inv-field" style="margin-bottom:8px">
        <label>Referenskod</label>
        <input class="inv-input" data-field="ref_code" placeholder="ex. CT-2841" autocomplete="off">
        ${line.hint ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">${esc(line.hint)}</div>` : ''}
      </div>
      <div class="inv-field" style="margin-bottom:8px">
        <label>Namn</label>
        <input class="inv-input" data-field="name" placeholder="Skriv namn på varan" autocomplete="off">
      </div>`}
      <div class="inv-row-grid">
        <div class="inv-field" style="margin-bottom:0">
          <label>Antal</label>
          <input class="inv-input" data-field="qty" type="number" min="1" step="1"
                 inputmode="numeric" ${isDiscount ? 'disabled' : ''}>
        </div>
        <div class="inv-field" style="margin-bottom:0">
          <label>${isDiscount ? 'Rabatt (€, minus)' : 'Säljpris (€)'}</label>
          <input class="inv-input" data-field="sell" type="number" step="0.01" inputmode="decimal" placeholder="0">
        </div>
      </div>
      ${!line.manual ? '' : `
      <div class="inv-field" style="margin-top:8px;margin-bottom:0">
        <label>Inköpspris (€)</label>
        <input class="inv-input" data-field="buy" type="number" step="0.01" inputmode="decimal" placeholder="0">
      </div>`}
      ${isDiscount || (!line.manual && (line.buy === '' || line.buy == null)) ? '' : `
      <div class="inv-field" style="margin-top:8px;margin-bottom:0">
        <label>Rabatt per par (€)</label>
        <input class="inv-input" data-field="discount" type="number" min="0" step="0.01"
               inputmode="decimal" placeholder="0">
        <div data-role="disc-sum" style="font-size:11px;color:var(--text3);margin-top:4px"></div>
      </div>`}`;
    div.querySelector('[data-field="qty"]').value = line.qty;
    div.querySelector('[data-field="sell"]').value = line.sell;
    if (line.manual) {
      div.querySelector('[data-role="img-pick"]').addEventListener('click', () => pickEditLineImage(i));
      div.querySelector('[data-field="ref_code"]').value = line.ref_code;
      div.querySelector('[data-field="name"]').value = line.name;
      div.querySelector('[data-field="buy"]').value = line.buy;
      div.querySelector('[data-field="ref_code"]')
        .addEventListener('change', e => { editLines[i].ref_code = e.target.value; lookupEditRef(i); });
    }
    const dEl = div.querySelector('[data-field="discount"]');
    if (dEl) {
      dEl.value = line.discount;
      const sum = div.querySelector('[data-role="disc-sum"]');
      sum.textContent = discHintText(line,
        n => n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    }
    for (const f of ['qty', 'sell', 'discount', 'name', 'buy']) {
      const el = div.querySelector(`[data-field="${f}"]`);
      if (el) el.addEventListener('change', () => updateEditLine(i, f, el.value));
    }
    div.querySelector('.inv-line-remove').addEventListener('click', () => removeEditLine(i));
    wrap.appendChild(div);
  });
  refreshEditTotals();
}

async function saveEditSale() {
  if (!editSaleId) return;
  if (!editLines.length) { showToast('Ordern måste ha minst en rad', 'error'); return; }
  // En bild som fortfarande laddas upp har ingen url än; sparade vi nu hade
  // raden gått in utan bild, tyst, trots att man precis valt en
  if (editLines.some(l => l.imgUploading)) {
    showToast('Vänta tills bilden laddats upp', 'error'); return;
  }
  for (const l of editLines) {
    if (isDiscountLine(l)) {
      // Rabatten skrivs som ett positivt tal men sparas negativt
      const v = Math.abs(parseFloat(l.sell) || 0);
      if (!(v > 0)) { showToast('Ange ett rabattbelopp', 'error'); return; }
    } else if (l.manual && !String(l.name).trim()) {
      // Samma krav som när en förbeställning skapas: utan namn syns raden
      // varken på fakturan eller i historiken
      showToast('Skriv namn på den förbeställda varan', 'error'); return;
    } else if (!(parseFloat(l.sell) > 0)) {
      showToast(`Ange säljpris för ${String(l.name).trim() || 'den nya raden'}`, 'error'); return;
    }
    // En rabatt större än raden själv gör radens pris negativt, och då ser det
    // ut som att ni betalat kunden för att ta varan. Gäller bara rader som
    // FÅTT en parrabatt — rabattraden längst ner har inget eget pris att
    // jämföra med, och fastnade här tills kontrollen blev villkorad.
    const parPris = editLineSell(l);
    if (lineDiscountPer(l) > 0 && lineDiscountPer(l) > parPris) {
      showToast(`Rabatten på ${l.name} är större än vad ett par kostar (€ ${parPris})`, 'error'); return;
    }
  }

  // En rabatt som hör till ett par viks ut till sin egen minusrad igen, direkt
  // efter varan den gäller, så att den syns på fakturan och sänker vinsten.
  const items = [];
  for (const l of editLines) {
    items.push({
      id: l.id || undefined,
      name: String(l.name).trim(),
      ref_code: String(l.ref_code || '').trim().toUpperCase() || null,
      qty: Math.max(1, parseInt(l.qty, 10) || 1),
      sell_price: editLineSell(l),
      buy_price: l.buy === '' || l.buy == null ? null : parseFloat(l.buy),
      image: l.image || null,
      inventory_ids: l.inventory_ids || undefined,
    });
    if (lineDiscountTotal(l) > 0) {
      const antal = Math.max(1, parseInt(l.qty, 10) || 1);
      const per = lineDiscountPer(l);
      // Normalfallet: samma antal som varan, avdraget per par. Ett gammalt
      // belopp som inte går jämnt upp på antalet sparas som förut i en rad, så
      // att totalen blir på öret densamma.
      const jämnt = Math.abs(per * antal - lineDiscountTotal(l)) < 0.005;
      items.push({
        id: l.discountId || undefined,
        name: pairDiscountName(String(l.name).trim()),
        ref_code: String(l.ref_code || '').trim().toUpperCase() || null,
        qty: jämnt ? antal : 1,
        sell_price: jämnt ? -per : -lineDiscountTotal(l),
        buy_price: 0,          // så att rabatten sänker vinsten, inte bara omsättningen
        image: null,
      });
    }
  }

  const btn = document.getElementById('edit-save-btn');
  btn.textContent = 'Sparar…'; btn.disabled = true;
  try {
    const r = await api(`/api/sales/${editSaleId}/items`, {
      method: 'PATCH',
      body: JSON.stringify({ items, restock: document.getElementById('edit-restock').checked }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { showToast(d.error || 'Kunde inte spara ändringen', 'error'); return; }
    closeEditSale();
    const back = d.restored ? ` — ${d.restored} par tillbaka i lagret` : '';
    showToast(`Ordern ändrad${back}`, 'success');
    refreshSalesAndSettlement();
    if (typeof loadInventory === 'function') loadInventory();
  } catch { showToast('Anslutningsfel', 'error'); }
  finally { btn.textContent = 'Spara ändringen'; btn.disabled = false; }
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
// Ändras en order ändras också provisionen den ger. Historik och avräkning
// läser samma försäljningar, så de måste laddas om tillsammans — annars står
// "kommer läggas på när de betalas" kvar på siffran från innan ändringen.
// Statusbytena gjorde det redan; orderändring, borttagning och förbeställningar
// gjorde det inte.
function refreshSalesAndSettlement() {
  loadSalesHistory();
  if (typeof loadSettlement === 'function') loadSettlement();
}

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
    // Avbrutna köp ligger kvar i listan men räknas inte in i omsättning eller
    // vinst — samma regel som avräkningen, bokföringen och kundens köphistorik.
    // Annars visade månadsraden en vinst som aldrig kom in.
    const months = {};
    let totalRevAll = 0, totalProfAll = 0;
    for (const sale of sales) {
      const key = sale.created_at.substring(0, 7);
      if (!months[key]) months[key] = { sales: [], revenue: 0, profit: 0 };
      months[key].sales.push(sale);
      if (sale.status === 'cancelled') continue;
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
        // Sälj utan klient bär köparens namn direkt på raden. Namnet måste
        // förbli ren text — det körs genom esc() nedan, så markering läggs som
        // ett eget element i stället.
        const clientName = sale.clients?.admin_label || sale.clients?.display_name
          || sale.customer_name || '—';
        const isWalkinSale = !sale.clients && !!sale.customer_name;
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
                ${isWalkinSale ? `<span style="font-size:10px;color:var(--text3);border:1px solid var(--border);border-radius:6px;padding:1px 6px;white-space:nowrap">utanför appen</span>` : ''}
                ${sale.is_preorder ? `<span style="font-size:10px;color:#bb88ff;background:rgba(187,136,255,.13);border-radius:6px;padding:2px 7px;font-weight:700;white-space:nowrap">Förbeställning</span>` : ''}
                <span id="sbadge-${sid}">${saleStatusBadge(sale.status || 'unpaid')}</span>
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">${date}${sale.invoice_number ? ` · ${esc(sale.invoice_number)}` : ''} · ${itemCount} vara${itemCount !== 1 ? 'r' : ''}</div>
              ${sale.is_preorder ? `<div style="font-size:11px;color:${sale.arrived_at ? '#66dd99' : '#bb88ff'};margin-top:3px">${esc(preorderStatusText(sale))}</div>` : ''}
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
            ${sale.is_preorder ? preorderActionsHTML(sale) : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              ${(sale.status || 'unpaid') === 'unpaid' ? `<button onclick="event.stopPropagation();openEditSale('${sale.id}')" style="background:none;border:1px solid rgba(201,169,110,.35);border-radius:8px;color:var(--blue);font-size:13px;padding:6px 12px;cursor:pointer;font-family:inherit">Ändra</button>` : ''}
              <button onclick="event.stopPropagation();openSaleInvoice('${sale.id}')" style="background:none;border:1px solid rgba(100,150,255,.3);border-radius:8px;color:#7aabff;font-size:13px;padding:6px 12px;cursor:pointer;font-family:inherit">Faktura</button>
              <button onclick="event.stopPropagation();deleteSale('${sale.id}', refreshSalesAndSettlement)" style="background:none;border:1px solid rgba(255,100,100,.3);border-radius:8px;color:#ff7a7a;font-size:13px;padding:6px 12px;cursor:pointer;font-family:inherit">Ta bort försäljning</button>
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
// CSV går rakt in i redovisningsprogrammet, PDF är den man mailar eller
// skriver ut. Valet ligger i en meny i stället för två knappar per månad.
function exportBookkeeping(month) {
  document.getElementById('export-menu-rows').innerHTML = [
    invMenuRow('Excel-fil (CSV)', 'För redovisningsprogrammet', `runFromExportMenu(() => exportBookkeepingCsv('${month}'))`),
    invMenuRow('PDF', 'Att maila, skriva ut eller spara', `runFromExportMenu(() => exportBookkeepingPdf('${month}'))`),
    invMenuRow('Testa valutakursen', 'Kollar att dagskursen hämtas från Riksbanken', 'runFromExportMenu(checkFxSource)'),
  ].join('');
  document.getElementById('export-menu-title').textContent = `Bokföringsunderlag ${month}`;
  document.getElementById('export-menu-modal').classList.add('open');
}

// Går kurshämtningen sönder märks det annars bara som att kronbeloppen tyst
// räknas med reservkursen — och ett underlag med fel kurs ser precis lika
// rätt ut som ett med rätt. Därför ett sätt att fråga rakt ut.
async function checkFxSource() {
  showToast('Kollar kursen…', 'ok');
  try {
    const r = await api('/api/fx/check');
    const d = await r.json().catch(() => ({}));
    if (d.ok) {
      const last = d.sample?.[d.sample.length - 1];
      showToast(last
        ? `Kursen hämtas: 1 € = ${last.rate} kr (${last.day})`
        : 'Kursen hämtas från Riksbanken', 'success');
    } else {
      showToast(`Kursen hämtas INTE — underlaget räknas med reservkursen ${d.fallback_rate ?? 11}`, 'error');
    }
    console.log('[FX] Provhämtning:', d);
  } catch (e) {
    showToast('Kunde inte nå servern för kurskoll', 'error');
  }
}

function closeExportMenu() {
  document.getElementById('export-menu-modal').classList.remove('open');
}

function runFromExportMenu(fn) {
  closeExportMenu();
  setTimeout(() => fn(), 60);
}

// Delas via delningsmenyn på mobil — en nedladdningslänk hamnar svårhittat
// i en iOS-PWA. Används för både CSV och PDF.
async function deliverExport(blob, name, type) {
  const file = new File([blob], name, { type });
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
}

async function exportBookkeepingCsv(month) {
  showToast('Skapar underlag…', 'ok');
  try {
    const r = await api(`/api/export/bookkeeping?month=${month}`);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      showToast(d.error || 'Kunde inte skapa exporten', 'error');
      return;
    }
    await deliverExport(await r.blob(), `bokforing-${month}.csv`, 'text/csv');
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
    // Summan högst upp och en rubrik per månad — det går inte att följa vem som
    // köper mest genom att bläddra igenom enskilda ordrar.
    const revenueOf = sale => (sale.sale_items || [])
      .reduce((s, i) => s + (parseFloat(i.sell_price) || 0) * (i.qty || 1), 0);
    // Samma vinstformel som bokföringen och avräkningen: rader utan
    // inköpspris är genomgång, inte marginal
    const profitOf = sale => (sale.sale_items || []).reduce((s, i) => {
      if (i.buy_price == null) return s;
      return s + ((parseFloat(i.sell_price) || 0) - (parseFloat(i.buy_price) || 0)) * (i.qty || 1);
    }, 0);
    const eur = n => `€ ${Number(n).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const live = sales.filter(s => s.status !== 'cancelled');
    const spent = live.reduce((s, x) => s + revenueOf(x), 0);
    const earned = live.reduce((s, x) => s + profitOf(x), 0);
    const unpaid = live.filter(s => (s.status || 'unpaid') === 'unpaid')
      .reduce((s, x) => s + revenueOf(x), 0);
    const months = [...new Set(live.map(s => String(s.created_at || '').substring(0, 7)))];
    const perMonth = months.length ? spent / months.length : 0;

    const tile = (label, value, color) => `<div style="flex:1;min-width:0">
      <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">${label}</div>
      <div style="font-size:16px;font-weight:800;color:${color};margin-top:2px;white-space:nowrap">${value}</div>
    </div>`;

    const summary = `<div style="display:flex;gap:14px;background:var(--surface2);border:1px solid var(--border);
      border-radius:12px;padding:12px 14px;margin-bottom:14px">
      ${tile('Köpt totalt', eur(spent), 'var(--text)')}
      ${tile('Vår vinst', eur(earned), '#66dd99')}
      ${tile('Snitt/mån', eur(perMonth), 'var(--text2)')}
    </div>
    ${unpaid > 0 ? `<div style="font-size:12px;color:#ff9944;margin:-6px 0 14px">Obetalt just nu: ${eur(unpaid)}</div>` : ''}`;

    // Gruppera per månad, nyast först
    const byMonth = {};
    const order = [];
    for (const sale of sales) {
      const key = String(sale.created_at || '').substring(0, 7);
      if (!byMonth[key]) { byMonth[key] = []; order.push(key); }
      byMonth[key].push(sale);
    }
    const monthName = key => {
      const [y, m] = key.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
    };

    const renderSale = sale => {
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
    };

    body.innerHTML = summary + order.map(key => {
      const list = byMonth[key];
      const mLive = list.filter(s => s.status !== 'cancelled');
      const mSpent = mLive.reduce((s, x) => s + revenueOf(x), 0);
      const mEarned = mLive.reduce((s, x) => s + profitOf(x), 0);
      return `<div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;
          padding:10px 0 2px;text-transform:capitalize">
          <span style="font-size:13px;font-weight:700;color:var(--text2)">${monthName(key)}</span>
          <span style="font-size:11px;color:var(--text3);text-transform:none">
            ${eur(mSpent)} · vinst <span style="color:#66dd99">${eur(mEarned)}</span> · ${mLive.length} köp
          </span>
        </div>
        ${list.map(renderSale).join('')}
      </div>`;
    }).join('');
  } catch {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">Kunde inte hämta köphistorik</div>';
  }
}

function closeClientPurchases() {
  document.getElementById('client-purchases-sheet').classList.remove('open');
}
