'use strict';

const request = require('supertest');
const express = require('express');
const jwt     = require('jsonwebtoken');

// ─── Mocks (before requires) ─────────────────────────────────────────────────

jest.mock('../../src/db', () => ({
  db:     { from: jest.fn() },
  anonDb: { from: jest.fn() },
}));

jest.mock('../../src/services/orderService', () => ({
  confirmOrder:         jest.fn(),
  shopRespond:          jest.fn(),
  listOrdersByCustomer: jest.fn(),
  getOrderById:         jest.fn(),
  markReady:            jest.fn(),
  rateOrder:            jest.fn(),
  adminAssignRunner:    jest.fn(),
}));

jest.mock('../../src/voiceParser', () => ({
  parseVoiceOrder: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

const { anonDb }    = require('../../src/db');
const orderService  = require('../../src/services/orderService');
const voiceParser   = require('../../src/voiceParser');
const { makeChain } = require('../helpers/supabaseMock');
const ordersRouter  = require('../../src/routes/orders');

const JWT_SECRET = process.env.JWT_SECRET;
const CUST_UID   = '11111111-1111-4111-8111-111111111111';
const SHOP_UID   = '22222222-2222-4222-8222-222222222222';
const SHOP_ID    = '33333333-3333-4333-8333-333333333333';
const ORDER_ID   = '44444444-4444-4444-8444-444444444444';
const RUNNER_ID  = '55555555-5555-4555-8555-555555555555';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    next();
  });
  app.use('/orders', ordersRouter);
  return app;
}

function signCustomer(userId = CUST_UID, phone = '9000000001') {
  return jwt.sign({ sub: userId, userId, role: 'customer', phone }, JWT_SECRET, { expiresIn: '1h' });
}
function signShop() {
  return jwt.sign({ sub: SHOP_UID, userId: SHOP_UID, role: 'shop', phone: '9000000002' }, JWT_SECRET, { expiresIn: '1h' });
}

// ─── POST /orders/parse-voice ────────────────────────────────────────────────

describe('POST /orders/parse-voice', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('401 — no Authorization header', async () => {
    const res = await request(app).post('/orders/parse-voice').send({});
    expect(res.status).toBe(401);
  });

  test('403 — shop role rejected', async () => {
    const res = await request(app)
      .post('/orders/parse-voice')
      .set('Authorization', `Bearer ${signShop()}`)
      .send({ audio_base64: 'abc' });
    expect(res.status).toBe(403);
  });

  test('400 — missing audio_base64', async () => {
    const res = await request(app)
      .post('/orders/parse-voice')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('400 — invalid language enum', async () => {
    const res = await request(app)
      .post('/orders/parse-voice')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ audio_base64: 'abc', language: 'fr-FR' });
    expect(res.status).toBe(400);
  });

  test('200 — returns parsed result from voiceParser', async () => {
    voiceParser.parseVoiceOrder.mockResolvedValueOnce({
      items:        [{ name: 'Milk', quantity: 1, estimated_price_rupees: 30 }],
      raw_text:     '1 milk',
      subtotal:     3000,
      platform_fee: 500,
      delivery_fee: 1500,
      total:        5000,
    });

    const res = await request(app)
      .post('/orders/parse-voice')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ audio_base64: 'base64-audio', language: 'en-IN' });

    expect(res.status).toBe(200);
    expect(res.body.items[0].name).toBe('Milk');
    expect(res.body.total).toBe(5000);
    expect(voiceParser.parseVoiceOrder).toHaveBeenCalledWith('base64-audio', 'en-IN');
  });

  test('400 — voice parser throws', async () => {
    voiceParser.parseVoiceOrder.mockRejectedValueOnce(new Error('Unrecognized audio'));
    const res = await request(app)
      .post('/orders/parse-voice')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ audio_base64: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Unrecognized audio');
  });
});

// ─── POST /orders/confirm ────────────────────────────────────────────────────

