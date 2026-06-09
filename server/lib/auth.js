const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const supabase = require('./supabase');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return verify === hash;
}

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

module.exports = { hashPassword, verifyPassword, signAdminJWT, verifyAdminJWT, getClientBySession, adminAuth, clientAuth, anyAuth };
