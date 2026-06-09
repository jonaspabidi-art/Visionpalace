function connectSocket() {
  socket = io({ auth: { session_token: session.session_token }, transports: ['websocket', 'polling'] });
  socket.on('connect', () => { loadBroadcasts(); loadMessages(); setupPush(); });
  socket.on('admin:new_broadcast', d => { broadcasts.unshift(d.broadcast); renderFeed(); scrollFeedBottom(); });
  socket.on('broadcast:pin_updated', d => {
    const b = broadcasts.find(x=>x.id===d.id);
    if (b) b.is_pinned = d.is_pinned;
    renderFeed();
  });
  socket.on('broadcast:deleted', d => {
    broadcasts = broadcasts.filter(b => b.id !== d.id);
    renderFeed();
  });
  socket.on('admin:new_message', d => {
    appendChatMsg(d.message);
    if (!chatOpen) { chatUnread++; updateUnread(); }
    else markRead();
  });
  socket.on('sale:status_updated', () => { loadPurchases(); });
  socket.on('admin:typing', () => {
    const row = document.getElementById('typing-row');
    row.style.opacity = '1';
    row.style.pointerEvents = '';
    clearTimeout(window._tt);
    window._tt = setTimeout(() => { row.style.opacity = '0'; row.style.pointerEvents = 'none'; }, 3000);
    const c = document.getElementById('chat-messages');
    if (c.scrollHeight - c.scrollTop - c.clientHeight < 80) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
  });
}
