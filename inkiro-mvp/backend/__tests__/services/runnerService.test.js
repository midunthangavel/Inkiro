'use strict';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../src/db', () => ({
  db:     { from: jest.fn(), rpc: jest.fn() },
  anonDb: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('../../src/services/notificationService', () => ({
  notifyShop:     jest.fn().mockResolvedValue(undefined),
  notifyCustomer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/socket/index', () => ({
  emitToShop: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const { db, anonDb }  = require('../../src/db');
const { makeChain }   = require('../helpers/supabaseMock');
const notifySvc       = require('../../src/services/notificationService');
const { emitToShop }  = require('../../src/socket/index');
const {
  acceptJob,
  updateStatus,
  updateLocation,
  updateProfile,
  getRunnerById,
  getRunnerByUserId,
  getActiveOrder,
  getEarnings,
}                     = require('../../src/services/runnerService');

const RUNNER_ID = 'runner-1';
const ORDER_ID  = 'order-1';

// ─── acceptJob — race guards ──────────────────────────────────────────────────

describe('acceptJob — race guards', () => {
  beforeEach(() => jest.clearAllMocks());

  test('23505 unique violation → 409 "You already have an active order"', async () => {
    anonDb.from.mockReturnValueOnce(
      makeChain({
        data:  null,
        error: { code: '23505', message: 'uniq_runner_active_order violation' },
      })
    );
    await expect(acceptJob(RUNNER_ID, ORDER_ID))
      .rejects.toMatchObject({ status: 409, message: 'You already have an active order' });
  });

  test('row-level conflict (order already taken) → 409 "Job is no longer available"', async () => {
    anonDb.from.mockReturnValueOnce(
      makeChain({ data: null, error: { message: 'No rows', code: 'PGRST116' } })
    );
    await expect(acceptJob(RUNNER_ID, ORDER_ID))
      .rejects.toMatchObject({ status: 409, message: 'Job is no longer available' });
  });

  test('successful accept → flips runner availability and notifies shop + customer', async () => {
    const fakeOrder = {
      id: ORDER_ID, runner_id: RUNNER_ID, status: 'runner_assigned',
      shop_id: 'shop-1', customer_id: 'cust-1',
    };
    anonDb.from
      .mockReturnValueOnce(makeChain({ data: fakeOrder, error: null })) // orders update
      .mockReturnValueOnce(makeChain({ data: null,      error: null })); // runners is_available=false

    const result = await acceptJob(RUNNER_ID, ORDER_ID);
    expect(result).toEqual(fakeOrder);
    expect(notifySvc.notifyShop).toHaveBeenCalledTimes(1);
    expect(notifySvc.notifyCustomer).toHaveBeenCalledTimes(1);
  });
});

// ─── updateStatus ─────────────────────────────────────────────────────────────

describe('updateStatus', () => {
  beforeEach(() => jest.clearAllMocks());

  test('404 when order does not exist', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'not found' } }));
    await expect(updateStatus(RUNNER_ID, ORDER_ID, 'picked_up'))
      .rejects.toMatchObject({ status: 404, message: 'Order not found' });
  });

  test('403 when runner is not the assigned runner', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({
      data: { id: ORDER_ID, status: 'runner_assigned', runner_id: 'somebody-else', shop_id: 'shop-1', customer_id: 'cust-1', runner_earning_paise: 3000 },
      error: null,
    }));
    await expect(updateStatus(RUNNER_ID, ORDER_ID, 'picked_up'))
      .rejects.toMatchObject({ status: 403, message: 'Not your order' });
  });

  test('422 when transition is invalid (e.g. pending → delivered)', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({
      data: { id: ORDER_ID, status: 'pending', runner_id: RUNNER_ID, shop_id: 'shop-1', customer_id: 'cust-1', runner_earning_paise: 3000 },
      error: null,
    }));
    await expect(updateStatus(RUNNER_ID, ORDER_ID, 'delivered'))
      .rejects.toMatchObject({ status: 422 });
  });

  test('picked_up — updates status, stamps picked_up_at, and emits to shop', async () => {
    const baseOrder = {
      id: ORDER_ID, status: 'runner_assigned', runner_id: RUNNER_ID,
      shop_id: 'shop-1', customer_id: 'cust-1', runner_earning_paise: 3000,
    };
    anonDb.from
      .mockReturnValueOnce(makeChain({ data: baseOrder, error: null }))
      .mockReturnValueOnce(makeChain({ data: { ...baseOrder, status: 'picked_up' }, error: null }));

    const result = await updateStatus(RUNNER_ID, ORDER_ID, 'picked_up');
    expect(result.status).toBe('picked_up');
    expect(emitToShop).toHaveBeenCalledWith('shop-1', 'order:picked_up', { order_id: ORDER_ID });
    // Delivered-only branches must NOT fire on picked_up:
    expect(notifySvc.notifyCustomer).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled(); // settlement writes use `db`, not `anonDb`
  });

  test('delivered — flips runner availability, accumulates earnings, inserts settlement, notifies both', async () => {
    const baseOrder = {
      id: ORDER_ID, status: 'picked_up', runner_id: RUNNER_ID,
      shop_id: 'shop-1', customer_id: 'cust-1', runner_earning_paise: 3000,
    };

    anonDb.from
      .mockReturnValueOnce(makeChain({ data: baseOrder, error: null })) // select initial order
      .mockReturnValueOnce(makeChain({ data: { ...baseOrder, status: 'delivered' }, error: null })) // update order
      .mockReturnValueOnce(makeChain({ data: null, error: null }))   // runners is_available=true
      .mockReturnValueOnce(makeChain({ data: { total_earnings: 12000 }, error: null })) // fetch total
      .mockReturnValueOnce(makeChain({ data: null, error: null }));  // update total_earnings

    // Settlement INSERT uses the service-role `db` client
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));

    const result = await updateStatus(RUNNER_ID, ORDER_ID, 'delivered');
    expect(result.status).toBe('delivered');

    expect(db.from).toHaveBeenCalledWith('runner_settlements');
    expect(notifySvc.notifyShop).toHaveBeenCalledTimes(1);
    expect(notifySvc.notifyCustomer).toHaveBeenCalledTimes(1);
  });

  test('delivered path — handles null total_earnings (new runner)', async () => {
    const baseOrder = {
      id: ORDER_ID, status: 'picked_up', runner_id: RUNNER_ID,
      shop_id: 'shop-1', customer_id: 'cust-1', runner_earning_paise: 3000,
    };
    anonDb.from
      .mockReturnValueOnce(makeChain({ data: baseOrder, error: null }))
      .mockReturnValueOnce(makeChain({ data: { ...baseOrder, status: 'delivered' }, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null })) // no existing earnings row
      .mockReturnValueOnce(makeChain({ data: null, error: null }));
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));

    await expect(updateStatus(RUNNER_ID, ORDER_ID, 'delivered')).resolves.toBeDefined();
  });

  test('throws when update-to-new-status fails', async () => {
    const baseOrder = {
      id: ORDER_ID, status: 'runner_assigned', runner_id: RUNNER_ID,
      shop_id: 'shop-1', customer_id: 'cust-1', runner_earning_paise: 3000,
    };
    anonDb.from
      .mockReturnValueOnce(makeChain({ data: baseOrder, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: { message: 'update fail' } }));

    await expect(updateStatus(RUNNER_ID, ORDER_ID, 'picked_up')).rejects.toBeTruthy();
  });
});

