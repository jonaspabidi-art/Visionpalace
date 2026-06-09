const { v4: uuidv4 } = require('uuid');
const { hashPassword, verifyPassword, signAdminJWT, adminAuth } = require('../lib/auth');
const supabase = require('../lib/supabase');

module.exports = (io) => {
  const router = require('express').Router();

  // Admin login
  router.post('/auth/admin', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(401).json({ error: 'Användarnamn och lösenord krävs' });
    const { data: admin } = await supabase.from('admins').select('*').eq('username', username.trim().toLowerCase()).single();
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Fel användarnamn eller lösenord' });
    }
    res.json({ token: signAdminJWT(admin.id) });
  });

  // Create invite links (scoped to requesting admin)
  router.post('/invite', adminAuth, async (req, res) => {
    const count = Math.min(parseInt(req.body.count) || 1, 10);
    const tokens = [];
    for (let i = 0; i < count; i++) {
      const token = uuidv4();
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('invites').insert({ token, expires_at: expires, admin_id: req.adminId });
      tokens.push(token);
    }
    res.json({ tokens });
  });

  // Client joins via invite
  router.post('/join/:token', async (req, res) => {
    const { token } = req.params;
    const { username, full_name, address, phone, password } = req.body;
    if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required.' });
    if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

    const { data: invite } = await supabase.from('invites').select('*').eq('token', token).single();
    if (!invite) return res.status(404).json({ error: 'Invalid invite link.' });
    if (invite.used) return res.status(400).json({ error: 'This invite link has already been used.' });
    if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'This invite link has expired.' });

    const sessionToken = uuidv4();
    const { data: client, error } = await supabase.from('clients').insert({
      display_name: username.trim(),
      full_name: full_name?.trim() || null,
      address: address?.trim() || null,
      phone: phone?.trim() || null,
      invite_token: token,
      session_token: sessionToken,
      password_hash: hashPassword(password),
      admin_id: invite.admin_id || null,
      joined_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('invites').update({ used: true }).eq('token', token);

    const adminRoom = invite.admin_id ? `admin-${invite.admin_id}` : 'admins';
    io.to(adminRoom).emit('client:joined', { client });

    res.json({ ok: true });
  });

  // Client login (returning user)
  router.post('/auth/client', async (req, res) => {
    const { display_name, password } = req.body;
    if (!display_name || !password) return res.status(400).json({ error: 'Name and password are required.' });

    const { data: matches } = await supabase.from('clients')
      .select('*')
      .ilike('display_name', display_name.trim());

    if (!matches || matches.length === 0) return res.status(401).json({ error: 'Incorrect name or password.' });

    const client = matches.find(c => verifyPassword(password, c.password_hash));
    if (!client) return res.status(401).json({ error: 'Incorrect name or password.' });
    if (client.is_inactive) return res.status(403).json({ error: 'Your account has been deactivated.' });

    await supabase.from('clients').update({ last_seen_at: new Date().toISOString() }).eq('id', client.id);
    res.json({ session_token: client.session_token, client_id: client.id, display_name: client.display_name, full_name: client.full_name, address: client.address, phone: client.phone });
  });

  return router;
};
