let _bcAutoScroll = false;
let _bcScrollListenerReady = false;

async function loadBroadcasts(q = '') {
  const gen = ++bcLoadGen;
  const url = q ? `/api/broadcasts/search?q=${encodeURIComponent(q)}` : '/api/broadcasts';
  const r = await api(url);
  if (gen !== bcLoadGen) return;
  const d = await r.json();
  if (gen !== bcLoadGen) return;
  const pending = broadcasts.filter(b => b._pending || b._failed);
  const fresh = (d.broadcasts || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  broadcasts = [...fresh, ...pending];
  const scrollDown = bcInitialLoad;
  bcInitialLoad = false;
  renderFeed(scrollDown);
}

function renderFeed(scrollToBottom = false) {
  const feed = document.getElementById('bc-feed');
  const prevScrollBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
  if (!broadcasts.length) {
    feed.innerHTML = '<div class="feed-empty">Inga sändningar ännu</div>';
    return;
  }
  let html = '';
  let lastDate = '';
  for (const b of broadcasts) {
    const d = new Date(b.created_at);
    const dateStr = d.toLocaleDateString('sv-SE', { day: '2-digit', month: 'short', year: 'numeric' });
    if (dateStr !== lastDate) {
      html += `<div class="bc-date-sep"><span>${dateStr}</span></div>`;
      lastDate = dateStr;
    }
    html += bcBubbleHTML(b);
  }
  feed.innerHTML = html;
  if (scrollToBottom || prevScrollBottom < 60) {
    if (!_bcScrollListenerReady) {
      _bcScrollListenerReady = true;
      feed.addEventListener('scroll', () => {
        if (_bcAutoScroll && feed.scrollHeight - feed.scrollTop - feed.clientHeight > 80) {
          _bcAutoScroll = false;
        }
      }, { passive: true });
    }
    _bcAutoScroll = true;
    feed.scrollTop = 999999;
    feed.querySelectorAll('img').forEach(img => {
      if (!img.complete) img.addEventListener('load', () => {
        if (_bcAutoScroll) feed.scrollTop = 999999;
      }, { once: true });
    });
  }
}

function appendBroadcast(b) {
  if (document.querySelector(`.bc-msg-row[data-id="${b.id}"]`)) return;
  const feed = document.getElementById('bc-feed');
  const empty = feed.querySelector('.feed-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.innerHTML = bcBubbleHTML(b);
  feed.appendChild(div.firstElementChild);
  requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight; });
}