describe('POST /orders/confirm', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  const VALID = {
    items:   [{ name: 'Milk', quantity: 1, estimated_price_rupees: 30 }],
    address: '12 Coimbatore St',
    lat:     11.0168,
    lng:     76.9558,
  };

  test('400 — missing items', async () => {
    const res = await request(app)
      .post('/orders/confirm')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ ...VALID, items: undefined });
    expect(res.status).toBe(400);
  });

  test('400 — empty items array', async () => {
    const res = await request(app)
      .post('/orders/confirm')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ ...VALID, items: [] });
    expect(res.status).toBe(400);
  });

  test('400 — address too short', async () => {
    const res = await request(app)
      .post('/orders/confirm')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ ...VALID, address: 'a' });
    expect(res.status).toBe(400);
  });

  test('400 — invalid lat > 90', async () => {
    const res = await request(app)
      .post('/orders/confirm')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ ...VALID, lat: 200 });
    expect(res.status).toBe(400);
  });

  test('400 — invalid lng < -180', async () => {
    const res = await request(app)
      .post('/orders/confirm')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ ...VALID, lng: -500 });
    expect(res.status).toBe(400);
  });

  test('201 — order created; customerId/phone sourced from JWT', async () => {
    orderService.confirmOrder.mockResolvedValueOnce({ id: ORDER_ID });
    const res = await request(app)
      .post('/orders/confirm')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send(VALID);

    expect(res.status).toBe(201);
    expect(res.body.order_id).toBe(ORDER_ID);
    expect(res.body.status).toBe('broadcasting');
    expect(res.body.estimated_delivery_minutes).toBe(25);
    expect(orderService.confirmOrder).toHaveBeenCalledWith(expect.objectContaining({
      customerId:    CUST_UID,
      customerPhone: '9000000001',
      items:         VALID.items,
      address:       VALID.address,
      lat:           VALID.lat,
      lng:           VALID.lng,
    }));
  });

  test('403 — shop JWT rejected', async () => {
    const res = await request(app)
      .post('/orders/confirm')
      .set('Authorization', `Bearer ${signShop()}`)
      .send(VALID);
    expect(res.status).toBe(403);
  });
});

// ─── GET /orders/customer/phone/:phone ───────────────────────────────────────

describe('GET /orders/customer/phone/:phone', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('403 — phone param does not match JWT phone (prevents cross-customer read)', async () => {
    const res = await request(app)
      .get('/orders/customer/phone/9999999999')
      .set('Authorization', `Bearer ${signCustomer()}`);
    expect(res.status).toBe(403);
    expect(orderService.listOrdersByCustomer).not.toHaveBeenCalled();
  });

  test('200 — returns caller own orders', async () => {
    orderService.listOrdersByCustomer.mockResolvedValueOnce([
      { id: ORDER_ID, status: 'delivered' },
    ]);
    const res = await request(app)
      .get('/orders/customer/phone/9000000001')
      .set('Authorization', `Bearer ${signCustomer()}`);
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    expect(orderService.listOrdersByCustomer).toHaveBeenCalledWith(CUST_UID);
  });

  test('403 — shop JWT cannot call customer history route', async () => {
    const res = await request(app)
      .get('/orders/customer/phone/9000000001')
      .set('Authorization', `Bearer ${signShop()}`);
    expect(res.status).toBe(403);
  });
});

// ─── GET /orders/:id/status ──────────────────────────────────────────────────

