const INV_COMPANY = {
  name: 'C.lunettes AB',
  vat: 'SE559168839 4SE',
  address: '411 15 Gothenburg, Sweden',
  bankName: 'Danske Bank',
  iban: 'SE9112000000012350396061',
  bankAddress: 'Oestra hamngatan 13, 404 22',
  bic: 'DABASESX',
};

// Lagring finns inte alltid. I Facebooks och Instagrams inbyggda webbläsare,
// och i privat läge, kastar localStorage i stället för att svara. Förut small
// raden nedan direkt vid start: splashen låg kvar för alltid och inloggningen
// visades aldrig. Nu faller vi tillbaka på minnet — sessionen överlever inte
// en omladdning då, men appen fungerar.
const vpStore = (() => {
  try {
    const probe = '__vp__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    console.warn('[VP] Lagring blockerad — sessionen sparas bara i minnet');
    const mem = new Map();
    return {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: k => mem.delete(k),
      blocked: true,
    };
  }
})();

function vpReadSession() {
  try { return JSON.parse(vpStore.getItem('vp_session') || 'null'); }
  catch { return null; }   // trasig json ska inte heller döda appen
}

let session = vpReadSession();
let socket = null;
let broadcasts = [];
let pendingMedia = [];
let chatUnread = 0;
let chatOpen = false;
let deferredPWA = null;
let renderedMsgIds = new Set();
let loadingMsgs = false;
