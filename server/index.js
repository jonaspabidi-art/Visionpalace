require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { loadPushSubs } = require('./lib/push');

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

// ─── Start ────────────────────────────────────────────────────────────────────

process.on('uncaughtException', err => {
  console.error('Uncaught exception (server kept alive):', err.message);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection (server kept alive):', err?.message || err);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Vision Palace running on port ${PORT}`);
  loadPushSubs();
});
