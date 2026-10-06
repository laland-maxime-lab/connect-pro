// signaling.ts — Socket.IO client wrapper
import { io, Socket } from 'socket.io-client';

const SIGNALING_URL =
  process.env.NEXT_PUBLIC_SIGNALING_URL || 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SIGNALING_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
