'use strict';

const request = require('supertest');
const express = require('express');
const jwt     = require('jsonwebtoken');

// ─── Mocks (declared before requiring the module under test) ──────────────────

jest.mock('../../src/db', () => ({
  db:     { from: jest.fn() },
  anonDb: { from: jest.fn() },
}));

jest.mock('../../src/services/runnerService', () => ({
  acceptJob:         jest.fn(),
  updateStatus:      jest.fn(),
  updateLocation:    jest.fn(),
  updateProfile:     jest.fn(),
  getRunnerById:     jest.fn(),
  getRunnerByUserId: jest.fn(),
  getActiveOrder:    jest.fn(),
  getEarnings:       jest.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const { anonDb }    = require('../../src/db');
const runnerService = require('../../src/services/runnerService');
const { makeChain } = require('../helpers/supabaseMock');
const runnersRouter = require('../../src/routes/runners');

const JWT_SECRET = process.env.JWT_SECRET;
const UUID_A     = '11111111-1111-4111-8111-111111111111'; // runner A user id
const UUID_A_RUN = '22222222-2222-4222-8222-222222222222'; // runner A runner id
const UUID_B_RUN = '33333333-3333-4333-8333-333333333333'; // a different runner's id
const ORDER_ID   = '44444444-4444-4444-8444-444444444444';

// ─── App Builder ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    next();
  });
  app.use('/runners', runnersRouter);
  return app;
}