// ─── updateLocation ───────────────────────────────────────────────────────────

describe('updateLocation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('success — writes lat/lng/availability/last_seen_at', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    await expect(updateLocation(RUNNER_ID, 11.0, 76.9, true)).resolves.toBeUndefined();
    expect(anonDb.from).toHaveBeenCalledWith('runners');
  });

  test('throws on DB error', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'down' } }));
    await expect(updateLocation(RUNNER_ID, 11.0, 76.9, true)).rejects.toBeTruthy();
  });
});

// ─── updateProfile ────────────────────────────────────────────────────────────

describe('updateProfile', () => {
  beforeEach(() => jest.clearAllMocks());

  test('422 when vehicle_type is invalid', async () => {
    await expect(updateProfile(RUNNER_ID, { vehicleType: 'rocket' }))
      .rejects.toMatchObject({ status: 422 });
    expect(anonDb.from).not.toHaveBeenCalled();
  });

  test('no-op when patch is empty (no fields provided)', async () => {
    await expect(updateProfile(RUNNER_ID, {})).resolves.toBeUndefined();
    expect(anonDb.from).not.toHaveBeenCalled();
  });

  test('partial update — only upiId', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    await expect(updateProfile(RUNNER_ID, { upiId: 'x@upi' })).resolves.toBeUndefined();
    expect(anonDb.from).toHaveBeenCalledWith('runners');
  });

  test('throws on DB error', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'down' } }));
    await expect(updateProfile(RUNNER_ID, { upiId: 'x@upi' })).rejects.toBeTruthy();
  });
});