function bcBubbleHTML(b) {
  const time = new Date(b.created_at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  const media = b.broadcast_media || [];
  const interested = (b.broadcast_reactions || []).filter(r => r.reaction === 'interested').length;
  const notInt = (b.broadcast_reactions || []).filter(r => r.reaction === 'not_interested').length;
  const seenCount = (b.broadcast_views || []).length;
  const pending = !!b._pending;
  const failed = !!b._failed;

  const imgSrc = m => m.storage_url || '';
  const imgAttrs = m => (pending || failed)
    ? ''
    : `data-full="${m.storage_url}" onclick="openLightbox(this.dataset.full)"`;

  let mediaHTML = '';
  if (media.length === 1) {
    const m = media[0];
    mediaHTML = m.storage_url
      ? (m.type === 'video'
        ? `<video src="${m.storage_url}" ${pending ? '' : 'controls'} style="max-width:220px;border-radius:10px;display:block;margin-bottom:6px"></video>`
        : `<img src="${imgSrc(m)}" ${imgAttrs(m)} style="max-width:220px;border-radius:10px;display:block;margin-bottom:6px;cursor:${pending ? 'default' : 'pointer'}" loading="lazy">`)
      : '';
  } else if (media.length > 1) {
    const items = media.map(m => m.storage_url
      ? (m.type === 'video'
          ? `<video src="${m.storage_url}" ${pending ? '' : 'controls'} playsinline></video>`
          : `<img src="${imgSrc(m)}" ${imgAttrs(m)} loading="lazy">`)
      : ''
    ).join('');
    mediaHTML = `<div class="bc-media-strip-admin">${items}</div>`;
  }

  let footerHTML;
  if (pending) {
    footerHTML = `<span class="bc-bubble-time">Skickar… <span class="bc-sending-dot"></span></span>`;
  } else if (failed) {
    footerHTML = `<span class="bc-bubble-time" style="color:#ffb3b3" title="${esc(b._failReason || '')}">Fel: ${esc(b._failReason || 'okänt')}</span>
      <button class="bc-retry-btn" onclick="retryBroadcast('${b.id}')">Försök igen</button>
      <button class="bc-del-btn" onclick="discardFailedBroadcast('${b.id}')" title="Släng">✕</button>`;
  } else {
    footerHTML = `<span class="bc-bubble-time">${time}</span>
      <button class="bc-seen-btn" onclick="showViews('${b.id}')">Sedd ${seenCount}</button>
      <button class="bc-react-btn" onclick="showReactions('${b.id}')">✓ ${interested} &nbsp; ✕ ${notInt}</button>
      <button class="bc-pin-btn${b.is_pinned ? ' pinned' : ''}" onclick="togglePin('${b.id}')" title="${b.is_pinned ? 'Ta bort fästning' : 'Fäst'}">◈</button>
      <button class="bc-del-btn" onclick="deleteBroadcast('${b.id}')" title="Ta bort">✕</button>`;
  }

  const rowCls = `bc-msg-row${pending ? ' pending' : ''}${failed ? ' failed' : ''}`;
  return `<div class="${rowCls}" data-id="${b.id}">
    ${b.is_pinned ? '<div class="bc-pin-tag">◈ Fäst</div>' : ''}
    <div class="bc-bubble">
      ${mediaHTML}
      ${b.price ? `<div class="bc-bubble-price">${esc(b.price)}</div>` : ''}
      ${b.text ? `<div class="bc-bubble-text">${esc(b.text)}</div>` : ''}
      <div class="bc-bubble-footer">${footerHTML}</div>
    </div>
  </div>`;
}

function updateReactionUI(broadcastId, reactions) {
  const row = document.querySelector(`.bc-msg-row[data-id="${broadcastId}"]`);
  if (!row) return;
  const interested = reactions.filter(r => r.reaction === 'interested').length;
  const notInt = reactions.filter(r => r.reaction === 'not_interested').length;
  const btn = row.querySelector('.bc-react-btn');
  if (btn) btn.innerHTML = `✓ ${interested} &nbsp; ✕ ${notInt}`;
}

function postBroadcast() {
  const text = document.getElementById('bc-text').value.trim();
  const price = document.getElementById('bc-price').value.trim();
  const is_pinned = document.getElementById('bc-pin').checked;
  const items = pendingBcMedia.filter(i => !i.removed);
  if (!text && !price && items.length === 0) return;

  // Clear composer instantly — gives immediate feedback regardless of network speed
  document.getElementById('bc-text').value = '';
  document.getElementById('bc-price').value = '';
  document.getElementById('bc-pin').checked = false;
  pendingBcMedia = [];
  document.getElementById('bc-media-prev').innerHTML = '';
  updateBcSendBtn();
  if (extrasOpen) {
    extrasOpen = false;
    document.getElementById('bc-extras').style.display = 'none';
    document.getElementById('bc-extras-btn').classList.remove('active');
  }
  autoResize(document.getElementById('bc-text'));

  // Build optimistic broadcast and show it in the feed immediately
  const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  inFlightBcTempIds.add(tempId);
  const optimistic = {
    id: tempId,
    text, price, is_pinned,
    created_at: new Date().toISOString(),
    broadcast_media: items.map(i => ({
      storage_url: i.url || i.localUrl,
      thumbnail_url: i.thumbUrl || i.localUrl,
      type: i.type
    })),
    broadcast_reactions: [],
    _pending: true,
    _items: items
  };
  broadcasts.push(optimistic);
  appendBroadcast(optimistic);

  sendBroadcast(optimistic);
}

async function sendBroadcast(optimistic) {
  const tempId = optimistic.id;
  try {
    // Wait for all uploads in this draft (silenced promises — never throw)
    const promises = [...new Set(optimistic._items.map(i => i.uploadPromise).filter(Boolean))];
    if (promises.length) await Promise.all(promises);

    // Check upload results via item.url (set by uploadFiles on success)
    const failedUploads = optimistic._items.filter(i => !i.removed && !i.url);
    if (failedUploads.length) throw new Error('upload incomplete');

    // Only include items that successfully uploaded
    const media = optimistic._items.filter(i => !i.removed && i.url)
      .map(i => ({ url: i.url, thumbUrl: i.thumbUrl, type: i.type }));

    const r = await api('/api/broadcasts', {
      method: 'POST',
      body: JSON.stringify({
        text: optimistic.text,
        price: optimistic.price,
        is_pinned: optimistic.is_pinned,
        media,
        client_temp_id: tempId
      })
    });
    if (!r.ok) {
      const errBody = await r.json().catch(() => ({}));
      throw new Error(`server ${r.status}: ${errBody.error || 'unknown'}`);
    }
    const d = await r.json();

    discardOptimisticBroadcast(tempId);
    if (d.broadcast && !broadcasts.find(b => b.id === d.broadcast.id)) {
      broadcasts.push(d.broadcast);
      appendBroadcast(d.broadcast);
    } else if (!d.broadcast) {
      loadBroadcasts();
    }
  } catch (e) {
    markBroadcastFailed(tempId, e.message);
  } finally {
    inFlightBcTempIds.delete(tempId);
  }
}

function discardOptimisticBroadcast(tempId) {
  broadcasts = broadcasts.filter(b => b.id !== tempId);
  const row = document.querySelector(`.bc-msg-row[data-id="${tempId}"]`);
  if (row) row.remove();
}

function markBroadcastFailed(tempId, reason) {
  const b = broadcasts.find(x => x.id === tempId);
  if (!b) return;
  b._pending = false;
  b._failed = true;
  b._failReason = reason || 'okänt fel';
  const row = document.querySelector(`.bc-msg-row[data-id="${tempId}"]`);
  if (row) {
    const div = document.createElement('div');
    div.innerHTML = bcBubbleHTML(b);
    row.replaceWith(div.firstElementChild);
  }
}

function retryBroadcast(tempId) {
  const b = broadcasts.find(x => x.id === tempId);
  if (!b) return;
  b._pending = true;
  b._failed = false;
  inFlightBcTempIds.add(tempId);
  const row = document.querySelector(`.bc-msg-row[data-id="${tempId}"]`);
  if (row) {
    const div = document.createElement('div');
    div.innerHTML = bcBubbleHTML(b);
    row.replaceWith(div.firstElementChild);
  }
  sendBroadcast(b);
}

function discardFailedBroadcast(tempId) {
  broadcasts = broadcasts.filter(b => b.id !== tempId);
  const row = document.querySelector(`.bc-msg-row[data-id="${tempId}"]`);
  if (row) row.remove();
}

async function deleteBroadcast(id) {
  if (!confirm('Ta bort detta meddelande för alla? Det går inte att ångra.')) return;
  // Remove instantly from UI — don't wait for server
  broadcasts = broadcasts.filter(b => b.id !== id);
  const row = document.querySelector(`.bc-msg-row[data-id="${id}"]`);
  if (row) row.remove();
  api(`/api/broadcasts/${id}`, { method: 'DELETE' });
}

async function togglePin(id) {
  const b = broadcasts.find(x => x.id === id);
  if (b) b.is_pinned = !b.is_pinned;
  renderFeed();
  api(`/api/broadcasts/${id}/pin`, { method: 'PATCH' });
}

async function showReactions(id) {
  const r = await api(`/api/reactions/${id}`);
  const d = await r.json();
  const list = document.getElementById('reaction-list');
  list.innerHTML = !d.reactions?.length
    ? '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px">Inga reaktioner ännu</div>'
    : d.reactions.map(r => `<div class="reaction-item">
        <span class="reaction-name">${esc(r.clients?.admin_label || r.clients?.display_name || 'Okänd')}</span>
        <span class="reaction-val">${r.reaction === 'interested' ? '✓ Intresserad' : '✕ Inte intresserad'}</span>
      </div>`).join('');
  document.getElementById('reaction-modal').classList.add('open');
}

async function showViews(id) {
  const r = await api(`/api/broadcasts/${id}/views`);
  const d = await r.json();
  const list = document.getElementById('views-list');
  list.innerHTML = !d.views?.length
    ? '<div style="color:var(--text3);font-size:13px;text-align:center;padding:16px">Ingen har sett detta ännu</div>'
    : d.views.map(v => `<div class="reaction-item">
        <span class="reaction-name">${esc(v.clients?.admin_label || v.clients?.display_name || 'Okänd')}</span>
        <span class="reaction-val" style="color:var(--text3)">${new Date(v.seen_at).toLocaleString('sv-SE',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
      </div>`).join('');
  document.getElementById('views-modal').classList.add('open');
}
