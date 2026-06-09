let quotedBroadcast = null;
let quotedBroadcastMedia = [];

function replyToBroadcast(id) {
  const b = broadcasts.find(x => x.id === id);
  if (!b) return;
  quotedBroadcast = b;
  quotedBroadcastMedia = (b.broadcast_media || [])
    .filter(m => m.storage_url)
    .map(m => ({ url: m.storage_url, thumbUrl: m.thumbnail_url || m.storage_url, type: m.type || 'image' }));
  const preview = [b.price, b.text].filter(Boolean).join(' · ').slice(0, 60) || 'Stock update';
  document.getElementById('bc-quote-preview').textContent = preview;
  const img = document.getElementById('bc-quote-img');
  const firstImg = quotedBroadcastMedia.find(m => m.type === 'image');
  if (firstImg) { img.src = firstImg.thumbUrl; img.style.display = 'block'; }
  else img.style.display = 'none';
  document.getElementById('bc-quote-bar').classList.add('visible');
  switchTab('messages');
  setTimeout(() => document.getElementById('chat-input').focus(), 150);
}

function dismissQuote() {
  quotedBroadcast = null;
  quotedBroadcastMedia = [];
  document.getElementById('bc-quote-img').style.display = 'none';
  document.getElementById('bc-quote-bar').classList.remove('visible');
}

function bubbleMediaHTML(m) {
  return (m.message_media || []).map(md => {
    if (!md.storage_url) return '';
    const full = md.storage_url;
    if (md.type === 'video') return `<div class="media-wrap">
      <video class="bubble-vid" src="${full}" controls playsinline></video>
      <button class="media-save-btn" onclick="saveMedia('${full}')" title="Save">↓</button>
    </div>`;
    return `<div class="media-wrap">
      <img class="bubble-img" src="${md.thumbnail_url||full}" data-full="${full}" onclick="openLightbox(this.dataset.full)" loading="lazy">
      <button class="media-save-btn" onclick="saveMedia('${full}')" title="Save">↓</button>
    </div>`;
  }).join('');
}

async function saveMedia(url) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = url.split('/').pop().split('?')[0] || 'media';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch {
    window.open(url, '_blank');
  }
}

function pdfBubbleHTML(m) {
  const url = m.metadata?.url;
  if (!url) return `<div class="bubble">${esc(m.text || '')}</div>`;
  return `<a class="bubble-pdf" href="${url}" target="_blank" rel="noopener">
    <span class="bubble-pdf-icon">📄</span>
    <span>
      <div class="bubble-pdf-label">Vision Palace Catalogue</div>
      <div class="bubble-pdf-sub">Tap to open PDF</div>
    </span>
  </a>`;
}

function productCardHTML(m) {
  const meta = m.metadata || {};
  const img = meta.image
    ? `<img class="pc-card-img" src="${meta.image}" alt="${esc(meta.name||'')}" loading="lazy" onclick="openLightbox(this.src)">`
    : `<div class="pc-card-img-ph">Ingen bild</div>`;
  return `<div class="pc-card">
    ${img}
    <div class="pc-card-body">
      ${meta.ref_code ? `<div class="pc-card-ref">${esc(meta.ref_code)}</div>` : ''}
      <div class="pc-card-name">${esc(meta.name || m.text || '')}</div>
      ${meta.price != null ? `<div class="pc-card-price">€ ${esc(String(meta.price))}</div>` : ''}
    </div>
  </div>`;
}

function bubbleHTML(m) {
  if (m.message_type === 'product_card') return productCardHTML(m);
  if (m.message_type === 'pdf') return pdfBubbleHTML(m);
  return `<div class="bubble">${m.text ? esc(m.text) : ''}${bubbleMediaHTML(m)}</div>`;
}

