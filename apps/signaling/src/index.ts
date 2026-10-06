// ConnectPro V2 — Signaling Server
// Fastify + Socket.IO
// Handles: device registration, 9-digit IDs, connection requests, WebRTC relay

import 'dotenv/config';
import Fastify from 'fastify';
import { createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface Device {
  socketId: string;
  deviceId: string;    // 9-digit: "483291734"
  displayId: string;   // Formatted: "483 291 734"
  name: string;
  os: 'windows' | 'macos' | 'linux' | 'browser';
  version: string;
  connectedAt: number;
  inSession: boolean;
}

interface PendingRequest {
  requestId: string;
  fromSocketId: string;
  toSocketId: string;
  fromDevice: Device;
  toDevice: Device;
  mode: string;
  createdAt: number;
}

interface ActiveSession {
  sessionId: string;
  hostSocketId: string;
  controllerSocketId: string;
  startedAt: number;
}

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

const devices = new Map<string, Device>();          // socketId → Device
const idIndex = new Map<string, string>();           // deviceId (9-digit) → socketId
const pendingRequests = new Map<string, PendingRequest>(); // requestId → PendingRequest
const activeSessions = new Map<string, ActiveSession>();   // sessionId → ActiveSession

// ─────────────────────────────────────────────
// Fastify + HTTP server
// ─────────────────────────────────────────────

const fastify = Fastify({ logger: { level: 'info' } });
const httpServer = createServer(fastify.server);

// Health check
fastify.get('/health', async () => ({
  status: 'ok',
  onlineDevices: devices.size,
  activeSessions: activeSessions.size,
  pendingRequests: pendingRequests.size,
  uptime: process.uptime(),
  time: Date.now(),
}));

// ─────────────────────────────────────────────
// Socket.IO Server
// ─────────────────────────────────────────────

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e8, // 100MB for file transfer
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Generate a unique 9-digit ID not already in use */
function generateDeviceId(): string {
  let id: string;
  let attempts = 0;
  do {
    // Range: 100_000_000 → 999_999_999
    id = String(Math.floor(100_000_000 + Math.random() * 900_000_000));
    attempts++;
    if (attempts > 1000) break; // Safety
  } while (idIndex.has(id));
  return id;
}

/** Format 9-digit ID as "XXX XXX XXX" */
function formatId(id: string): string {
  return `${id.slice(0, 3)} ${id.slice(3, 6)} ${id.slice(6, 9)}`;
}

/** Strip spaces from ID */
function stripId(id: string): string {
  return id.replace(/\s+/g, '');
}

/** Auto-cleanup pending requests older than 60s */
function cleanupPendingRequests() {
  const now = Date.now();
  for (const [reqId, req] of pendingRequests.entries()) {
    if (now - req.createdAt > 60_000) {
      pendingRequests.delete(reqId);
      // Notify controller that request expired
      io.to(req.fromSocketId).emit('connection-error', {
        code: 'REQUEST_EXPIRED',
        message: 'La demande de connexion a expiré.',
      });
    }
  }
}

setInterval(cleanupPendingRequests, 10_000);

// ─────────────────────────────────────────────
// Socket.IO Event Handlers
// ─────────────────────────────────────────────

io.on('connection', (socket: Socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── 1. Register Device ──────────────────────
  socket.on('register-device', (data: any) => {
    const { deviceId: existingId, name = 'Unknown Device', os = 'browser', version = '2.0.0' } = data || {};

    // If client sends a previous deviceId, try to reuse it
    const rawId = existingId ? stripId(existingId) : null;
    let assignedId: string;

    if (rawId && rawId.length === 9 && /^\d{9}$/.test(rawId) && !idIndex.has(rawId)) {
      assignedId = rawId;
    } else {
      assignedId = generateDeviceId();
    }

    const device: Device = {
      socketId: socket.id,
      deviceId: assignedId,
      displayId: formatId(assignedId),
      name,
      os,
      version,
      connectedAt: Date.now(),
      inSession: false,
    };

    devices.set(socket.id, device);
    idIndex.set(assignedId, socket.id);

    socket.emit('registered', {
      deviceId: assignedId,
      displayId: device.displayId,
      name: device.name,
    });

    console.log(`[Register] ${name} → ID: ${device.displayId} (${socket.id})`);
  });

  // ── 2. Request Connection by 9-digit ID ─────
  socket.on('request-connection', ({ targetId, password, mode = 'full_control' }: any) => {
    const cleanId = stripId(targetId || '');

    if (!/^\d{9}$/.test(cleanId)) {
      socket.emit('connection-error', {
        code: 'INVALID_ID',
        message: 'ID invalide. Format attendu: 9 chiffres.',
      });
      return;
    }

    const targetSocketId = idIndex.get(cleanId);
    if (!targetSocketId) {
      socket.emit('connection-error', {
        code: 'DEVICE_NOT_FOUND',
        message: `L'appareil ${formatId(cleanId)} n'est pas en ligne.`,
      });
      return;
    }

    const targetDevice = devices.get(targetSocketId);
    const callerDevice = devices.get(socket.id);

    if (!targetDevice || !callerDevice) {
      socket.emit('connection-error', {
        code: 'DEVICE_OFFLINE',
        message: 'L\'appareil distant est hors ligne.',
      });
      return;
    }

    if (callerDevice.deviceId === targetDevice.deviceId) {
      socket.emit('connection-error', {
        code: 'SELF_CONNECT',
        message: 'Impossible de vous connecter à votre propre appareil.',
      });
      return;
    }

    if (targetDevice.inSession) {
      socket.emit('connection-error', {
        code: 'DEVICE_BUSY',
        message: `${targetDevice.name} est déjà en session.`,
      });
      return;
    }

    const requestId = `req_${uuidv4().replace(/-/g, '').slice(0, 12)}`;

    pendingRequests.set(requestId, {
      requestId,
      fromSocketId: socket.id,
      toSocketId: targetSocketId,
      fromDevice: callerDevice,
      toDevice: targetDevice,
      mode,
      createdAt: Date.now(),
    });

    // Notify host of incoming request
    io.to(targetSocketId).emit('incoming-connection-request', {
      requestId,
      fromDeviceId: callerDevice.displayId,
      fromDeviceName: callerDevice.name,
      fromDeviceOs: callerDevice.os,
      mode,
      timestamp: Date.now(),
    });

    // Tell controller to wait
    socket.emit('connection-request-pending', {
      requestId,
      targetName: targetDevice.name,
      targetId: targetDevice.displayId,
    });

    console.log(`[Request] ${callerDevice.name} → ${targetDevice.name} (${requestId})`);
  });

  // ── 3. Host responds (accept/reject) ────────
  socket.on('respond-connection-request', (data: any) => {
    const { requestId, accept, reason } = data || {};
    const req = pendingRequests.get(requestId);

    if (!req) {
      socket.emit('error', { message: 'Demande introuvable ou expirée.' });
      return;
    }

    pendingRequests.delete(requestId);

    if (!accept) {
      io.to(req.fromSocketId).emit('connection-rejected', {
        reason: reason || 'Connexion refusée par l\'hôte.',
      });
      console.log(`[Reject] ${req.fromDevice.name} → ${req.toDevice.name}`);
      return;
    }

    // Start session
    const sessionId = `sess_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
    const permissions = data.permissions || {
      allowControl: true,
      allowFileTransfer: true,
      allowClipboard: true,
    };

    const session: ActiveSession = {
      sessionId,
      hostSocketId: req.toSocketId,
      controllerSocketId: req.fromSocketId,
      startedAt: Date.now(),
    };

    activeSessions.set(sessionId, session);

    // Mark devices as in-session
    const hostDev = devices.get(req.toSocketId);
    const ctrlDev = devices.get(req.fromSocketId);
    if (hostDev) hostDev.inSession = true;
    if (ctrlDev) ctrlDev.inSession = true;

    // Notify controller
    io.to(req.fromSocketId).emit('session-started', {
      sessionId,
      isHost: false,
      partnerDeviceId: req.toDevice.deviceId,
      partnerDisplayId: req.toDevice.displayId,
      partnerName: req.toDevice.name,
      partnerOs: req.toDevice.os,
      mode: req.mode,
      permissions,
      startTime: Date.now(),
    });

    // Notify host
    io.to(req.toSocketId).emit('session-started', {
      sessionId,
      isHost: true,
      partnerDeviceId: req.fromDevice.deviceId,
      partnerDisplayId: req.fromDevice.displayId,
      partnerName: req.fromDevice.name,
      partnerOs: req.fromDevice.os,
      mode: req.mode,
      permissions,
      startTime: Date.now(),
    });

    console.log(`[Session] ${req.fromDevice.name} ↔ ${req.toDevice.name} | ${sessionId}`);
  });

  // ── 4. WebRTC Signaling relay ────────────────
  // Route offer/answer/ice-candidate to the partner
  socket.on('webrtc-signal', (payload: any) => {
    const { targetDeviceId, sessionId } = payload;

    // Find partner by deviceId within the session
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const partnerSocketId =
      session.hostSocketId === socket.id
        ? session.controllerSocketId
        : session.hostSocketId;

    io.to(partnerSocketId).emit('webrtc-signal', payload);
  });

  // ── 5. Data relay fallback ────────────────────
  // Used if WebRTC P2P fails (symmetric NAT, corporate firewall)
  socket.on('relay-data', (payload: any) => {
    const { sessionId, data } = payload;
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const partnerSocketId =
      session.hostSocketId === socket.id
        ? session.controllerSocketId
        : session.hostSocketId;

    io.to(partnerSocketId).emit('relay-data', { data });
  });

  // ── 6. End session ────────────────────────────
  socket.on('end-session', ({ sessionId }: any) => {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    activeSessions.delete(sessionId);

    // Free devices
    const host = devices.get(session.hostSocketId);
    const ctrl = devices.get(session.controllerSocketId);
    if (host) host.inSession = false;
    if (ctrl) ctrl.inSession = false;

    // Notify both sides
    io.to(session.hostSocketId).emit('session-ended', { sessionId });
    io.to(session.controllerSocketId).emit('session-ended', { sessionId });

    console.log(`[End] Session ${sessionId} terminated`);
  });

  // ── 7. Clipboard sync ─────────────────────────
  socket.on('clipboard-sync', (payload: any) => {
    const { sessionId, content } = payload;
    const session = activeSessions.get(sessionId);
    if (!session) return;

    const partnerSocketId =
      session.hostSocketId === socket.id
        ? session.controllerSocketId
        : session.hostSocketId;

    io.to(partnerSocketId).emit('clipboard-sync', { content });
  });

  // ── 8. Disconnect cleanup ─────────────────────
  socket.on('disconnect', () => {
    const device = devices.get(socket.id);
    if (!device) return;

    // End any active session
    for (const [sId, session] of activeSessions.entries()) {
      if (session.hostSocketId === socket.id || session.controllerSocketId === socket.id) {
        const partnerSocketId =
          session.hostSocketId === socket.id
            ? session.controllerSocketId
            : session.hostSocketId;

        io.to(partnerSocketId).emit('session-ended', {
          sessionId: sId,
          reason: 'partner_disconnected',
        });

        // Free partner device
        const partner = devices.get(partnerSocketId);
        if (partner) partner.inSession = false;

        activeSessions.delete(sId);
        console.log(`[Disconnect] Session ${sId} ended (${device.name} disconnected)`);
      }
    }

    // Cancel any pending requests
    for (const [reqId, req] of pendingRequests.entries()) {
      if (req.fromSocketId === socket.id || req.toSocketId === socket.id) {
        const otherSocketId =
          req.fromSocketId === socket.id ? req.toSocketId : req.fromSocketId;
        io.to(otherSocketId).emit('connection-error', {
          code: 'PEER_DISCONNECTED',
          message: 'L\'appareil s\'est déconnecté.',
        });
        pendingRequests.delete(reqId);
      }
    }

    idIndex.delete(device.deviceId);
    devices.delete(socket.id);
    console.log(`[-] Disconnected: ${device.name} (${device.displayId})`);
  });
});

// ─────────────────────────────────────────────
// Keep-alive (Render/Railway free tier)
// ─────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const selfUrl = process.env.RAILWAY_STATIC_URL
    || process.env.RENDER_EXTERNAL_URL
    || 'http://localhost:3001';

  setInterval(async () => {
    try {
      await fetch(`${selfUrl}/health`);
    } catch { /* silent */ }
  }, 9 * 60 * 1000);
}

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────

const PORT = Number(process.env.PORT || 3001);

await fastify.ready();
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[ConnectPro Signaling] Running on http://0.0.0.0:${PORT}`);
  console.log(`[ConnectPro Signaling] Environment: ${process.env.NODE_ENV || 'development'}`);
});
