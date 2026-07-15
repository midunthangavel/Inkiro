'use strict';

jest.mock('axios');
jest.mock('../../src/db', () => ({
  db: { from: jest.fn() },
}));
jest.mock('../../src/socket/index', () => ({
  emitToShop:   jest.fn(),
  emitToRunner: jest.fn(),
  emitToShops:  jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  warn:  jest.fn(),
  error: jest.fn(),
  info:  jest.fn(),
  debug: jest.fn(),
}));

const axios                                       = require('axios');
const { db }                                      = require('../../src/db');
const { emitToShop, emitToRunner, emitToShops }   = require('../../src/socket/index');
const { makeChain }                               = require('../helpers/supabaseMock');
const {
  sendPush,
  notifyShop,
  notifyShops,
  notifyShopsWithPush,
  notifyRunners,
  notifyCustomer,
}                                                 = require('../../src/services/notificationService');

const VALID_TOKEN   = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxxxx]';
const VALID_TOKEN_2 = 'ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyyyy]';

// ─── sendPush ─────────────────────────────────────────────────────────────────

describe('sendPush', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns [] when tokens array is empty or null', async () => {
    expect(await sendPush([],   'T', 'B')).toEqual([]);
    expect(await sendPush(null, 'T', 'B')).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('filters out non-Expo tokens and skips POST entirely if none remain', async () => {
    const result = await sendPush(['fcm:abc', 'random'], 'T', 'B');
    expect(result).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('accepts bare string tokens and forwards to Expo', async () => {
    axios.post.mockResolvedValueOnce({ data: { data: [{ status: 'ok' }] } });
    await sendPush([VALID_TOKEN], 'Title', 'Body', { k: 1 });
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [, payload] = axios.post.mock.calls[0];
    expect(payload.to).toEqual([VALID_TOKEN]);
    expect(payload.title).toBe('Title');
    expect(payload.body).toBe('Body');
    expect(payload.data).toEqual({ k: 1 });
  });

  test('accepts object tokens ({ token }) and extracts the string', async () => {
    axios.post.mockResolvedValueOnce({ data: { data: [{ status: 'ok' }, { status: 'ok' }] } });
    await sendPush([{ token: VALID_TOKEN }, { token: VALID_TOKEN_2 }], 'T', 'B');
    const [, payload] = axios.post.mock.calls[0];
    expect(payload.to).toEqual([VALID_TOKEN, VALID_TOKEN_2]);
  });

  test('swallows Expo API errors and returns []', async () => {
    axios.post.mockRejectedValueOnce(new Error('network timeout'));
    expect(await sendPush([VALID_TOKEN], 'T', 'B')).toEqual([]);
  });

  test('invalidates DeviceNotRegistered tokens by updating push_tokens', async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        data: [{
          status:  'error',
          message: 'Invalid push token',
          details: { error: 'DeviceNotRegistered' },
        }],
      },
    });
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));

    await sendPush([VALID_TOKEN], 'T', 'B');
    expect(db.from).toHaveBeenCalledWith('push_tokens');
  });

  test('does NOT invalidate on non-DeviceNotRegistered errors', async () => {
    axios.post.mockResolvedValueOnce({
      data: { data: [{ status: 'error', message: 'Rate limit', details: { error: 'MessageRateExceeded' } }] },
    });
    await sendPush([VALID_TOKEN], 'T', 'B');
    expect(db.from).not.toHaveBeenCalled();
  });
});

// ─── notifyShop ───────────────────────────────────────────────────────────────

