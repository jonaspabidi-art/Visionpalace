const { verifyAdminJWT, getClientBySession } = require('./lib/auth');
const { onlineClients } = require('./lib/push');
const supabase = require('./lib/supabase');

module.exports = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const sessionToken = socket.handshake.auth.session_token;

      if (token) {
        const payload = verifyAdminJWT(token);
        if (payload) {
          socket.isAdmin = true;
          socket.adminId = payload.adminId;
          return next();
        }
      }
      if (sessionToken) {
        const client = await getClientBySession(sessionToken);
        if (client) {
          socket.client = client;
          return next();
        }
        console.log('Socket auth failed: invalid session_token');
      }
      next(new Error('Unauthorized'));
    } catch (err) {
      console.error('Socket auth error:', err.message);
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.isAdmin) {
      socket.join(`admin-${socket.adminId}`);
      console.log('Admin connected:', socket.id, 'adminId:', socket.adminId);
    } else if (socket.client) {
      socket.join(`client:${socket.client.id}`);
      if (socket.client.admin_id) socket.join(`admin-clients-${socket.client.admin_id}`);
      console.log('Client connected:', socket.client.display_name);
      onlineClients.add(socket.client.id);
      supabase.from('clients').update({ last_seen_at: new Date().toISOString() }).eq('id', socket.client.id);
      const adminRoom = socket.client.admin_id ? `admin-${socket.client.admin_id}` : 'admins';
      io.to(adminRoom).emit('client:online', { client_id: socket.client.id });
    }

    socket.on('disconnect', () => {
      if (socket.client) {
        onlineClients.delete(socket.client.id);
        const now = new Date().toISOString();
        supabase.from('clients').update({ last_seen_at: now }).eq('id', socket.client.id);
        const adminRoom = socket.client.admin_id ? `admin-${socket.client.admin_id}` : 'admins';
        io.to(adminRoom).emit('client:offline', { client_id: socket.client.id, last_seen_at: now });
      }
    });

    socket.on('client:typing', () => {
      if (socket.client) {
        const adminRoom = socket.client.admin_id ? `admin-${socket.client.admin_id}` : 'admins';
        io.to(adminRoom).emit('client:typing', { client_id: socket.client.id });
      }
    });

    socket.on('admin:typing', ({ client_id }) => {
      if (socket.isAdmin) io.to(`client:${client_id}`).emit('admin:typing');
    });
  });
};
