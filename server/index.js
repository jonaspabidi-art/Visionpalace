require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { loadPushSubs } = require('./lib/push');
const { hashPassword } = require('./lib/auth');
const supabase = require('./lib/supabase');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/admin' || req.path === '/client' || req.path.startsWith('/join/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});
app.use(express.static(path.join(__dirname, '../public')));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api', require('./routes/auth')(io));
app.use('/api', require('./routes/broadcasts')(io));
app.use('/api', require('./routes/messages')(io));
app.use('/api', require('./routes/clients')(io));
app.use('/api', require('./routes/inventory')(io));
app.use('/api', require('./routes/lenses')(io));
app.use('/api', require('./routes/sales')(io));
app.use('/api', require('./routes/upload')(io));
app.use('/api', require('./routes/push')(io));

// ─── SPA routes ───────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.redirect('/client'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin.html')));
app.get('/client', (req, res) => res.sendFile(path.join(__dirname, '../public/client.html')));
app.get('/join/:token', (req, res) => res.sendFile(path.join(__dirname, '../public/client.html')));

// ─── WebSockets ───────────────────────────────────────────────────────────────

require('./socket')(io);

// ─── Admin seeding ────────────────────────────────────────────────────────────

async function seedAdmins() {
  const username1 = (process.env.ADMIN_USERNAME || 'visionpalace').toLowerCase();
  const password1 = process.env.ADMIN_PASSWORD;
  const username2 = process.env.ADMIN2_USERNAME ? process.env.ADMIN2_USERNAME.toLowerCase() : null;
  const password2 = process.env.ADMIN2_PASSWORD;

  const toSeed = [
    { username: username1, password: password1, display_name: process.env.ADMIN_DISPLAY || 'Vision Palace' }
  ];
  if (username2 && password2) {
    toSeed.push({ username: username2, password: password2, display_name: process.env.ADMIN2_DISPLAY || username2 });
  }

  for (const a of toSeed) {
    if (!a.password) continue;
    const { data: existing } = await supabase.from('admins').select('id').eq('username', a.username).single();
    if (!existing) {
      await supabase.from('admins').insert({ username: a.username, password_hash: hashPassword(a.password), display_name: a.display_name });
      console.log(`[seed] Created admin: ${a.username}`);
    }
  }

  // Assign orphaned clients/sales/broadcasts to first admin
  const { data: firstAdmin } = await supabase.from('admins').select('id').eq('username', username1).single();
  if (firstAdmin) {
    await supabase.from('clients').update({ admin_id: firstAdmin.id }).is('admin_id', null);
    await supabase.from('sales').update({ admin_id: firstAdmin.id }).is('admin_id', null);
    await supabase.from('broadcasts').update({ admin_id: firstAdmin.id }).is('admin_id', null);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

process.on('uncaughtException', err => {
  console.error('Uncaught exception (server kept alive):', err.message);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection (server kept alive):', err?.message || err);
});

const PORT = process.env.PORT || 3000;
(async () => {
  await seedAdmins().catch(err => console.error('[seed] Admin seed failed:', err.message));
  server.listen(PORT, () => {
    console.log(`Vision Palace running on port ${PORT}`);
    loadPushSubs();
  });
})();
