'use strict';

const { Server }    = require('socket.io');
const jwt           = require('jsonwebtoken');
const logger        = require('../utils/logger');
const errorReporter = require('../utils/errorReporter');
const { anonDb }    = require('../db');

let io = null;

/**
 * Initialises Socket.IO on the given HTTP server.
 * Must be called once in index.js before the server starts listening.
 *
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
function init(httpServer) {
  const rawOrigins  = process.env.CORS_ORIGINS || '*';
  const corsOrigins = rawOrigins === '*' ? '*' : rawOrigins.split(',').map((s) => s.trim());

  io = new Server(httpServer, {
    cors: { origin: corsOrigins, methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  });

  // ── JWT authentication middleware ────────────────────────────────────────────
  // Runs before every connection is accepted. Verifies the access token,
  // resolves the room ID from the DB (so the client cannot self-assign a room),
  // and rejects blocked actors before they ever see live events.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.type !== 'access') return next(new Error('Invalid token type'));

      let roomId = null;

      if (payload.role === 'customer') {
        roomId = payload.userId;
      } else if (payload.role === 'shop') {
        const { data } = await anonDb
          .from('shops').select('id, is_blocked').eq('user_id', payload.userId).maybeSingle();
        if (!data || data.is_blocked) return next(new Error('Forbidden'));
        roomId = data.id;
      } else if (payload.role === 'runner') {
        const { data } = await anonDb
          .from('runners').select('id, is_blocked').eq('user_id', payload.userId).maybeSingle();
        if (!data || data.is_blocked) return next(new Error('Forbidden'));
        roomId = data.id;
      } else {
        return next(new Error('Forbidden'));
      }

      socket.data = { role: payload.role, id: roomId, userId: payload.userId };
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // Handshake-level failures (bad origin, unsupported transport, malformed
  // auth). These fire BEFORE 'connection', so we can't attach them per-socket.
  io.engine.on('connection_error', (err) => {
    logger.warn(
      { err: { message: err.message, code: err.code, context: err.context } },
      'Socket.IO connection_error'
    );
    errorReporter.captureException(err, { source: 'socket.io/engine' });
  });

  io.on('connection', (socket) => {
    const { role, id } = socket.data;

    socket.join(`${role}:${id}`);
    logger.debug({ socket_id: socket.id, role, id }, 'Socket connected and joined room');

    // Transport-level errors after successful handshake.
    socket.on('error', (err) => {
      logger.warn({ socket_id: socket.id, role, id, err }, 'Socket error');
      errorReporter.captureException(err, { source: 'socket.io/socket', role, id });
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ socket_id: socket.id, role, id, reason }, 'Socket disconnected');
    });
  });

  logger.info('Socket.IO initialised');
  return io;
}

/**
 * Returns the active Socket.IO server instance.
 * Throws if init() has not been called yet.
 */
function getIO() {
  if (!io) throw new Error('Socket.IO has not been initialised. Call init(httpServer) first.');
  return io;
}

/**
 * Emits an event to a single shop room.
 * @param {string} shopId
 * @param {string} event  - Use a constant from socket/events.js
 * @param {object} data
 */
function emitToShop(shopId, event, data) {
  if (!io) return;
  io.to(`shop:${shopId}`).emit(event, data);
}

/**
 * Emits an event to a single runner room.
 * @param {string} runnerId
 * @param {string} event
 * @param {object} data
 */
function emitToRunner(runnerId, event, data) {
  if (!io) return;
  io.to(`runner:${runnerId}`).emit(event, data);
}

/**
 * Emits an event to multiple shop rooms simultaneously.
 * Used for broadcasting a new order to all nearby shops at once.
 *
 * @param {string[]} shopIds
 * @param {string}   event
 * @param {object}   data
 */
function emitToShops(shopIds, event, data) {
  if (!io || !Array.isArray(shopIds) || shopIds.length === 0) return;
  shopIds.forEach((shopId) => {
    io.to(`shop:${shopId}`).emit(event, data);
  });
}

/**
 * Emits an event to a single customer room.
 * @param {string} customerId - the customer's user_id
 * @param {string} event
 * @param {object} data
 */
function emitToCustomer(customerId, event, data) {
  if (!io) return;
  io.to(`customer:${customerId}`).emit(event, data);
}

module.exports = { init, getIO, emitToShop, emitToRunner, emitToShops, emitToCustomer };
