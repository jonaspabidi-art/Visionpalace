function renderClients() {
  const list = document.getElementById('clients-list');
  const active = clients.filter(c => !c.is_inactive);
  const inactive = clients.filter(c => c.is_inactive);
  if (!clients.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--text3);padding:40px 0;font-size:14px">Inga klienter ännu</div>';
    return;
  }
  list.innerHTML = [...active, ...inactive].map(c => {
    const init = (c.admin_label || c.display_name || '?')[0].toUpperCase();
    const seen = c.is_online ? 'Online' : (c.last_seen_at ? timeAgo(c.last_seen_at) : '');
    const seenStyle = c.is_online ? 'color:#34c759' : '';
    const unread = c.unread_count > 0 ? `<div class="unread-badge">${c.unread_count}</div>` : '';
    const dot = c.is_online ? '<span class="online-dot"></span>' : '';
    return `<div class="client-row${c.is_inactive ? ' client-inactive' : ''}" onclick="openChat('${c.id}')">
      <div class="client-avatar">${init}${dot}</div>
      <div class="client-body">
        <div class="client-name">${esc(c.admin_label || c.display_name)}</div>
        <div class="client-label">${c.admin_label ? esc(c.display_name) : ''}</div>
      </div>
      <div class="client-right">
        ${unread}
        <div class="last-seen-txt" style="${seenStyle}">${seen}</div>
      </div>
    </div>`;
  }).join('');
}

function updateUnreadBadge() {
  totalUnread = clients.reduce((s, c) => s + (c.unread_count || 0), 0);
  const badge = document.getElementById('clients-badge');
  if (totalUnread > 0) { badge.textContent = totalUnread; badge.style.display = 'flex'; }
  else badge.style.display = 'none';
}

async function loadClients() {
  const r = await api('/api/clients');
  const d = await r.json();
  clients = d.clients || [];
  renderClients();
  updateUnreadBadge();
}

// ── Private chat ──

// Pin the chat to the newest message and keep it there while media loads.
// A ResizeObserver re-pins instantly whenever a row grows (image/video load),
// and only a real user gesture (touch/wheel) cancels the pinning.
let _chatAutoScroll = false;
let _chatPinObserver = null;
let _chatPinScheduled = false;

