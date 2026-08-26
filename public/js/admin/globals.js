let token = localStorage.getItem('vp_admin_token');
let socket = null;
let broadcasts = [];
let clients = [];
let currentClientId = null;
let pendingBcMedia = [];
let pendingChatMedia = [];
let inFlightBcTempIds = new Set();
let bcLoadGen = 0;
let totalUnread = 0;
let extrasOpen = false;
let searchVisible = false;
let invItemsMap = {};   // id → enskild lagerrad (ett fysiskt par)
let invGroups = {};     // ref-kod → alla par av samma modell
let lensesMap = {};
let lensCartItems = [];
let activeInvTab = 'glasses';
let invLineItems = [];
let invLineNextId = 0;
let invCustType = 'company';
let invLang = 'en'; // 'en' | 'sv'
// Valutan är fristående från språket. En svensk kund kan betala i euro, och en
// engelsk faktura kan ställas ut i kronor — förut följde valutan språket och
// de kombinationerna gick inte att göra.
let invCurrency = 'EUR'; // 'EUR' | 'SEK' | 'USD'
let bcInitialLoad = true;
