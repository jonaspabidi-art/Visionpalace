// ── Menyerna i Lager ──
// Katalogknapparna låg tidigare uppradade i verktygsraden och radbröt till
// "Läs / in / order" på telefon. De ligger nu i en meny, och varje vara har
// bara sin viktigaste knapp kvar plus prickarna.

function invMenuRow(label, sub, onclick, danger) {
  return `<button class="sheet-row${danger ? ' danger' : ''}" onclick="${onclick}">
    <span class="sheet-row-label">${label}</span>
    ${sub ? `<span class="sheet-row-sub">${sub}</span>` : ''}
  </button>`;
}

// ── Kontomenyn i sidhuvudet ──
function openHeaderMenu() {
  const rows = [];
  if (notifNeeded) rows.push(invMenuRow('Slå på notiser', 'Få ett pling när något händer', 'runFromHeaderMenu(enableNotifs)'));
  rows.push(invMenuRow('Bjud in klient', 'Skapa en inbjudningslänk', 'runFromHeaderMenu(openInviteModal)'));
  rows.push(invMenuRow('Logga ut', '', 'runFromHeaderMenu(logout)', true));
  document.getElementById('header-menu-rows').innerHTML = rows.join('');
  document.getElementById('header-menu-modal').classList.add('open');
}

function closeHeaderMenu() {
  document.getElementById('header-menu-modal').classList.remove('open');
}

function runFromHeaderMenu(fn) {
  closeHeaderMenu();
  setTimeout(() => fn(), 60);
}

function openInvMenu() {
  const rows = activeInvTab === 'lenses'
    ? [
      invMenuRow('Katalog PDF', 'Spara linskatalogen som PDF', 'runFromInvMenu(generateLensCatalogPDF)'),
      invMenuRow('Skicka katalog', 'Skicka linskatalogen till en klient', 'runFromInvMenu(showLensCatalogClientPicker)'),
    ]
    : [
      invMenuRow('Läs in order', 'Läs av en leverantörsfaktura och fyll på lagret', 'runFromInvMenu(openOrderImport)'),
      invMenuRow('Katalog PDF', 'Spara katalogen som PDF', 'runFromInvMenu(generateCatalogPDF)'),
      invMenuRow('Skicka katalog', 'Skicka katalogen till en klient', 'runFromInvMenu(showCatalogClientPicker)'),
    ];
  document.getElementById('inv-menu-rows').innerHTML = rows.join('');
  document.getElementById('inv-menu-modal').classList.add('open');
}

function closeInvMenu() {
  document.getElementById('inv-menu-modal').classList.remove('open');
}

// Menyn stängs först — annars ligger den kvar över det som öppnas
function runFromInvMenu(fn) {
  closeInvMenu();
  setTimeout(() => fn(), 60);
}

// ── Menyn på en enskild vara ──
function openCardMenu(kind, id) {
  const item = kind === 'lens' ? lensesMap[id] : invItemsMap[id];
  if (!item) return;
  document.getElementById('card-menu-title').textContent = item.name || 'Varan';
  const rows = kind === 'lens'
    ? [
      invMenuRow('Redigera lins', 'Namn, pris, färger och antal', `runFromCardMenu(() => openLensForm('${id}'))`),
      invMenuRow('Ta bort lins', 'Tas bort permanent', `runFromCardMenu(() => deleteLensItem('${id}'))`, true),
    ]
    : [
      invMenuRow('Redigera vara', 'Namn, ref, pris och bild', `runFromCardMenu(() => openInvForm('${id}'))`),
      invMenuRow('Ta bort vara', 'Tas bort permanent ur lagret', `runFromCardMenu(() => deleteInvItem('${id}'))`, true),
    ];
  document.getElementById('card-menu-rows').innerHTML = rows.join('');
  document.getElementById('card-menu-modal').classList.add('open');
}

function closeCardMenu() {
  document.getElementById('card-menu-modal').classList.remove('open');
}

function runFromCardMenu(fn) {
  closeCardMenu();
  setTimeout(() => fn(), 60);
}