describe('notifyShop', () => {
  beforeEach(() => jest.clearAllMocks());

  test('emits socket event and skips push when title/body omitted', async () => {
    await notifyShop('shop-1', 'order:new', { x: 1 });
    expect(emitToShop).toHaveBeenCalledWith('shop-1', 'order:new', { x: 1 });
    expect(db.from).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('fetches shop user_id, tokens, then sends push', async () => {
    db.from
      .mockReturnValueOnce(makeChain({ data: { user_id: 'user-1' }, error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ token: VALID_TOKEN }], error: null }));
    axios.post.mockResolvedValueOnce({ data: { data: [{ status: 'ok' }] } });

    await notifyShop('shop-1', 'order:new', {}, 'Title', 'Body');
    expect(emitToShop).toHaveBeenCalled();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('no push when shop lookup errors', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'DB down' } }));
    await notifyShop('shop-1', 'order:new', {}, 'T', 'B');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('no push when shop is not found', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    await notifyShop('shop-1', 'order:new', {}, 'T', 'B');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

// ─── notifyShops / notifyShopsWithPush ────────────────────────────────────────

describe('notifyShops', () => {
  beforeEach(() => jest.clearAllMocks());

  test('emits batched event, never touches DB', () => {
    notifyShops(['a', 'b'], 'order:new', {});
    expect(emitToShops).toHaveBeenCalledWith(['a', 'b'], 'order:new', {});
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('notifyShopsWithPush', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns early on empty shopIds without emitting', async () => {
    await notifyShopsWithPush([], 'order:new', {}, 'T', 'B');
    expect(emitToShops).not.toHaveBeenCalled();
  });

  test('emits once + 2 DB queries + 1 Expo POST regardless of shop count', async () => {
    db.from
      .mockReturnValueOnce(makeChain({ data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [{ token: VALID_TOKEN }, { token: VALID_TOKEN_2 }], error: null }));
    axios.post.mockResolvedValueOnce({ data: { data: [] } });

    await notifyShopsWithPush(['s1', 's2', 's3'], 'order:new', { y: 2 }, 'Title', 'Body');
    expect(emitToShops).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledTimes(2);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('skips push when title/body omitted (emits only)', async () => {
    await notifyShopsWithPush(['s1'], 'order:new', {});
    expect(emitToShops).toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('skips push when no tokens for resolved users', async () => {
    db.from
      .mockReturnValueOnce(makeChain({ data: [{ user_id: 'u1' }], error: null }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }));
    await notifyShopsWithPush(['s1'], 'order:new', {}, 'T', 'B');
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('skips push when shop lookup errors', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'DB down' } }));
    await notifyShopsWithPush(['s1'], 'order:new', {}, 'T', 'B');
    expect(axios.post).not.toHaveBeenCalled();
  });
});

// ─── notifyRunners ────────────────────────────────────────────────────────────

describe('notifyRunners', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns early on empty runners', async () => {
    await notifyRunners([], 'job:available', {});
    expect(emitToRunner).not.toHaveBeenCalled();
  });

  test('emits per runner, sends a single batched push', async () => {
    db.from.mockReturnValueOnce(makeChain({
      data:  [{ token: VALID_TOKEN }, { token: VALID_TOKEN_2 }],
      error: null,
    }));
    axios.post.mockResolvedValueOnce({ data: { data: [] } });

    await notifyRunners(
      [{ id: 'r1', user_id: 'u1' }, { id: 'r2', user_id: 'u2' }],
      'job:available',
      { n: 1 },
      'Job',
      'Nearby'
    );
    expect(emitToRunner).toHaveBeenCalledTimes(2);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('emits only when title/body omitted', async () => {
    await notifyRunners([{ id: 'r1', user_id: 'u1' }], 'job:available', {});
    expect(emitToRunner).toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });
});

// ─── notifyCustomer ───────────────────────────────────────────────────────────

describe('notifyCustomer', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    [null, 'T', 'B'],
    ['c1', null, 'B'],
    ['c1', 'T', null],
  ])('no-op when required arg missing (%p, %p, %p)', async (cid, title, body) => {
    await notifyCustomer(cid, title, body);
    expect(db.from).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('fetches tokens and dispatches push', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: [{ token: VALID_TOKEN }], error: null }));
    axios.post.mockResolvedValueOnce({ data: { data: [] } });
    await notifyCustomer('c1', 'Hi', 'There', { order_id: '123' });
    expect(axios.post).toHaveBeenCalled();
  });

  test('silent when customer has no active tokens', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: [], error: null }));
    await notifyCustomer('c1', 'Hi', 'There');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
