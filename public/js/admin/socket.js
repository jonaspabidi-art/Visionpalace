function connectSocket() {
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });

  socket.on('admin:new_broadcast', d => {
    // Our own optimistic POST is still in flight — let the HTTP response replace the pending bubble
    if (d.client_temp_id && inFlightBcTempIds.has(d.client_temp_id)) return;
    if (broadcasts.find(x => x.id === d.broadcast.id)) return;
    broadcasts.push(d.broadcast);
    appendBroadcast(d.broadcast);
  });

  socket.on('broadcast:pin_updated', d => {
    const b = broadcasts.find(x => x.id === d.id);
    if (b && b.is_pinned === d.is_pinned) return; // already updated optimistically
    if (b) b.is_pinned = d.is_pinned;
    renderFeed();
  });

  socket.on('broadcast:deleted', d => {
    broadcasts = broadcasts.filter(b => b.id !== d.id);
    const row = document.querySelector(`.bc-msg-row[data-id="${d.id}"]`);
    if (row) row.remove();
  });

  socket.on('broadcast:new_reaction', d => {
    const b = broadcasts.find(x => x.id === d.broadcast_id);
    if (b) b.broadcast_reactions = d.reactions;
    // Update just the reaction counts in the DOM
    updateReactionUI(d.broadcast_id, d.reactions);
  });

  socket.on('client:new_message', d => {
    if (currentClientId === d.client.id) {
      appendMsg(d.message);
      markRead(currentClientId);
    } else {
      let c = clients.find(x => x.id === d.client.id);
      if (!c) {
        // Client not in local list yet — refresh from server
        loadClients();
      } else {
        c.unread_count = (c.unread_count || 0) + 1;
        renderClients();
        updateUnreadBadge();
      }
    }
  });

  socket.on('client:last_seen', d => {
    const c = clients.find(x => x.id === d.client_id);
    if (c) { c.last_seen_at = d.last_seen_at; renderClients(); }
  });

  socket.on('client:joined', d => { clients.unshift({ ...d.client, unread_count: 0 }); renderClients(); });

  // After reconnect (e.g. server restart), reload fresh data and re-register push
  socket.on('connect', () => {
    loadBroadcasts();
    loadClients();
    setupPush();
  });

  socket.on('client:updated', d => {
    const i = clients.findIndex(x => x.id === d.client.id);
    if (i >= 0) clients[i] = { ...clients[i], ...d.client };
    renderClients();
    if (currentClientId === d.client.id) updateChatHeader();
  });

  socket.on('client:deleted', d => {
    clients = clients.filter(x => x.id !== d.client_id);
    if (currentClientId === d.client_id) {
      currentClientId = null;
      document.getElementById('chat-panel').classList.remove('open');
    }
    renderClients();
  });

  socket.on('client:typing', d => {
    if (currentClientId === d.client_id) {
      const row = document.getElementById('typing-row');
      row.style.opacity = '1';
      row.style.pointerEvents = '';
      clearTimeout(window._tt);
      window._tt = setTimeout(() => { row.style.opacity = '0'; row.style.pointerEvents = 'none'; }, 3000);
      const c = document.getElementById('chat-messages');
      if (c.scrollHeight - c.scrollTop - c.clientHeight < 80) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
    }
  });

  socket.on('client:online', d => {
    const c = clients.find(x => x.id === d.client_id);
    if (c) { c.is_online = true; renderClients(); if (currentClientId === d.client_id) updateChatHeader(); }
  });

  socket.on('client:offline', d => {
    const c = clients.find(x => x.id === d.client_id);
    if (c) { c.is_online = false; c.last_seen_at = d.last_seen_at; renderClients(); if (currentClientId === d.client_id) updateChatHeader(); }
  });

  socket.on('client:read_receipt', d => {
    if (currentClientId === d.client_id) markMsgsReadUI();
  });
  socket.on('inventory:sold', d => {
    const gone = new Set(d.ids || []);
    gone.forEach(id => delete invItemsMap[id]);
    if (activeInvTab === 'glasses') renderInventory(Object.values(invItemsMap));
    // Hann den andra admin sälja ett par som ligger i min korg måste det ut,
    // annars säljs ett par som inte finns
    if (typeof saleCartItems !== 'undefined' && gone.size) {
      let dropped = 0;
      saleCartItems.forEach(entry => {
        const before = entry.ids.length;
        entry.ids = entry.ids.filter(id => !gone.has(id));
        entry.qty = entry.ids.length;
        dropped += before - entry.ids.length;
      });
      saleCartItems = saleCartItems.filter(e => e.ids.length);
      if (dropped) {
        showToast(`${dropped} ${dropped === 1 ? 'vara' : 'varor'} såldes av det andra kontot och togs ur din försäljning`, 'error');
        renderSaleCart();
      }
    }
    renderSaleInvList();
    updateSaleCartBadge();
  });
}