function renderMessages(msgs) {
  const c = document.getElementById('chat-messages');
  if (!msgs.length) {
    c.innerHTML = '<div class="chat-empty"><div class="chat-empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><p>No messages yet</p></div>';
    return;
  }
  c.innerHTML = '';
  const groups = [];
  for (const m of msgs) {
    const last = groups[groups.length - 1];
    const gap = last ? new Date(m.created_at) - new Date(last.msgs[last.msgs.length-1].created_at) : Infinity;
    if (last && last.sender === m.sender && gap < 120000) last.msgs.push(m);
    else groups.push({ sender: m.sender, msgs: [m] });
  }
  const ANIM_TAIL = 6;
  const animStart = Math.max(0, groups.length - ANIM_TAIL);
  let lastDate = null;
  groups.forEach((g, gi) => {
    const groupDate = new Date(g.msgs[0].created_at).toDateString();
    if (groupDate !== lastDate) {
      lastDate = groupDate;
      const pill = document.createElement('div');
      pill.className = 'date-pill';
      pill.innerHTML = `<span>${formatDatePill(g.msgs[0].created_at)}</span>`;
      c.appendChild(pill);
    }
    const from = g.sender === 'admin' ? 'from-admin' : 'from-me';
    const time = new Date(g.msgs[g.msgs.length-1].created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    const el = document.createElement('div');
    const animIdx = gi - animStart;
    if (animIdx >= 0) {
      el.className = `msg-group ${from} load-in`;
      el.style.animationDelay = `${animIdx * 45}ms`;
    } else {
      el.className = `msg-group ${from}`;
    }
    el.innerHTML = g.msgs.map(m => bubbleHTML(m)).join('')
      + `<div class="msg-meta">${time}</div>`;
    c.appendChild(el);
    g.msgs.forEach(m => renderedMsgIds.add(m.id));
  });
  attachImgFade(c);
}

async function loadMessages() {
  if (loadingMsgs) return;
  loadingMsgs = true;
  try {
    const r = await fetch('/api/messages/me/thread', { headers:{'x-session-token':session.session_token} });
    if (!r.ok) return;
    const d = await r.json();
    const msgs = d.messages || [];
    chatUnread = msgs.filter(m => m.sender==='admin' && !m.read).length;
    updateUnread();
    if (!chatOpen) return;
    const newMsgs = msgs.filter(m => !renderedMsgIds.has(m.id));
    if (!newMsgs.length) return;
    if (renderedMsgIds.size === 0) {
      renderMessages(msgs);
      scrollChat();
    } else {
      const c = document.getElementById('chat-messages');
      const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 60;
      newMsgs.forEach(m => appendChatMsg(m));
      if (atBottom) scrollChat();
    }
  } catch(e) {} finally { loadingMsgs = false; }
}

function appendChatMsg(m) {
  if (renderedMsgIds.has(m.id)) return;
  renderedMsgIds.add(m.id);
  const c = document.getElementById('chat-messages');
  const empty = c.querySelector('.chat-empty');
  if (empty) empty.remove();
  const from = m.sender === 'admin' ? 'from-admin' : 'from-me';
  const time = new Date(m.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  const lastGroup = c.querySelector('.msg-group:last-child');
  if (lastGroup && lastGroup.classList.contains(from)) {
    const meta = lastGroup.querySelector('.msg-meta');
    if (meta) meta.remove();
    const bbl = document.createElement('div');
    if (m.message_type === 'product_card') {
      bbl.className = 'anim-in';
      bbl.innerHTML = productCardHTML(m);
    } else if (m.message_type === 'pdf') {
      bbl.className = 'anim-in';
      bbl.innerHTML = pdfBubbleHTML(m);
    } else {
      bbl.className = 'bubble anim-in';
      bbl.innerHTML = (m.text ? esc(m.text) : '') + bubbleMediaHTML(m);
    }
    lastGroup.appendChild(bbl);
    const metaEl = document.createElement('div');
    metaEl.className = 'msg-meta';
    metaEl.textContent = time;
    lastGroup.appendChild(metaEl);
  } else {
    const el = document.createElement('div');
    el.className = `msg-group ${from} anim-in`;
    el.innerHTML = bubbleHTML(m) + `<div class="msg-meta">${time}</div>`;
    c.appendChild(el);
  }
  attachImgFade(c);
  if (chatOpen) {
    const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 80;
    if (atBottom) scrollChat(true);
  }
}

function scrollChat(smooth = false) {
  const c = document.getElementById('chat-messages');
  if (smooth) {
    requestAnimationFrame(() => c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }));
  } else {
    requestAnimationFrame(() => c.scrollTop = c.scrollHeight);
  }
}

function attachImgFade(container) {
  container.querySelectorAll('.bubble-img:not(.loaded)').forEach(img => {
    if (img.complete) { img.classList.add('loaded'); return; }
    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  });
}

function updateUnread() {
  const el = document.getElementById('msg-badge');
  if (chatUnread>0) { el.textContent=chatUnread; el.style.display='flex'; }
  else el.style.display='none';
}

async function markRead() {
  if (!session) return;
  await fetch(`/api/messages/${session.client_id}/read`, { method:'POST', headers:{'x-session-token':session.session_token} });
  if (socket) socket.emit('client:read_receipt',{client_id:session.client_id});
}

document.getElementById('send-btn').onclick = sendMsg;
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendMsg(); }
  if (socket) socket.emit('client:typing');
});
document.getElementById('chat-input').addEventListener('input', function(){ autoResize(this); });

let sending = false;
async function sendMsg() {
  if (sending) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text && !pendingMedia.length && !quotedBroadcastMedia.length) return;
  sending = true;
  const btn = document.getElementById('send-btn');
  btn.disabled = true;

  let fullText = text;
  const broadcastMedia = [...quotedBroadcastMedia];
  if (quotedBroadcast) {
    const ref = [quotedBroadcast.price, quotedBroadcast.text].filter(Boolean).join(' · ').slice(0, 80);
    fullText = `↩ ${ref}\n\n${text}`.trim();
  }

  input.value = '';
  autoResize(input);
  dismissQuote();
  try {
    const r = await fetch('/api/messages/me/send', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-session-token':session.session_token},
      body: JSON.stringify({ text: fullText, media: [...broadcastMedia, ...pendingMedia] })
    });
    if (r.ok) {
      pendingMedia = [];
      document.getElementById('media-prev-row').innerHTML = '';
      const d = await r.json();
      appendChatMsg(d.message);
    }
  } finally {
    sending = false;
    btn.disabled = false;
  }
}
