require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const path = require('path');
const ws = require('ws');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// ─── Auth helpers ────────────────────────────────────────────────────────────

function signAdminJWT() {
  return jwt.sign({ role: 'admin' }, process.env.JWT_SECRET);
}

function verifyAdminJWT(token) {
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    return p.role === 'admin';
  } catch { return false; }
}

async function getClientBySession(token) {
  if (!token) return null;
  const { data } = await supabase.from('clients').select('*').eq('session_token', token).single();
  return data;
}

function adminAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || !verifyAdminJWT(token)) return res.status(401).json({ error: 'Unauthorized' });
  req.isAdmin = true;
  next();
}

async function clientAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  const client = await getClientBySession(token);
  if (!client) return res.status(401).json({ error: 'Unauthorized' });
  req.client = client;
  await supabase.from('clients').update({ last_seen_at: new Date().toISOString() }).eq('id', client.id);
  next();
}

async function anyAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const jwt_token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (jwt_token && verifyAdminJWT(jwt_token)) { req.isAdmin = true; return next(); }
  const session = req.headers['x-session-token'];
  const client = await getClientBySession(session);
  if (client) { req.client = client; return next(); }
  return res.status(401).json({ error: 'Unauthorized' });
}

// ─── OneSignal helper ─────────────────────────────────────────────────────────

async function sendPushToAll(title, body, data = {}) {
  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: process.env.ONESIGNAL_APP_ID,
      included_segments: ['All'],
      headings: { en: title },
      contents: { en: body },
      data
    }, { headers: { Authorization: `Bearer ${process.env.ONESIGNAL_API_KEY}` } });
  } catch (e) { console.error('OneSignal push failed:', e.message); }
}

async function sendPushToPlayer(playerId, title, body, data = {}) {
  if (!playerId) return;
  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: process.env.ONESIGNAL_APP_ID,
      include_player_ids: [playerId],
      headings: { en: title },
      contents: { en: body },
      data
    }, { headers: { Authorization: `Bearer ${process.env.ONESIGNAL_API_KEY}` } });
  } catch (e) { console.error('OneSignal push failed:', e.message); }
}

// ─── Media upload helper ──────────────────────────────────────────────────────

