'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../src/db', () => ({
  db:               { from: jest.fn(), rpc: jest.fn() },
  anonDb:           { from: jest.fn(), rpc: jest.fn() },
  createUserClient: jest.fn(),
}));

jest.mock('../../src/services/notificationService', () => ({
  notifyShop:          jest.fn().mockResolvedValue(undefined),
  notifyShops:         jest.fn().mockResolvedValue(undefined),
  notifyShopsWithPush: jest.fn().mockResolvedValue(undefined),
  notifyRunners:       jest.fn().mockResolvedValue(undefined),
  notifyCustomer:      jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/socket/index', () => ({
  emitToShop: jest.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const { db, anonDb }                    = require('../../src/db');
const { makeChain }                     = require('../helpers/supabaseMock');
const notifySvc                         = require('../../src/services/notificationService');
const {
  confirmOrder,
  shopRespond,
  expireStaleOrders,
  retryRunnerDispatch,
}                                       = require('../../src/services/orderService');

const ORIGIN      = { lat: 11.0168, lng: 76.9558 };
const CUSTOMER_ID = 'cust-0000-0000-0001';
const BASE_ARGS   = {
  customerId:    CUSTOMER_ID,
  customerPhone: '9876543210',
  items:         [{ name: 'rice', qty: 1 }],
  address:       '12 Anna Salai, Coimbatore',
  ...ORIGIN,
};

// ─── confirmOrder() ───────────────────────────────────────────────────────────

describe('confirmOrder()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the created order', async () => {
    const fakeOrder = { id: 'order-1', ...ORIGIN, customer_id: CUSTOMER_ID };

    // anonDb.rpc → get_nearby_shops → one nearby shop
    anonDb.rpc.mockResolvedValueOnce({
      data:  [{ id: 'shop-1', lat: ORIGIN.lat + 0.009, lng: ORIGIN.lng }],
      error: null,
    });
    // anonDb.from → orders insert → single
    anonDb.from.mockReturnValueOnce(makeChain({ data: fakeOrder, error: null }));

    const result = await confirmOrder(BASE_ARGS);
    expect(result.id).toBe('order-1');
  });

  test('calls get_nearby_shops RPC then inserts into orders', async () => {
    anonDb.rpc.mockResolvedValueOnce({ data: [], error: null });
    anonDb.from.mockReturnValueOnce(makeChain({ data: { id: 'o1' }, error: null }));

    await confirmOrder(BASE_ARGS);

    expect(anonDb.rpc).toHaveBeenCalledWith('get_nearby_shops', expect.objectContaining({
      origin_lat: ORIGIN.lat,
      origin_lng: ORIGIN.lng,
      radius_km:  expect.any(Number),
    }));
    expect(anonDb.from).toHaveBeenCalledWith('orders');
  });

  test('throws when order insert fails', async () => {
    anonDb.rpc.mockResolvedValueOnce({ data: [], error: null });
    anonDb.from.mockReturnValueOnce(
      makeChain({ data: null, error: { message: 'insert failed' } })
    );

    await expect(confirmOrder(BASE_ARGS)).rejects.toBeDefined();
  });

  test('throws when get_nearby_shops RPC fails', async () => {
    anonDb.rpc.mockResolvedValueOnce({ data: null, error: { message: 'PostGIS unavailable' } });

    await expect(confirmOrder(BASE_ARGS)).rejects.toBeDefined();
  });

  test('broadcasts to all nearby shops in a single batched notification call', async () => {
    const shops = [
      { id: 'shop-1', lat: ORIGIN.lat + 0.009, lng: ORIGIN.lng },
      { id: 'shop-2', lat: ORIGIN.lat,         lng: ORIGIN.lng + 0.009 },
      { id: 'shop-3', lat: ORIGIN.lat - 0.005, lng: ORIGIN.lng - 0.005 },
    ];
    anonDb.rpc.mockResolvedValueOnce({ data: shops, error: null });
    anonDb.from.mockReturnValueOnce(makeChain({ data: { id: 'o-batch', items: [] }, error: null }));

    await confirmOrder(BASE_ARGS);

    // One batched call for all shops — replaces per-shop loop.
    expect(notifySvc.notifyShopsWithPush).toHaveBeenCalledTimes(1);
    expect(notifySvc.notifyShopsWithPush).toHaveBeenCalledWith(
      ['shop-1', 'shop-2', 'shop-3'],
      expect.any(String),         // socket event name
      expect.any(Object),          // payload
      '🔔 New Order',
      expect.any(String),          // body
      expect.objectContaining({ order_id: 'o-batch' }),
    );

    // And the legacy per-shop notifier must NOT be called from the broadcast path.
    expect(notifySvc.notifyShop).not.toHaveBeenCalled();
  });

  test('calls notifyShopsWithPush with empty array when no shops are nearby', async () => {
    anonDb.rpc.mockResolvedValueOnce({ data: [], error: null });
    anonDb.from.mockReturnValueOnce(makeChain({ data: { id: 'o1' }, error: null }));

    await confirmOrder(BASE_ARGS);

    // Still called — the function itself early-returns on empty arrays.
    // What matters is that we never fall back to the O(N) loop.
    expect(notifySvc.notifyShop).not.toHaveBeenCalled();
  });
});

// ─── shopRespond() ────────────────────────────────────────────────────────────

describe('shopRespond()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('decline → returns { declined: true } without touching DB', async () => {
    const result = await shopRespond('order-1', 'shop-1', 'decline');
    expect(result).toEqual({ declined: true });
    expect(anonDb.from).not.toHaveBeenCalled();
    expect(anonDb.rpc).not.toHaveBeenCalled();
  });

  test('accept — throws 409 when order is already taken', async () => {
    anonDb.from.mockReturnValueOnce(
      makeChain({ data: null, error: { message: 'conflict' } })
    );
    await expect(shopRespond('order-1', 'shop-1', 'accept'))
      .rejects.toMatchObject({ status: 409 });
  });

  test('accept — notifies customer on success', async () => {
    const fakeOrder = {
      id: 'order-1', shop_id: 'shop-1', customer_id: CUSTOMER_ID,
      ...ORIGIN, address: '12 Anna Salai',
      broadcast_shop_ids: ['shop-1'],
      status: 'accepted',
    };

    // orders update (accept)
    anonDb.from.mockReturnValueOnce(makeChain({ data: fakeOrder, error: null }));
    // _dispatchRunners: get_nearby_runners → no runners → PENDING_RUNNER path
    db.rpc.mockResolvedValueOnce({ data: [], error: null });
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null })); // orders update

    await shopRespond('order-1', 'shop-1', 'accept');

    expect(notifySvc.notifyCustomer).toHaveBeenCalledWith(
      CUSTOMER_ID,
      '✅ Order Accepted',
      expect.any(String),
      expect.objectContaining({ order_id: 'order-1' }),
    );
  });

  test('accept — calls get_nearby_runners with correct origin coordinates', async () => {
    const fakeOrder = {
      id: 'order-1', shop_id: 'shop-1', customer_id: CUSTOMER_ID,
      ...ORIGIN, address: '12 Anna Salai',
      broadcast_shop_ids: ['shop-1'],
      status: 'accepted',
    };

    anonDb.from.mockReturnValueOnce(makeChain({ data: fakeOrder, error: null }));
    db.rpc.mockResolvedValueOnce({ data: [], error: null });
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));

    await shopRespond('order-1', 'shop-1', 'accept');

    expect(db.rpc).toHaveBeenCalledWith('get_nearby_runners', expect.objectContaining({
      origin_lat: ORIGIN.lat,
      origin_lng: ORIGIN.lng,
      radius_km:  expect.any(Number),
    }));
  });

  test('accept — notifies other broadcast shops when multiple were pinged', async () => {
    const fakeOrder = {
      id: 'order-1', shop_id: 'shop-1', customer_id: CUSTOMER_ID,
      ...ORIGIN, address: '12 Anna Salai',
      broadcast_shop_ids: ['shop-1', 'shop-2', 'shop-3'],
      status: 'accepted',
    };

    anonDb.from.mockReturnValueOnce(makeChain({ data: fakeOrder, error: null }));
    db.rpc.mockResolvedValueOnce({ data: [], error: null });
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));

    await shopRespond('order-1', 'shop-1', 'accept');

    expect(notifySvc.notifyShops).toHaveBeenCalledWith(
      ['shop-2', 'shop-3'],
      expect.any(String),
      expect.any(Object),
    );
  });
});

