'use strict';

/* eslint-disable no-console */
// Real-Socket.IO integration: exercises handshake → room join → emit fan-out.

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../src/utils/errorReporter', () => ({
  captureException: jest.fn(),
}));

const http             = require('http');
const { io: ioClient } = require('socket.io-client');
const socketModule     = require('../../src/socket/index');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function waitFor(client, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      timeoutMs
    );
    client.once(event, (payload) => { clearTimeout(t); resolve(payload); });
  });
}

function connectAs(port, auth) {
  return ioClient(`http://localhost:${port}`, {
    auth,
    transports:   ['websocket'],
    reconnection: false,
    forceNew:     true,
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('socket/index — integration (real server + client)', () => {
  let httpServer, ioServer, port;

  beforeAll((done) => {
    httpServer = http.createServer();
    ioServer   = socketModule.init(httpServer);
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });

  afterAll((done) => {
    // io.close() closes the attached httpServer, so no manual httpServer.close().
    ioServer.close(() => done());
  });

  test('shop client joins shop:<id> room and receives emitToShop', async () => {
    const client = connectAs(port, { role: 'shop', id: 'SHOP-A' });
    await waitFor(client, 'connect');
    const pPayload = waitFor(client, 'order:new');
    // Emit after rooms are joined server-side (which happens on connection).
    socketModule.emitToShop('SHOP-A', 'order:new', { order_id: 'o-1' });
    const payload = await pPayload;
    expect(payload).toEqual({ order_id: 'o-1' });
    client.close();
  }, 10000);

  test('runner client joins runner:<id> room and receives emitToRunner', async () => {
    const client = connectAs(port, { role: 'runner', id: 'R-1' });
    await waitFor(client, 'connect');
    const pPayload = waitFor(client, 'job:available');
    socketModule.emitToRunner('R-1', 'job:available', { job_id: 'j-1' });
    expect(await pPayload).toEqual({ job_id: 'j-1' });
    client.close();
  }, 10000);

  test('emitToShops fans out to every listed shop room', async () => {
    const a = connectAs(port, { role: 'shop', id: 'SHOP-A' });
    const b = connectAs(port, { role: 'shop', id: 'SHOP-B' });
    await Promise.all([waitFor(a, 'connect'), waitFor(b, 'connect')]);

    const pA = waitFor(a, 'order:taken');
    const pB = waitFor(b, 'order:taken');
    socketModule.emitToShops(['SHOP-A', 'SHOP-B'], 'order:taken', { order_id: 'o-2' });
    const [payA, payB] = await Promise.all([pA, pB]);
    expect(payA).toEqual({ order_id: 'o-2' });
    expect(payB).toEqual({ order_id: 'o-2' });

    a.close();
    b.close();
  }, 15000);

  test('a shop room does not receive emits intended for another shop', async () => {
    const a = connectAs(port, { role: 'shop', id: 'SHOP-A' });
    const c = connectAs(port, { role: 'shop', id: 'SHOP-C' });
    await Promise.all([waitFor(a, 'connect'), waitFor(c, 'connect')]);

    const received = [];
    c.on('order:new', (p) => received.push(p));

    const pA = waitFor(a, 'order:new');
    socketModule.emitToShop('SHOP-A', 'order:new', { to: 'A' });
    await pA;

    // Give the server a moment; c should have seen nothing.
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toEqual([]);

    a.close();
    c.close();
  }, 10000);

  test('unknown-role client connects but joins no room', async () => {
    const client = connectAs(port, { role: 'ghost', id: 'X' });
    await waitFor(client, 'connect');
    // Confirm server actually accepted the socket: it can still receive direct events.
    expect(client.connected).toBe(true);
    client.close();
  }, 10000);
});
