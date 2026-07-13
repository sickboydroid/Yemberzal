import { io } from 'socket.io-client';
import { getAuth } from './api';

/** Singleton Socket.IO connection, authenticated with the JWT. */
let socket = null;

export function getSocket() {
  const auth = getAuth();
  if (!auth?.token) return null;
  if (!socket) {
    socket = io('/', { auth: { token: auth.token }, transports: ['websocket', 'polling'] });
  }
  return socket;
}

export function resetSocket() {
  socket?.close();
  socket = null;
}