describe('GET /orders/:id/status', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  const BASE = {
    id:                 ORDER_ID,
    status:             'accepted',
    items:              [{ name: 'Milk', quantity: 2, estimated_price_rupees: 30 }],
    shop_id:            SHOP_ID,
    runner_id:          null,
    platform_fee_paise: 500,
    delivery_fee_paise: 1500,
    created_at:         '2026-04-01T00:00:00Z',
    accepted_at:        '2026-04-01T00:02:00Z',
  };

  test('200 — shop present, no runner', async () => {
    orderService.getOrderById.mockResolvedValueOnce(BASE);
    anonDb.from.mockReturnValueOnce(makeChain({ data: { shop_name: 'KrishnaStore' }, error: null }));

    const res = await request(app)
      .get(`/orders/${ORDER_ID}/status`)
      .set('Authorization', `Bearer ${signCustomer()}`);

    expect(res.status).toBe(200);
    expect(res.body.shop_name).toBe('KrishnaStore');
    expect(res.body.runner_name).toBeNull();
    // subtotal: 2 * 30 * 100 = 6000 paise; total = 6000 + 500 + 1500 = 8000
    expect(res.body.total).toBe(8000);
  });

  test('200 — resolves runner_name via runners → users two-hop', async () => {
    orderService.getOrderById.mockResolvedValueOnce({ ...BASE, runner_id: RUNNER_ID });
    anonDb.from
      .mockReturnValueOnce(makeChain({ data: { shop_name: 'KrishnaStore' },     error: null })) // shops
      .mockReturnValueOnce(makeChain({ data: { user_id: 'runner-user-id' },      error: null })) // runners
      .mockReturnValueOnce(makeChain({ data: { name: 'Arjun' },                  error: null })); // users

    const res = await request(app)
      .get(`/orders/${ORDER_ID}/status`)
      .set('Authorization', `Bearer ${signCustomer()}`);

    expect(res.status).toBe(200);
    expect(res.body.runner_name).toBe('Arjun');
  });

  test('200 — missing shop_id and runner_id → both names null', async () => {
    orderService.getOrderById.mockResolvedValueOnce({ ...BASE, shop_id: null, runner_id: null });
    const res = await request(app)
      .get(`/orders/${ORDER_ID}/status`)
      .set('Authorization', `Bearer ${signCustomer()}`);
    expect(res.status).toBe(200);
    expect(res.body.shop_name).toBeNull();
    expect(res.body.runner_name).toBeNull();
  });
});

// ─── GET /orders/:id ─────────────────────────────────────────────────────────

describe('GET /orders/:id', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('200 — any authenticated role can fetch an order', async () => {
    orderService.getOrderById.mockResolvedValueOnce({ id: ORDER_ID, status: 'pending' });
    const res = await request(app)
      .get(`/orders/${ORDER_ID}`)
      .set('Authorization', `Bearer ${signCustomer()}`);
    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(ORDER_ID);
  });

  test('401 — unauthenticated', async () => {
    const res = await request(app).get(`/orders/${ORDER_ID}`);
    expect(res.status).toBe(401);
  });
});

// ─── POST /orders/:id/rate ───────────────────────────────────────────────────

describe('POST /orders/:id/rate', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('400 — rating out of range (6)', async () => {
    const res = await request(app)
      .post(`/orders/${ORDER_ID}/rate`)
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ rating: 6 });
    expect(res.status).toBe(400);
  });

  test('400 — rating missing', async () => {
    const res = await request(app)
      .post(`/orders/${ORDER_ID}/rate`)
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('200 — valid rating is forwarded to service', async () => {
    orderService.rateOrder.mockResolvedValueOnce(undefined);
    const res = await request(app)
      .post(`/orders/${ORDER_ID}/rate`)
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ rating: 5, comment: 'Fast!' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(orderService.rateOrder).toHaveBeenCalledWith(ORDER_ID, CUST_UID, 5, 'Fast!');
  });

  test('403 — shop JWT rejected', async () => {
    const res = await request(app)
      .post(`/orders/${ORDER_ID}/rate`)
      .set('Authorization', `Bearer ${signShop()}`)
      .send({ rating: 5 });
    expect(res.status).toBe(403);
  });
});

// ─── POST /orders/:id/mark-ready ─────────────────────────────────────────────

describe('POST /orders/:id/mark-ready', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('403 — customer JWT rejected', async () => {
    const res = await request(app)
      .post(`/orders/${ORDER_ID}/mark-ready`)
      .set('Authorization', `Bearer ${signCustomer()}`);
    expect(res.status).toBe(403);
  });

  test('404 — authenticated shop user has no shop profile', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    const res = await request(app)
      .post(`/orders/${ORDER_ID}/mark-ready`)
      .set('Authorization', `Bearer ${signShop()}`);
    expect(res.status).toBe(404);
  });

  test('200 — shop owner marks order ready', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({
      data:  { id: SHOP_ID, user_id: SHOP_UID, is_active: true },
      error: null,
    }));
    orderService.markReady.mockResolvedValueOnce({ id: ORDER_ID, status: 'ready' });

    const res = await request(app)
      .post(`/orders/${ORDER_ID}/mark-ready`)
      .set('Authorization', `Bearer ${signShop()}`);

    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('ready');
    expect(orderService.markReady).toHaveBeenCalledWith(ORDER_ID, SHOP_ID);
  });
});