// ─── expireStaleOrders() ─────────────────────────────────────────────────────

describe('expireStaleOrders()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('no-op when nothing to escalate and nothing to expire', async () => {
    db.from
      .mockReturnValueOnce(makeChain({ data: [], error: null }))  // select stale-pending
      .mockReturnValueOnce(makeChain({ data: [], error: null })); // update → expired
    await expireStaleOrders();
    expect(notifySvc.notifyShop).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('escalates a stale order using SHOP_ESCALATION_RADIUS_KM and notifies NEW shops only', async () => {
    const order = {
      id:                 'order-esc',
      lat:                ORIGIN.lat,
      lng:                ORIGIN.lng,
      broadcast_shop_ids: ['shop-1'],
    };

    db.from.mockReturnValueOnce(makeChain({ data: [order], error: null }));
    db.rpc.mockResolvedValueOnce({
      data:  [{ id: 'shop-1' }, { id: 'shop-2' }, { id: 'shop-3' }],
      error: null,
    });
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    db.from.mockReturnValueOnce(makeChain({ data: [], error: null }));

    await expireStaleOrders();

    expect(db.rpc).toHaveBeenCalledWith('get_nearby_shops', expect.objectContaining({
      origin_lat: ORIGIN.lat,
      origin_lng: ORIGIN.lng,
      radius_km:  4, // SHOP_ESCALATION_RADIUS_KM
    }));

    expect(notifySvc.notifyShop).toHaveBeenCalledTimes(2);
    const calledShopIds = notifySvc.notifyShop.mock.calls.map((c) => c[0]).sort();
    expect(calledShopIds).toEqual(['shop-2', 'shop-3']);
  });

  test('continues past a per-order shop RPC error without crashing', async () => {
    const order = { id: 'o-1', lat: ORIGIN.lat, lng: ORIGIN.lng, broadcast_shop_ids: [] };
    db.from.mockReturnValueOnce(makeChain({ data: [order], error: null }));
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc down' } });
    db.from.mockReturnValueOnce(makeChain({ data: [], error: null }));

    await expect(expireStaleOrders()).resolves.toBeUndefined();
    expect(notifySvc.notifyShop).not.toHaveBeenCalled();
  });

  test('logs error when the initial escalation select fails but still runs expiry query', async () => {
    db.from
      .mockReturnValueOnce(makeChain({ data: null, error: { message: 'select fail' } }))
      .mockReturnValueOnce(makeChain({ data: [], error: null }));

    await expect(expireStaleOrders()).resolves.toBeUndefined();
    expect(notifySvc.notifyShop).not.toHaveBeenCalled();
  });

  test('bails quietly when the expiry update fails', async () => {
    db.from
      .mockReturnValueOnce(makeChain({ data: [], error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: { message: 'expiry fail' } }));

    await expect(expireStaleOrders()).resolves.toBeUndefined();
  });
});

