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
  requestAnimationFrame(() => requestAnimationFrame(() => { c.scrollTop = c.scrollHeight; }));
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
    if (atBottom) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
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
        : `<img src="${md.thumbnail_url || md.storage_url}" data-full="${md.storage_url}" onclick="openLightbox(this.dataset.full)" style="max-width:200px;border-radius:10px;margin-top:6px;cursor:pointer;display:block" loading="lazy">`)
      : `<span style="font-size:12px;color:#555;font-style:italic">Bild ej tillgänglig</span>`
    ).join('');
    bubbleInner = `<div class="bubble">${m.text ? esc(m.text) : ''}${mediaHTML ? `<div class="bubble-media">${mediaHTML}</div>` : ''}</div>`;
  }
  return `<div class="msg-row ${from}">
    ${bubbleInner}
    <div class="msg-meta">${time} ${tick}</div>
  </div>`;
}

function markMsgsReadUI() {
  document.querySelectorAll('.msg-row.from-admin .read-tick').forEach(el => el.textContent = 'read');
}

async function markRead(clientId) {
  await api(`/api/messages/${clientId}/read`, { method: 'POST' });
}

let sending = false;
async function sendMessage() {
  if (sending) return;
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  const items = pendingChatMedia.filter(i => !i.removed);
  if (!text && items.length === 0) return;
  sending = true;
  const btn = document.getElementById('send-btn');
  btn.disabled = true;
  input.value = '';
  autoResize(input);
  try {
    const promises = [...new Set(items.map(i => i.uploadPromise).filter(Boolean))];
    if (promises.length) {
      try { await Promise.all(promises); }
      catch { return; }
    }
    const media = items.map(i => ({ url: i.url, thumbUrl: i.thumbUrl, type: i.type }));
    const r = await api(`/api/messages/${currentClientId}`, {
      method: 'POST', body: JSON.stringify({ text, media })
    });
    if (r.ok) {
      pendingChatMedia = [];
      document.getElementById('chat-media-prev').innerHTML = '';
      const d = await r.json();
      appendMsg(d.message);
    }
  } finally {
    sending = false;
    btn.disabled = false;
  }
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
    renderClients();
  }
};
