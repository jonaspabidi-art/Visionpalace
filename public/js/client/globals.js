const INV_COMPANY = {
  name: 'C.lunettes AB',
  vat: 'SE559168839 4SE',
  address: '411 15 Gothenburg, Sweden',
  bankName: 'Danske Bank',
  iban: 'SE9112000000012350396061',
  bankAddress: 'Oestra hamngatan 13, 404 22',
  bic: 'DABASESX',
};

let session = JSON.parse(localStorage.getItem('vp_session') || 'null');
let socket = null;
let broadcasts = [];
let pendingMedia = [];
let chatUnread = 0;
let chatOpen = false;
let deferredPWA = null;
let renderedMsgIds = new Set();
let loadingMsgs = false;