async function uploadMedia(buffer, originalname, mimetype) {
  const ext = path.extname(originalname).toLowerCase();
  const isVideo = ['.mp4', '.mov', '.webm'].includes(ext);
  const fileId = uuidv4();
  const fileName = `${fileId}${ext}`;
  const thumbName = `${fileId}_thumb.jpg`;

  const { error: uploadErr } = await supabase.storage
    .from('media')
    .upload(fileName, buffer, { contentType: mimetype, upsert: false });
  if (uploadErr) throw uploadErr;

  const { data: { publicUrl } } = supabase.storage.from('media').getPublicUrl(fileName);

  let thumbUrl = null;
  if (!isVideo) {
    try {
      const thumbBuffer = await sharp(buffer).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
      await supabase.storage.from('media').upload(thumbName, thumbBuffer, { contentType: 'image/jpeg' });
      const { data: { publicUrl: tu } } = supabase.storage.from('media').getPublicUrl(thumbName);
      thumbUrl = tu;
    } catch (e) { console.error('Thumbnail gen failed:', e.message); thumbUrl = publicUrl; }
  } else {
    thumbUrl = publicUrl;
  }

  return { url: publicUrl, thumbUrl, type: isVideo ? 'video' : 'image', fileName, thumbName };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Admin login
app.post('/api/auth/admin', (req, res) => {
  const { password } = req.body;
  if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Fel lösenord' });
  res.json({ token: signAdminJWT() });
});

// Create invite links
app.post('/api/invite', adminAuth, async (req, res) => {
  const count = Math.min(parseInt(req.body.count) || 1, 10);
  const tokens = [];
  for (let i = 0; i < count; i++) {
    const token = uuidv4();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('invites').insert({ token, expires_at: expires });
    tokens.push(token);
  }
  res.json({ tokens });
});

// Client joins via invite
app.post('/api/join/:token', async (req, res) => {
  const { token } = req.params;
  const { display_name } = req.body;
  if (!display_name || !display_name.trim()) return res.status(400).json({ error: 'Namn krävs' });

  const { data: invite } = await supabase.from('invites').select('*').eq('token', token).single();
  if (!invite) return res.status(404).json({ error: 'Ogiltig länk' });
  if (invite.used) return res.status(400).json({ error: 'Länken har redan använts' });
  if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'Länken har gått ut' });

  const sessionToken = uuidv4();
  const { data: client, error } = await supabase.from('clients').insert({
    display_name: display_name.trim(),
    invite_token: token,
    session_token: sessionToken,
    joined_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('invites').update({ used: true }).eq('token', token);

  io.to('admins').emit('client:joined', { client });

  res.json({ session_token: sessionToken, client_id: client.id, display_name: client.display_name });
});

// Upload media
app.post('/api/upload', anyAuth, upload.array('files', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Inga filer' });
  const results = [];
  for (const file of req.files) {
    try {
      const result = await uploadMedia(file.buffer, file.originalname, file.mimetype);
      results.push(result);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  res.json({ files: results });
});

// Get broadcasts
app.get('/api/broadcasts', anyAuth, async (req, res) => {
  const { data } = await supabase
    .from('broadcasts')
    .select('*, broadcast_media(*), broadcast_reactions(*)')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });
  res.json({ broadcasts: data || [] });
});

// Search broadcasts
app.get('/api/broadcasts/search', adminAuth, async (req, res) => {
  const q = req.query.q || '';
  const { data } = await supabase
    .from('broadcasts')
    .select('*, broadcast_media(*), broadcast_reactions(*)')
    .ilike('text', `%${q}%`)
    .order('created_at', { ascending: false });
  res.json({ broadcasts: data || [] });
});

// Post broadcast
app.post('/api/broadcasts', adminAuth, async (req, res) => {
  const { text, price, is_pinned, media } = req.body;
  if (!text && (!media || media.length === 0)) return res.status(400).json({ error: 'Text eller media krävs' });

  const { data: broadcast, error } = await supabase.from('broadcasts').insert({
    text, price, is_pinned: !!is_pinned, created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  if (media && media.length > 0) {
    const mediaRows = media.map(m => ({
      broadcast_id: broadcast.id,
      storage_url: m.url,
      thumbnail_url: m.thumbUrl,
      type: m.type
    }));
    await supabase.from('broadcast_media').insert(mediaRows);
  }

  const full = await supabase.from('broadcasts')
    .select('*, broadcast_media(*)')
    .eq('id', broadcast.id)
    .single();

  io.emit('admin:new_broadcast', { broadcast: full.data });

  // Push notify all clients
  const pushText = text ? text.substring(0, 80) : 'Ny uppdatering';
  const { data: clients } = await supabase.from('clients').select('onesignal_player_id').eq('is_inactive', false);
  const playerIds = (clients || []).map(c => c.onesignal_player_id).filter(Boolean);
  if (playerIds.length > 0) {
    await sendPushToAll('Vision Palace', pushText, { type: 'broadcast', id: broadcast.id });
  }

  res.json({ broadcast: full.data });
});

// Toggle pin
app.patch('/api/broadcasts/:id/pin', adminAuth, async (req, res) => {
  const { id } = req.params;
  const { data: current } = await supabase.from('broadcasts').select('is_pinned').eq('id', id).single();
  if (!current) return res.status(404).json({ error: 'Hittades inte' });
  const { data } = await supabase.from('broadcasts').update({ is_pinned: !current.is_pinned }).eq('id', id).select().single();
  io.emit('broadcast:pin_updated', { id, is_pinned: data.is_pinned });
  res.json({ broadcast: data });
});

// React to broadcast
app.post('/api/reactions/:broadcastId', clientAuth, async (req, res) => {
  const { broadcastId } = req.params;
  const { reaction } = req.body;
  if (!['interested', 'not_interested'].includes(reaction)) return res.status(400).json({ error: 'Ogiltig reaktion' });

  await supabase.from('broadcast_reactions')
    .upsert({ broadcast_id: broadcastId, client_id: req.client.id, reaction }, { onConflict: 'broadcast_id,client_id' });

  const { data: reactions } = await supabase.from('broadcast_reactions')
    .select('*, clients(display_name, admin_label)')
    .eq('broadcast_id', broadcastId);

  io.to('admins').emit('broadcast:new_reaction', { broadcast_id: broadcastId, reactions });
  res.json({ reactions });
});

// Get reactions for broadcast
app.get('/api/reactions/:broadcastId', adminAuth, async (req, res) => {
  const { data } = await supabase.from('broadcast_reactions')
    .select('*, clients(display_name, admin_label)')
    .eq('broadcast_id', req.params.broadcastId);
  res.json({ reactions: data || [] });
});

// Get messages for client thread
app.get('/api/messages/:clientId', adminAuth, async (req, res) => {
  const { data } = await supabase.from('messages')
    .select('*, message_media(*)')
    .eq('client_id', req.params.clientId)
    .order('created_at', { ascending: true });
  res.json({ messages: data || [] });
});

// Client gets own messages
app.get('/api/messages/me/thread', clientAuth, async (req, res) => {
  const { data } = await supabase.from('messages')
    .select('*, message_media(*)')
    .eq('client_id', req.client.id)
    .order('created_at', { ascending: true });
  res.json({ messages: data || [] });
});

// Admin sends message to client
app.post('/api/messages/:clientId', adminAuth, async (req, res) => {
  const { clientId } = req.params;
  const { text, media } = req.body;

  const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
  if (!client) return res.status(404).json({ error: 'Klient hittades inte' });

  const { data: msg, error } = await supabase.from('messages').insert({
    client_id: clientId, sender: 'admin', text, created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  if (media && media.length > 0) {
    const rows = media.map(m => ({ message_id: msg.id, storage_url: m.url, thumbnail_url: m.thumbUrl, type: m.type }));
    await supabase.from('message_media').insert(rows);
  }

  const full = await supabase.from('messages').select('*, message_media(*)').eq('id', msg.id).single();

  io.to(`client:${clientId}`).emit('admin:new_message', { message: full.data });
  io.to('admins').emit('message:sent', { message: full.data });

  if (client.onesignal_player_id) {
    await sendPushToPlayer(client.onesignal_player_id, 'Vision Palace', 'Nytt meddelande från admin', { type: 'message', client_id: clientId });
  }

  res.json({ message: full.data });
});

// Client sends message
app.post('/api/messages/me/send', clientAuth, async (req, res) => {
  const { text, media } = req.body;
  const { data: msg, error } = await supabase.from('messages').insert({
    client_id: req.client.id, sender: 'client', text, created_at: new Date().toISOString()
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  if (media && media.length > 0) {
    const rows = media.map(m => ({ message_id: msg.id, storage_url: m.url, thumbnail_url: m.thumbUrl, type: m.type }));
    await supabase.from('message_media').insert(rows);
  }

  const full = await supabase.from('messages').select('*, message_media(*)').eq('id', msg.id).single();
  io.to('admins').emit('client:new_message', { message: full.data, client: req.client });

  res.json({ message: full.data });
});

// Mark messages as read
app.post('/api/messages/:clientId/read', anyAuth, async (req, res) => {
  const { clientId } = req.params;
  const sender = req.isAdmin ? 'client' : 'admin';
  await supabase.from('messages')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('sender', sender)
    .eq('read', false);

  if (req.isAdmin) {
    io.to('admins').emit('messages:read', { client_id: clientId });
  } else {
    io.to('admins').emit('client:read_receipt', { client_id: clientId });
  }

  res.json({ ok: true });
});

// Admin: unread counts per client
app.get('/api/messages/unread', adminAuth, async (req, res) => {
  const { data } = await supabase.from('messages')
    .select('client_id')
    .eq('sender', 'client')
    .eq('read', false);

  const counts = {};
  (data || []).forEach(m => { counts[m.client_id] = (counts[m.client_id] || 0) + 1; });
  res.json({ unread: counts });
});

// Get all clients
app.get('/api/clients', adminAuth, async (req, res) => {
  const { data: clients } = await supabase.from('clients')
    .select('*')
    .order('last_seen_at', { ascending: false });

  const { data: unreadData } = await supabase.from('messages')
    .select('client_id')
    .eq('sender', 'client')
    .eq('read', false);

  const unread = {};
  (unreadData || []).forEach(m => { unread[m.client_id] = (unread[m.client_id] || 0) + 1; });

  const result = (clients || []).map(c => ({ ...c, unread_count: unread[c.id] || 0 }));
  res.json({ clients: result });
});

// Update client label
app.patch('/api/clients/:id/label', adminAuth, async (req, res) => {
  const { admin_label } = req.body;
  const { data } = await supabase.from('clients').update({ admin_label }).eq('id', req.params.id).select().single();
  io.to('admins').emit('client:updated', { client: data });
  res.json({ client: data });
});

// Toggle inactive
app.patch('/api/clients/:id/inactive', adminAuth, async (req, res) => {
  const { data: current } = await supabase.from('clients').select('is_inactive').eq('id', req.params.id).single();
  const { data } = await supabase.from('clients').update({ is_inactive: !current.is_inactive }).eq('id', req.params.id).select().single();
  io.to('admins').emit('client:updated', { client: data });
  res.json({ client: data });
});

// Save OneSignal player ID for client
app.post('/api/onesignal/register', clientAuth, async (req, res) => {
  const { player_id } = req.body;
  await supabase.from('clients').update({ onesignal_player_id: player_id }).eq('id', req.client.id);
  res.json({ ok: true });
});

// SPA routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/client', (req, res) => res.sendFile(path.join(__dirname, '../public/client.html')));
app.get('/join/:token', (req, res) => res.sendFile(path.join(__dirname, '../public/client.html')));

// ─── WebSockets ───────────────────────────────────────────────────────────────

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  const sessionToken = socket.handshake.auth.session_token;

  if (token && verifyAdminJWT(token)) {
    socket.isAdmin = true;
    return next();
  }
  if (sessionToken) {
    const client = await getClientBySession(sessionToken);
    if (client) {
      socket.client = client;
      return next();
    }
  }
  next(new Error('Unauthorized'));
});

io.on('connection', (socket) => {
  if (socket.isAdmin) {
    socket.join('admins');
    console.log('Admin connected:', socket.id);
  } else if (socket.client) {
    socket.join(`client:${socket.client.id}`);
    console.log('Client connected:', socket.client.display_name);
    supabase.from('clients').update({ last_seen_at: new Date().toISOString() }).eq('id', socket.client.id);
    io.to('admins').emit('client:last_seen', { client_id: socket.client.id, last_seen_at: new Date().toISOString() });
  }

  socket.on('disconnect', () => {
    if (socket.client) {
      supabase.from('clients').update({ last_seen_at: new Date().toISOString() }).eq('id', socket.client.id);
      io.to('admins').emit('client:last_seen', { client_id: socket.client.id, last_seen_at: new Date().toISOString() });
    }
  });

  socket.on('client:typing', () => {
    if (socket.client) io.to('admins').emit('client:typing', { client_id: socket.client.id });
  });

  socket.on('admin:typing', ({ client_id }) => {
    if (socket.isAdmin) io.to(`client:${client_id}`).emit('admin:typing');
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Vision Palace running on port ${PORT}`));