function signRunner(userId = UUID_A) {
  return jwt.sign(
    { sub: userId, userId, role: 'runner', phone: '9000000001' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function signCustomer(userId = UUID_A) {
  return jwt.sign(
    { sub: userId, userId, role: 'customer', phone: '9000000001' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/** Arranges the requireRunnerProfile middleware's Supabase lookup result. */
function arrangeRunnerLookup(result) {
  anonDb.from.mockReturnValueOnce(makeChain(result));
}

// ─── requireAuth gate ─────────────────────────────────────────────────────────

describe('runner routes — authentication', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('401 — no Authorization header', async () => {
    const res = await request(app).post('/runners/accept-job').send({ order_id: ORDER_ID });
    expect(res.status).toBe(401);
  });

  test('403 — customer JWT cannot hit runner routes', async () => {
    const res = await request(app)
      .post('/runners/accept-job')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ order_id: ORDER_ID });
    expect(res.status).toBe(403);
  });
});

// ─── requireRunnerProfile gate ────────────────────────────────────────────────

describe('runner routes — runner profile resolution', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('404 — authenticated user has no runner profile', async () => {
    arrangeRunnerLookup({ data: null, error: null });
    const res = await request(app)
      .post('/runners/accept-job')
      .set('Authorization', `Bearer ${signRunner()}`)
      .send({ order_id: ORDER_ID });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Runner profile not found');
  });

  test('500 — DB error while resolving runner profile', async () => {
    arrangeRunnerLookup({ data: null, error: { message: 'DB down' } });
    const res = await request(app)
      .post('/runners/accept-job')
      .set('Authorization', `Bearer ${signRunner()}`)
      .send({ order_id: ORDER_ID });
    expect(res.status).toBe(500);
  });
});

// ─── IDOR resistance — the whole point of this chunk ──────────────────────────

describe('runner routes — IDOR resistance', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('accept-job ignores any runner_id sent in body, uses JWT owner', async () => {
    arrangeRunnerLookup({ data: { id: UUID_A_RUN, user_id: UUID_A }, error: null });
    runnerService.acceptJob.mockResolvedValueOnce({ id: ORDER_ID, status: 'runner_assigned' });

    const res = await request(app)
      .post('/runners/accept-job')
      .set('Authorization', `Bearer ${signRunner()}`)
      // Attacker tries to operate as a different runner — must be ignored.
      .send({ order_id: ORDER_ID, runner_id: UUID_B_RUN });

    expect(res.status).toBe(200);
    // Service was called with the JWT-derived runner id, not the body's.
    expect(runnerService.acceptJob).toHaveBeenCalledWith(UUID_A_RUN, ORDER_ID);
  });

  test('update-status uses JWT-derived runner id', async () => {
    arrangeRunnerLookup({ data: { id: UUID_A_RUN, user_id: UUID_A }, error: null });
    runnerService.updateStatus.mockResolvedValueOnce({ id: ORDER_ID, status: 'picked_up' });

    const res = await request(app)
      .post('/runners/update-status')
      .set('Authorization', `Bearer ${signRunner()}`)
      .send({ order_id: ORDER_ID, status: 'picked_up', runner_id: UUID_B_RUN });

    expect(res.status).toBe(200);
    expect(runnerService.updateStatus).toHaveBeenCalledWith(UUID_A_RUN, ORDER_ID, 'picked_up');
  });

  test('update-location uses JWT-derived runner id', async () => {
    arrangeRunnerLookup({ data: { id: UUID_A_RUN, user_id: UUID_A }, error: null });
    runnerService.updateLocation.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post('/runners/update-location')
      .set('Authorization', `Bearer ${signRunner()}`)
      .send({ lat: 11.0168, lng: 76.9558, is_available: true, runner_id: UUID_B_RUN });

    expect(res.status).toBe(200);
    expect(runnerService.updateLocation).toHaveBeenCalledWith(UUID_A_RUN, 11.0168, 76.9558, true);
  });

  test('update-profile uses JWT-derived runner id', async () => {
    arrangeRunnerLookup({ data: { id: UUID_A_RUN, user_id: UUID_A }, error: null });
    runnerService.updateProfile.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post('/runners/update-profile')
      .set('Authorization', `Bearer ${signRunner()}`)
      .send({ vehicle_type: 'bike', upi_id: 'alice@okicici', runner_id: UUID_B_RUN });

    expect(res.status).toBe(200);
    expect(runnerService.updateProfile).toHaveBeenCalledWith(UUID_A_RUN, {
      vehicleType: 'bike',
      upiId:       'alice@okicici',
    });
  });
});

// ─── GET ownership guards ─────────────────────────────────────────────────────

describe('runner routes — GET ownership guards', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('GET /:runnerId/earnings — 403 when caller is not owner', async () => {
    arrangeRunnerLookup({ data: { id: UUID_A_RUN, user_id: UUID_A }, error: null });

    const res = await request(app)
      .get(`/runners/${UUID_B_RUN}/earnings`)
      .set('Authorization', `Bearer ${signRunner()}`);

    expect(res.status).toBe(403);
    expect(runnerService.getEarnings).not.toHaveBeenCalled();
  });

  test('GET /:runnerId/earnings — 200 for owner', async () => {
    arrangeRunnerLookup({ data: { id: UUID_A_RUN, user_id: UUID_A }, error: null });
    runnerService.getEarnings.mockResolvedValueOnce({
      today_total: 0, total_earnings: 0, today_orders: 0, all_time_orders: 0,
    });

    const res = await request(app)
      .get(`/runners/${UUID_A_RUN}/earnings`)
      .set('Authorization', `Bearer ${signRunner()}`);

    expect(res.status).toBe(200);
    expect(runnerService.getEarnings).toHaveBeenCalledWith(UUID_A_RUN);
  });

  test('GET /:runnerId/active-order — 403 when caller is not owner', async () => {
    arrangeRunnerLookup({ data: { id: UUID_A_RUN, user_id: UUID_A }, error: null });

    const res = await request(app)
      .get(`/runners/${UUID_B_RUN}/active-order`)
      .set('Authorization', `Bearer ${signRunner()}`);

    expect(res.status).toBe(403);
    expect(runnerService.getActiveOrder).not.toHaveBeenCalled();
  });

  test('GET /by-user/:userId — 403 for different user', async () => {
    const OTHER_USER = '55555555-5555-4555-8555-555555555555';
    const res = await request(app)
      .get(`/runners/by-user/${OTHER_USER}`)
      .set('Authorization', `Bearer ${signRunner()}`);

    expect(res.status).toBe(403);
    expect(runnerService.getRunnerByUserId).not.toHaveBeenCalled();
  });

  test('GET /by-user/:userId — 200 for self', async () => {
    runnerService.getRunnerByUserId.mockResolvedValueOnce({ id: UUID_A_RUN, user_id: UUID_A });

    const res = await request(app)
      .get(`/runners/by-user/${UUID_A}`)
      .set('Authorization', `Bearer ${signRunner()}`);

    expect(res.status).toBe(200);
    expect(runnerService.getRunnerByUserId).toHaveBeenCalledWith(UUID_A);
  });
});

// ─── Validation regressions ───────────────────────────────────────────────────

describe('runner routes — validation', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('accept-job — 400 when order_id missing', async () => {
    arrangeRunnerLookup({ data: { id: UUID_A_RUN, user_id: UUID_A }, error: null });
    const res = await request(app)
      .post('/runners/accept-job')
      .set('Authorization', `Bearer ${signRunner()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('update-status — 400 on invalid status enum', async () => {
    arrangeRunnerLookup({ data: { id: UUID_A_RUN, user_id: UUID_A }, error: null });
    const res = await request(app)
      .post('/runners/update-status')
      .set('Authorization', `Bearer ${signRunner()}`)
      .send({ order_id: ORDER_ID, status: 'teleported' });
    expect(res.status).toBe(400);
  });
});