function pinChatToBottom() {
  const c = document.getElementById('chat-messages');
  if (!c) return;
  if (!_chatPinObserver) {
    const cancel = () => { _chatAutoScroll = false; };
    c.addEventListener('touchstart', cancel, { passive: true });
    c.addEventListener('wheel', cancel, { passive: true });
    // Coalesce re-pins to one per frame — media load bursts fire many resizes
    _chatPinObserver = new ResizeObserver(() => {
      if (!_chatAutoScroll || _chatPinScheduled) return;
      _chatPinScheduled = true;
      requestAnimationFrame(() => {
        _chatPinScheduled = false;
        if (!_chatAutoScroll) return;
        const el = document.getElementById('chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
      });
    });
  } else {
    _chatPinObserver.disconnect();
  }
  _chatAutoScroll = true;
  c.scrollTop = c.scrollHeight;
  c.querySelectorAll('.msg-row').forEach(row => _chatPinObserver.observe(row));
}

function unpinChat() {
  _chatAutoScroll = false;
  if (_chatPinObserver) _chatPinObserver.disconnect();
}

async function openChat(clientId) {
  currentClientId = clientId;
  document.getElementById('chat-panel').classList.add('open');
  updateChatHeader();
  const r = await api(`/api/messages/${clientId}`);
  const d = await r.json();
  const msgs = d.messages || [];
  const c = document.getElementById('chat-messages');
  c.innerHTML = !msgs.length
    ? '<div class="chat-empty">Ingen konversation ännu</div>'
    : msgs.map(msgHTML).join('');
  const rows = c.querySelectorAll('.msg-row');
  const animStart = Math.max(0, rows.length - 6);
  rows.forEach((row, i) => {
    if (i >= animStart) {
      row.classList.add('load-in');
      row.style.animationDelay = `${(i - animStart) * 45}ms`;
    }
  });
  attachAdminImgFade(c);
  requestAnimationFrame(pinChatToBottom);
  await markRead(clientId);
  const cl = clients.find(x => x.id === clientId);
  if (cl) { cl.unread_count = 0; renderClients(); updateUnreadBadge(); }
}

function updateChatHeader() {
  const c = clients.find(x => x.id === currentClientId);
  if (!c) return;
  document.getElementById('cp-name').textContent = c.admin_label || c.display_name;
  const sub = document.getElementById('cp-sub');
  if (c.is_online) {
    sub.textContent = 'Online';
    sub.style.color = '#34c759';
  } else if (c.last_seen_at) {
    sub.textContent = 'Senast ' + timeAgo(c.last_seen_at);
    sub.style.color = '';
  } else {
    sub.textContent = c.admin_label ? c.display_name : '';
    sub.style.color = '';
  }
  document.getElementById('label-input').value = c.admin_label || '';
}

function appendMsg(m) {
  const c = document.getElementById('chat-messages');
  const empty = c.querySelector('.chat-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.innerHTML = msgHTML(m);
  const el = div.firstElementChild;
  el.classList.add('anim-in');
  c.appendChild(el);
  attachAdminImgFade(el);
  requestAnimationFrame(() => {
    const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 80;
    if (atBottom) {
      c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
      _chatAutoScroll = true;
      if (_chatPinObserver) _chatPinObserver.observe(el);
    }
  });
}

function attachAdminImgFade(container) {
  container.querySelectorAll('.bubble-media img:not(.loaded)').forEach(img => {
    if (img.complete) { img.classList.add('loaded'); return; }
    img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
  });
}

function msgHTML(m) {
  const time = new Date(m.created_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const from = m.sender === 'admin' ? 'from-admin' : 'from-client';
  const tick = m.sender === 'admin' ? `<span class="read-tick">${m.read ? 'read' : ''}</span>` : '';
  let bubbleInner;
  if (m.message_type === 'pdf' && m.metadata?.url) {
    bubbleInner = `<a class="bubble-pdf" href="${m.metadata.url}" target="_blank" rel="noopener">
      <span class="bubble-pdf-icon">📄</span>
      <span>
        <div class="bubble-pdf-label">Vision Palace Catalogue</div>
        <div class="bubble-pdf-sub">Tap to open PDF</div>
      </span>
    </a>`;
  } else {
    const media = m.message_media || [];
    const mediaHTML = media.map(md => md.storage_url
      ? (md.type === 'video'
        ? `<video src="${md.storage_url}" controls style="max-width:200px;border-radius:10px;margin-top:6px;display:block"></video>`
        : `<img src="${md.thumbnail_url || md.storage_url}" data-full="${md.storage_url}" onclick="openLightbox(this.dataset.full)" loading="lazy" decoding="async">`)
      : `<span style="font-size:12px;color:#555;font-style:italic">Bild ej tillgänglig</span>`
    ).join('');
    bubbleInner = `<div class="bubble">${m.text ? esc(m.text) : ''}${mediaHTML ? `<div class="bubble-media">${mediaHTML}</div>` : ''}</div>`;
  }
  let meta;
  if (m._pending) {
    meta = `Skickar… <span class="bc-sending-dot"></span>`;
  } else if (m._failed) {
    meta = `<span style="color:#ff7a7a">Kunde inte skicka</span>
      <button class="msg-retry-btn" onclick="retryChatMsg('${m.id}')">Försök igen</button>
      <button class="msg-discard-btn" onclick="discardChatMsg('${m.id}')" title="Släng">✕</button>`;
  } else {
    meta = `${time} ${tick}`;
  }
  return `<div class="msg-row ${from}${m._pending ? ' pending' : ''}${m._failed ? ' failed' : ''}" data-id="${m.id}">
    ${bubbleInner}
    <div class="msg-meta">${meta}</div>
  </div>`;
}

function markMsgsReadUI() {
  document.querySelectorAll('.msg-row.from-admin .read-tick').forEach(el => el.textContent = 'read');
}

async function markRead(clientId) {
  await api(`/api/messages/${clientId}/read`, { method: 'POST' });
}

// ── Optimistic send: bubble shows instantly, server ack replaces it ──
let _pendingChatMsgs = {}; // tempId -> { clientId, text, items }

function sendMessage() {
  if (!currentClientId) return;
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  const items = pendingChatMedia.filter(i => !i.removed);
  if (!text && items.length === 0) return;

  // Clear composer instantly — feedback regardless of network speed
  input.value = '';
  autoResize(input);
  pendingChatMedia = [];
  document.getElementById('chat-media-prev').innerHTML = '';

  const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const createdAt = new Date().toISOString();
  const optimistic = {
    id: tempId, sender: 'admin', text,
    created_at: createdAt,
    message_media: items.map(i => ({
      storage_url: i.url || i.localUrl,
      thumbnail_url: i.thumbUrl || i.localUrl,
      type: i.type
    })),
    _pending: true
  };
  _pendingChatMsgs[tempId] = { clientId: currentClientId, text, items, createdAt };
  appendMsg(optimistic);
  deliverChatMsg(tempId);
}

// Re-upload items whose first upload failed, using the local blob still shown
// in the pending bubble — makes "Försök igen" work after an upload failure.
async function reuploadChatItems(items) {
  const missing = items.filter(i => !i.removed && !i.url && i.localUrl);
  if (!missing.length) return;
  const blobs = await Promise.all(missing.map(i => fetch(i.localUrl).then(r => r.blob())));
  const compressed = await Promise.all(blobs.map(b => compressImage(b)));
  const form = new FormData();
  compressed.forEach((blob, i) => form.append('files', blob, missing[i].fileName || 'media.jpg'));
  const r = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!r.ok) return;
  const d = await r.json();
  (d.files || []).forEach((f, i) => { missing[i].url = f.url; missing[i].thumbUrl = f.thumbUrl; });
}

async function deliverChatMsg(tempId) {
  const p = _pendingChatMsgs[tempId];
  if (!p) return;
  try {
    const promises = [...new Set(p.items.map(i => i.uploadPromise).filter(Boolean))];
    if (promises.length) await Promise.all(promises);
    await reuploadChatItems(p.items);
    if (p.items.some(i => !i.removed && !i.url)) throw new Error('upload incomplete');
    const media = p.items.filter(i => i.url).map(i => ({ url: i.url, thumbUrl: i.thumbUrl, type: i.type }));
    const r = await api(`/api/messages/${p.clientId}`, {
      method: 'POST', body: JSON.stringify({ text: p.text, media })
    });
    if (!r.ok) throw new Error('server error');
    const d = await r.json();
    delete _pendingChatMsgs[tempId];
    replaceMsgRow(tempId, d.message);
    p.items.forEach(i => { if (i.localUrl) URL.revokeObjectURL(i.localUrl); });
  } catch {
    setMsgRowState(tempId, { _failed: true });
  }
}

function replaceMsgRow(tempId, m) {
  const row = document.querySelector(`.msg-row[data-id="${tempId}"]`);
  if (!row) return;
  const div = document.createElement('div');
  div.innerHTML = msgHTML(m);
  const el = div.firstElementChild;
  row.replaceWith(el);
  attachAdminImgFade(el);
  if (_chatPinObserver && _chatAutoScroll) _chatPinObserver.observe(el);
}

function setMsgRowState(tempId, state) {
  const p = _pendingChatMsgs[tempId];
  if (!p) return;
  const row = document.querySelector(`.msg-row[data-id="${tempId}"]`);
  if (!row) return;
  const m = {
    id: tempId, sender: 'admin', text: p.text,
    created_at: p.createdAt,
    message_media: p.items.map(i => ({
      storage_url: i.url || i.localUrl,
      thumbnail_url: i.thumbUrl || i.localUrl,
      type: i.type
    })),
    ...state
  };
  const div = document.createElement('div');
  div.innerHTML = msgHTML(m);
  const el = div.firstElementChild;
  row.replaceWith(el);
  attachAdminImgFade(el);
  if (_chatPinObserver && _chatAutoScroll) _chatPinObserver.observe(el);
}

function retryChatMsg(tempId) {
  setMsgRowState(tempId, { _pending: true });
  deliverChatMsg(tempId);
}

function discardChatMsg(tempId) {
  const p = _pendingChatMsgs[tempId];
  if (p) p.items.forEach(i => { if (i.localUrl) URL.revokeObjectURL(i.localUrl); });
  delete _pendingChatMsgs[tempId];
  const row = document.querySelector(`.msg-row[data-id="${tempId}"]`);
  if (row) row.remove();
}

document.getElementById('send-btn').onclick = sendMessage;
document.getElementById('msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (socket) socket.emit('admin:typing', { client_id: currentClientId });
});
document.getElementById('msg-input').addEventListener('input', function () { autoResize(this); });

document.getElementById('chat-back').onclick = () => {
  document.getElementById('chat-panel').classList.remove('open');
  currentClientId = null;
  unpinChat();
};

document.getElementById('label-save-btn').onclick = async () => {
  if (!currentClientId) return;
  const label = document.getElementById('label-input').value.trim();
  await api(`/api/clients/${currentClientId}/label`, { method: 'PATCH', body: JSON.stringify({ admin_label: label }) });
};

document.getElementById('delete-client-btn').onclick = async () => {
  if (!currentClientId) return;
  const c = clients.find(x => x.id === currentClientId);
  const name = c?.admin_label || c?.display_name || 'klienten';
  if (!confirm(`Ta bort ${name}? Alla meddelanden raderas permanent.`)) return;
  const r = await api(`/api/clients/${currentClientId}`, { method: 'DELETE' });
  if (r.ok) {
    clients = clients.filter(x => x.id !== currentClientId);
    currentClientId = null;
    document.getElementById('chat-panel').classList.remove('open');
    unpinChat();
    renderClients();
  }
};
