'use strict';

// adminAuth throws at module-load if ADMIN_API_KEY is unset.
// Set it BEFORE the router is required so the mount succeeds.
process.env.ADMIN_API_KEY = 'test-admin-key-abc123';

const request = require('supertest');
const express = require('express');

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../src/db', () => ({
  db: { from: jest.fn() },
}));

jest.mock('../../src/services/orderService', () => ({
  adminAssignRunner: jest.fn(),
}));

jest.mock('../../src/services/shopService', () => ({
  listShops: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

// ─── Imports (after env + mocks) ──────────────────────────────────────────────

const { db }        = require('../../src/db');
const orderService  = require('../../src/services/orderService');
const shopService   = require('../../src/services/shopService');
const { makeChain } = require('../helpers/supabaseMock');
const adminRouter   = require('../../src/routes/admin');

const ADMIN_KEY = 'test-admin-key-abc123';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    next();
  });
  app.use('/admin', adminRouter);
  return app;
}

// ─── Admin-key gate ──────────────────────────────────────────────────────────

describe('admin routes — admin key gate', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('401 — missing X-Admin-Key on GET /admin/dashboard', async () => {
    const res = await request(app).get('/admin/dashboard');
    expect(res.status).toBe(401);
  });

  test('401 — wrong X-Admin-Key', async () => {
    const res = await request(app)
      .get('/admin/dashboard')
      .set('X-Admin-Key', 'wrong-key-xxxxxxxxxxx');
    expect(res.status).toBe(401);
  });

  test('401 — also guards POST /admin/assign-runner', async () => {
    const res = await request(app)
      .post('/admin/assign-runner')
      .send({
        order_id:  '44444444-4444-4444-8444-444444444444',
        runner_id: '55555555-5555-4555-8555-555555555555',
      });
    expect(res.status).toBe(401);
    expect(orderService.adminAssignRunner).not.toHaveBeenCalled();
  });
});

// ─── GET /admin/dashboard ────────────────────────────────────────────────────

describe('GET /admin/dashboard', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('200 — aggregates metrics from 6 parallel queries', async () => {
    // Order of calls inside the route:
    //   1. orders today (count)
    //   2. orders delivered today (fee rows)
    //   3. runners active (count)
    //   4. shops active (count)
    //   5. orders pending (count)
    //   6. orders expired today (count)
    db.from
      .mockReturnValueOnce(makeChain({ count: 12, error: null }))
      .mockReturnValueOnce(makeChain({
        data: [
          { platform_fee_paise: 500, delivery_fee_paise: 1500 },
          { platform_fee_paise: 500, delivery_fee_paise: 1500 },
        ],
        error: null,
      }))
      .mockReturnValueOnce(makeChain({ count: 5, error: null }))
      .mockReturnValueOnce(makeChain({ count: 8, error: null }))
      .mockReturnValueOnce(makeChain({ count: 2, error: null }))
      .mockReturnValueOnce(makeChain({ count: 1, error: null }));

    const res = await request(app)
      .get('/admin/dashboard')
      .set('X-Admin-Key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      today_orders:   12,
      today_revenue:  4000,  // 2 * (500 + 1500)
      active_runners: 5,
      active_shops:   8,
      pending_orders: 2,
      failed_orders:  1,
    });
  });

  test('200 — defaults to zero when counts are null', async () => {
    db.from
      .mockReturnValueOnce(makeChain({ count: null, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
      .mockReturnValueOnce(makeChain({ count: null, error: null }))
      .mockReturnValueOnce(makeChain({ count: null, error: null }))
      .mockReturnValueOnce(makeChain({ count: null, error: null }))
      .mockReturnValueOnce(makeChain({ count: null, error: null }));

    const res = await request(app)
      .get('/admin/dashboard')
      .set('X-Admin-Key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.today_orders).toBe(0);
    expect(res.body.today_revenue).toBe(0);
  });
});

// ─── POST /admin/assign-runner ───────────────────────────────────────────────

describe('POST /admin/assign-runner', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  const VALID = {
    order_id:  '44444444-4444-4444-8444-444444444444',
    runner_id: '55555555-5555-4555-8555-555555555555',
  };

  test('400 — missing order_id', async () => {
    const res = await request(app)
      .post('/admin/assign-runner')
      .set('X-Admin-Key', ADMIN_KEY)
      .send({ runner_id: VALID.runner_id });
    expect(res.status).toBe(400);
  });

  test('400 — missing runner_id', async () => {
    const res = await request(app)
      .post('/admin/assign-runner')
      .set('X-Admin-Key', ADMIN_KEY)
      .send({ order_id: VALID.order_id });
    expect(res.status).toBe(400);
  });

  test('400 — invalid UUID', async () => {
    const res = await request(app)
      .post('/admin/assign-runner')
      .set('X-Admin-Key', ADMIN_KEY)
      .send({ order_id: 'not-a-uuid', runner_id: VALID.runner_id });
    expect(res.status).toBe(400);
  });

  test('200 — service assigns the runner', async () => {
    orderService.adminAssignRunner.mockResolvedValueOnce({
      id:        VALID.order_id,
      runner_id: VALID.runner_id,
    });
    const res = await request(app)
      .post('/admin/assign-runner')
      .set('X-Admin-Key', ADMIN_KEY)
      .send(VALID);

    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(VALID.order_id);
    expect(orderService.adminAssignRunner).toHaveBeenCalledWith(VALID.order_id, VALID.runner_id);
  });
});

// ─── GET /admin/orders ───────────────────────────────────────────────────────

describe('GET /admin/orders', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('200 — no status filter returns all orders', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: [{ id: 'o1' }, { id: 'o2' }], error: null }));
    const res = await request(app)
      .get('/admin/orders')
      .set('X-Admin-Key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(2);
  });

  test('200 — with ?status= applies an .eq filter', async () => {
    const chain = makeChain({ data: [{ id: 'o1', status: 'pending' }], error: null });
    db.from.mockReturnValueOnce(chain);
    const res = await request(app)
      .get('/admin/orders?status=pending')
      .set('X-Admin-Key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith('status', 'pending');
  });

  test('500 — DB error propagates as 500', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'DB down' } }));
    const res = await request(app)
      .get('/admin/orders')
      .set('X-Admin-Key', ADMIN_KEY);
    expect(res.status).toBe(500);
  });
});

// ─── GET /admin/shops ────────────────────────────────────────────────────────

describe('GET /admin/shops', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('200 — delegates to shopService.listShops', async () => {
    shopService.listShops.mockResolvedValueOnce([{ id: 's1' }]);
    const res = await request(app)
      .get('/admin/shops')
      .set('X-Admin-Key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.shops).toEqual([{ id: 's1' }]);
  });
});

// ─── GET /admin/runners ──────────────────────────────────────────────────────

describe('GET /admin/runners', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('200 — returns runners list', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: [{ id: 'r1' }], error: null }));
    const res = await request(app)
      .get('/admin/runners')
      .set('X-Admin-Key', ADMIN_KEY);
    expect(res.status).toBe(200);
    expect(res.body.runners).toEqual([{ id: 'r1' }]);
  });

  test('500 — DB error', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'DB down' } }));
    const res = await request(app)
      .get('/admin/runners')
      .set('X-Admin-Key', ADMIN_KEY);
    expect(res.status).toBe(500);
  });
});