// ─── getRunnerById ────────────────────────────────────────────────────────────

describe('getRunnerById', () => {
  beforeEach(() => jest.clearAllMocks());

  test('404 when not found', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'not found' } }));
    await expect(getRunnerById(RUNNER_ID)).rejects.toMatchObject({ status: 404 });
  });

  test('returns the runner row on success', async () => {
    const runner = { id: RUNNER_ID, user_id: 'u-1' };
    anonDb.from.mockReturnValueOnce(makeChain({ data: runner, error: null }));
    await expect(getRunnerById(RUNNER_ID)).resolves.toEqual(runner);
  });
});

// ─── getRunnerByUserId ────────────────────────────────────────────────────────

describe('getRunnerByUserId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws on DB error', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'down' } }));
    await expect(getRunnerByUserId('u-1')).rejects.toBeTruthy();
  });

  test('404 when runner profile not found', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    await expect(getRunnerByUserId('u-1')).rejects.toMatchObject({ status: 404 });
  });

  test('returns the runner row on success', async () => {
    const runner = { id: RUNNER_ID, user_id: 'u-1' };
    anonDb.from.mockReturnValueOnce(makeChain({ data: runner, error: null }));
    await expect(getRunnerByUserId('u-1')).resolves.toEqual(runner);
  });
});

// ─── getActiveOrder ───────────────────────────────────────────────────────────

describe('getActiveOrder', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws on DB error', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'down' } }));
    await expect(getActiveOrder(RUNNER_ID)).rejects.toBeTruthy();
  });

  test('returns null when no active order', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    await expect(getActiveOrder(RUNNER_ID)).resolves.toBeNull();
  });

  test('returns order row when one is active', async () => {
    const order = { id: ORDER_ID, status: 'runner_assigned' };
    anonDb.from.mockReturnValueOnce(makeChain({ data: order, error: null }));
    await expect(getActiveOrder(RUNNER_ID)).resolves.toEqual(order);
  });
});

// ─── getEarnings ──────────────────────────────────────────────────────────────

describe('getEarnings', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws when the runner lookup errors', async () => {
    anonDb.from
      .mockReturnValueOnce(makeChain({ data: null, error: { message: 'down' } })) // runners
      .mockReturnValueOnce(makeChain({ data: [],   error: null }))                 // today rows
      .mockReturnValueOnce(makeChain({ count: 0,   error: null }));                // all-time count
    await expect(getEarnings(RUNNER_ID)).rejects.toBeTruthy();
  });

  test('aggregates today + all-time + total_earnings', async () => {
    anonDb.from
      .mockReturnValueOnce(makeChain({ data: { total_earnings: 15000 }, error: null })) // runners
      .mockReturnValueOnce(makeChain({
        data: [
          { runner_earning_paise: 3000 },
          { runner_earning_paise: 3000 },
        ],
        error: null,
      }))                                                                               // today rows
      .mockReturnValueOnce(makeChain({ count: 12, error: null }));                      // all-time count

    const res = await getEarnings(RUNNER_ID);
    expect(res).toEqual({
      today_total:     6000,
      total_earnings:  15000,
      today_orders:    2,
      all_time_orders: 12,
    });
  });

  test('defaults cleanly when runner has no earnings row yet', async () => {
    anonDb.from
      .mockReturnValueOnce(makeChain({ data: null, error: null }))  // no row, no error
      .mockReturnValueOnce(makeChain({ data: [],   error: null }))
      .mockReturnValueOnce(makeChain({ count: 0,   error: null }));

    const res = await getEarnings(RUNNER_ID);
    expect(res).toEqual({
      today_total:     0,
      total_earnings:  0,
      today_orders:    0,
      all_time_orders: 0,
    });
  });
});