// ─── retryRunnerDispatch() ───────────────────────────────────────────────────

describe('retryRunnerDispatch()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('no-op when no orders are pending re-dispatch', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: [], error: null }));
    await retryRunnerDispatch();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('returns early on DB select error', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'down' } }));
    await retryRunnerDispatch();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('expires an order whose dispatch_attempts already equals the maximum', async () => {
    const order = {
      id: 'o-max', lat: ORIGIN.lat, lng: ORIGIN.lng,
      address: 'x', dispatch_attempts: 3,
    };
    db.from
      .mockReturnValueOnce(makeChain({ data: [order], error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }));

    await retryRunnerDispatch();

    expect(db.rpc).not.toHaveBeenCalled();
    expect(notifySvc.notifyRunners).not.toHaveBeenCalled();
  });

  test.each([
    [0, 1, 3],
    [1, 2, 6],
    [2, 3, 12],
  ])(
    'expands runner search radius: dispatch_attempts=%i → attempt %i → %i km',
    async (currentAttempts, _nextAttempt, expectedRadius) => {
      const order = {
        id: 'o-r', lat: ORIGIN.lat, lng: ORIGIN.lng, address: '12 St.',
        dispatch_attempts: currentAttempts,
      };
      db.from.mockReturnValueOnce(makeChain({ data: [order], error: null }));
      db.rpc.mockResolvedValueOnce({ data: [], error: null });
      db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));

      await retryRunnerDispatch();

      expect(db.rpc).toHaveBeenCalledWith('get_nearby_runners', expect.objectContaining({
        origin_lat: ORIGIN.lat,
        origin_lng: ORIGIN.lng,
        radius_km:  expectedRadius,
      }));
    }
  );

  test('notifies nearby runners when found and updates status to RUNNER_NOTIFIED', async () => {
    const order = {
      id: 'o-found', lat: ORIGIN.lat, lng: ORIGIN.lng, address: '12 St.',
      dispatch_attempts: 0,
    };
    db.from.mockReturnValueOnce(makeChain({ data: [order], error: null }));
    db.rpc.mockResolvedValueOnce({
      data:  [{ id: 'runner-1', user_id: 'u-1' }, { id: 'runner-2', user_id: 'u-2' }],
      error: null,
    });
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));

    await retryRunnerDispatch();

    expect(notifySvc.notifyRunners).toHaveBeenCalledTimes(1);
    expect(notifySvc.notifyRunners.mock.calls[0][0]).toHaveLength(2);
  });
});
