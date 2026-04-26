const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling']
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Serve controller page with session id injected
app.get('/controller', (req, res) => {
  res.sendFile(path.join(__dirname, 'controller.html'));
});

// Session management
const sessions = new Map(); // sessionId -> { hostSocketId, controllerSocketId }

io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // Host registers itself with a unique session ID
  socket.on('host-register', (sessionId) => {
    sessions.set(sessionId, { hostId: socket.id, controllerId: null });
    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.role = 'host';
    console.log(`[HOST] Session ${sessionId} registered`);
  });

  // Controller (phone) joins a session
  socket.on('controller-join', (sessionId) => {
    const session = sessions.get(sessionId);
    if (session) {
      session.controllerId = socket.id;
      socket.join(sessionId);
      socket.sessionId = sessionId;
      socket.role = 'controller';
      console.log(`[CTRL] Controller joined session ${sessionId}`);
      // Notify host that controller connected
      socket.to(sessionId).emit('controller-connected');
      socket.emit('join-ack', { success: true });
    } else {
      socket.emit('join-ack', { success: false, error: 'Session not found' });
    }
  });

  // Controller sends joystick / button input → relay to host
  socket.on('control-input', (data) => {
    if (socket.sessionId) {
      socket.to(socket.sessionId).emit('control-input', data);
    }
  });

  // Host sends telemetry back to controller (optional: HUD data)
  socket.on('telemetry', (data) => {
    if (socket.sessionId) {
      socket.to(socket.sessionId).emit('telemetry', data);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] Client disconnected: ${socket.id}`);
    if (socket.sessionId) {
      socket.to(socket.sessionId).emit('peer-disconnected', { role: socket.role });
      const session = sessions.get(socket.sessionId);
      if (session && session.hostId === socket.id) {
        sessions.delete(socket.sessionId);
      }
    }
  });
});

// Get LAN IP for QR code
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
const LAN_IP = getLanIp();

// Expose LAN IP to client
app.get('/api/server-info', (req, res) => {
  res.json({ lanIp: LAN_IP, port: PORT });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚁 ═══════════════════════════════════════');
  console.log('   Drone Simulator Server');
  console.log('═══════════════════════════════════════');
  console.log(`   Local:    http://localhost:${PORT}`);
  console.log(`   Network:  http://${LAN_IP}:${PORT}`);
  console.log('═══════════════════════════════════════');
  console.log('   Open the Local URL in your browser.');
  console.log('   Scan the QR code with your phone.');
  console.log('═══════════════════════════════════════\n');
});
