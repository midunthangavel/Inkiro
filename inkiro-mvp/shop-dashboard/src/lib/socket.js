import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || 'http://localhost:3000';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(URL, {
      transports: ['websocket'],
      autoConnect: false,
      auth: (cb) => cb({ token: sessionStorage.getItem('inkiro_shop_token') }),
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
