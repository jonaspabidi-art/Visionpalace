let _feedAutoScroll = false;
let _feedScrollListenerReady = false;

async function loadBroadcasts() {
  try {
    const r = await fetch('/api/broadcasts', { headers:{'x-session-token':session.session_token} });
    if (!r.ok) return;
    const d = await r.json();
    const newList = d.broadcasts || [];
    const sig = b => b.id + (b.is_pinned ? 'p' : '');
    const oldSig = broadcasts.map(sig).join();
    const newSig = newList.map(sig).join();
    if (oldSig === newSig) { broadcasts = newList; return; }
    const s = document.getElementById('feed-scroll');
    const atBottom = s.scrollHeight - s.scrollTop - s.clientHeight < 80;
    const prevTop = s.scrollTop;
    const prevH = s.scrollHeight;
    broadcasts = newList;
    renderFeed();
    if (atBottom) scrollFeedBottom();
    else requestAnimationFrame(() => { s.scrollTop = prevTop + (s.scrollHeight - prevH); });
  } catch(e) {}
}

function renderFeed() {
  const scroll = document.getElementById('feed-scroll');
  if (!broadcasts.length) {
    scroll.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">[ ]</div><p>No updates yet</p></div>';
    return;
  }
  const sorted = [...broadcasts].sort((a,b)=>{
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return new Date(a.created_at)-new Date(b.created_at);
  });
  let html = '';
  let lastDate = '';
  for (const b of sorted) {
    const dateStr = new Date(b.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
    if (dateStr !== lastDate) {
      html += `<div class="date-pill"><span>${dateStr}</span></div>`;
      lastDate = dateStr;
    }
    html += bcBubbleHTML(b);
  }
  scroll.innerHTML = html;
  observeAllRows();
}

function bcBubbleHTML(b) {
  const time = new Date(b.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const media = b.broadcast_media || [];
  const bubbleInner = `
    ${b.is_pinned ? '<div class="bc-pin-bar">Pinned</div>' : ''}
    <div class="bc-body">
      ${b.price ? `<div class="bc-price">${esc(b.price)}</div>` : ''}
      ${b.text  ? `<div class="bc-text">${esc(b.text)}</div>` : ''}
      <div class="bc-time">${time}</div>
    </div>
    <button class="bc-msg-btn" onclick="replyToBroadcast('${b.id}')">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      Send message
    </button>`;

  const mark = `<div class="bc-mark"><img src="/logo.png" alt="VP"></div>`;

  if (media.length > 1) {
    // Strip sits OUTSIDE bc-bubble so overflow:hidden doesn't block scroll
    const stripItems = media.map(m =>
      m.storage_url
        ? (m.type==='video'
            ? `<video src="${m.storage_url}" controls playsinline preload="metadata"></video>`
            : `<img src="${m.storage_url}" data-full="${m.storage_url}" onclick="openLightbox(this.dataset.full)">`)
        : `<div style="flex-shrink:0;width:82%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:var(--surface2);font-size:12px;color:var(--text3)">Unavailable</div>`
    ).join('');
    return `<div class="bc-row" data-bc-id="${b.id}">
      ${mark}
      <div class="bc-wrap">
        <div class="bc-media-strip">${stripItems}</div>
        <div class="bc-bubble${b.is_pinned?' pinned':''}">${bubbleInner}</div>
      </div>
    </div>`;
  }

  const singleMedia = media.length === 1
    ? `<div class="bc-media">${media[0].storage_url
        ? (media[0].type==='video'
            ? `<video src="${media[0].storage_url}" controls playsinline preload="metadata"></video>`
            : `<img src="${media[0].storage_url}" data-full="${media[0].storage_url}" onclick="openLightbox(this.dataset.full)">`)
        : `<div class="media-expired">Media no longer available</div>`
      }</div>` : '';

  return `<div class="bc-row" data-bc-id="${b.id}">
    ${mark}
    <div class="bc-bubble${b.is_pinned?' pinned':''}">
      ${singleMedia}
      ${bubbleInner}
    </div>
  </div>`;
}

function scrollFeedBottom() {
  const s = document.getElementById('feed-scroll');
  if (!_feedScrollListenerReady) {
    _feedScrollListenerReady = true;
    s.addEventListener('scroll', () => {
      if (_feedAutoScroll && s.scrollHeight - s.scrollTop - s.clientHeight > 80) {
        _feedAutoScroll = false;
      }
    }, { passive: true });
  }
  _feedAutoScroll = true;
  s.scrollTop = 999999;
  s.querySelectorAll('img').forEach(img => {
    if (!img.complete) img.addEventListener('load', () => {
      if (_feedAutoScroll) s.scrollTop = 999999;
    }, { once: true });
  });
}

function appendBroadcast(b) {
  const s = document.getElementById('feed-scroll');
  const atBottom = s.scrollHeight - s.scrollTop - s.clientHeight < 80;
  if (b.is_pinned) {
    if (!broadcasts.find(x => x.id === b.id)) broadcasts.push(b);
    renderFeed();
    return;
  }
  if (s.querySelector(`.bc-row[data-bc-id="${b.id}"]`)) return;
  const dateStr = new Date(b.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'});
  const pills = s.querySelectorAll('.date-pill');
  const lastPillText = pills.length ? pills[pills.length-1].querySelector('span').textContent.trim() : '';
  const empty = s.querySelector('.feed-empty');
  if (empty) empty.remove();
  if (dateStr !== lastPillText) {
    const pill = document.createElement('div');
    pill.className = 'date-pill';
    pill.innerHTML = `<span>${dateStr}</span>`;
    s.appendChild(pill);
  }
  const div = document.createElement('div');
  div.innerHTML = bcBubbleHTML(b);
  if (div.firstElementChild) {
    const el = div.firstElementChild;
    s.appendChild(el);
    _observeRow(el);
  }
  if (atBottom) scrollFeedBottom();
}

// ── Seen tracking ──
let _seenIds = new Set();
let _seenTimer = null;
let _viewObserver = null;

function _flushSeen() {
  const ids = [..._seenIds];
  if (!ids.length) return;
  _seenIds.clear();
  fetch('/api/broadcasts/views', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-token': session.session_token },
    body: JSON.stringify({ broadcast_ids: ids })
  }).catch(() => {});
}

function _observeRow(el) {
  if (!_viewObserver) {
    _viewObserver = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const id = e.target.dataset.bcId;
        if (id) _seenIds.add(id);
        _viewObserver.unobserve(e.target);
      });
      clearTimeout(_seenTimer);
      _seenTimer = setTimeout(_flushSeen, 2000);
    }, { threshold: 0.1 });
  }
  _viewObserver.observe(el);
}

function observeAllRows() {
  document.querySelectorAll('#feed-scroll .bc-row[data-bc-id]').forEach(_observeRow);
}
