import { io }          from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';

const base = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api/v1')
  .replace('/api/v1', '');

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(base, {
      transports: ['websocket'],
      autoConnect: false,
      auth: (cb) => {
        SecureStore.getItemAsync('inkiro_shop_token')
          .then((token) => cb({ token }))
          .catch(() => cb({}));
      },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      timeout: 10000,
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
