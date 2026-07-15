'use strict';

const request = require('supertest');
const express = require('express');
const jwt     = require('jsonwebtoken');

// ─── Mocks (declared before requiring the module under test) ──────────────────

jest.mock('../../src/db', () => ({
  db:     { from: jest.fn() },
  anonDb: { from: jest.fn() },
}));

jest.mock('../../src/services/shopService', () => ({
  registerShop:     jest.fn(),
  updateShop:       jest.fn(),
  getShopById:      jest.fn(),
  getShopByUserId:  jest.fn(),
  getOrdersForShop: jest.fn(),
  listShops:        jest.fn(),
}));

jest.mock('../../src/services/orderService', () => ({
  shopRespond: jest.fn(),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const { anonDb }    = require('../../src/db');
const shopService   = require('../../src/services/shopService');
const orderService  = require('../../src/services/orderService');
const { makeChain } = require('../helpers/supabaseMock');
const shopsRouter   = require('../../src/routes/shops');
const ordersRouter  = require('../../src/routes/orders');

// ─── voiceParser blocks test startup by calling GoogleGenerativeAI(apiKey),
//     which the orders route requires transitively. Mock it to no-op.
jest.mock('../../src/voiceParser', () => ({ parseVoiceOrder: jest.fn() }));

const JWT_SECRET = process.env.JWT_SECRET;
const UUID_A     = '11111111-1111-4111-8111-111111111111'; // shop A user id
const UUID_A_SHP = '22222222-2222-4222-8222-222222222222'; // shop A shop id
const UUID_B_SHP = '33333333-3333-4333-8333-333333333333'; // a different shop's id
const ORDER_ID   = '44444444-4444-4444-8444-444444444444';

// ─── App Builder ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    next();
  });
  app.use('/shops',  shopsRouter);
  app.use('/orders', ordersRouter);
  return app;
}

function signShop(userId = UUID_A) {
  return jwt.sign(
    { sub: userId, userId, role: 'shop', phone: '9000000002' },
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

function arrangeShopLookup(result) {
  anonDb.from.mockReturnValueOnce(makeChain(result));
}

// ─── requireAuth gate ─────────────────────────────────────────────────────────

describe('shop routes — authentication', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('401 — no Authorization header on POST /shops/respond', async () => {
    const res = await request(app).post('/shops/respond').send({ order_id: ORDER_ID, action: 'accept' });
    expect(res.status).toBe(401);
  });

  test('403 — customer JWT cannot hit shop-only routes', async () => {
    const res = await request(app)
      .post('/shops/respond')
      .set('Authorization', `Bearer ${signCustomer()}`)
      .send({ order_id: ORDER_ID, action: 'accept' });
    expect(res.status).toBe(403);
  });
});

// ─── requireShopProfile gate ──────────────────────────────────────────────────

describe('shop routes — shop profile resolution', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('404 — authenticated shop user has no shop profile yet', async () => {
    arrangeShopLookup({ data: null, error: null });
    const res = await request(app)
      .post('/shops/respond')
      .set('Authorization', `Bearer ${signShop()}`)
      .send({ order_id: ORDER_ID, action: 'accept' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Shop profile not found');
  });

  test('500 — DB error while resolving shop profile', async () => {
    arrangeShopLookup({ data: null, error: { message: 'DB down' } });
    const res = await request(app)
      .post('/shops/respond')
      .set('Authorization', `Bearer ${signShop()}`)
      .send({ order_id: ORDER_ID, action: 'accept' });
    expect(res.status).toBe(500);
  });
});

// ─── IDOR resistance on shop-respond ──────────────────────────────────────────

describe('shop routes — IDOR resistance', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('POST /shops/respond — ignores any shop_id in body, uses JWT owner', async () => {
    arrangeShopLookup({ data: { id: UUID_A_SHP, user_id: UUID_A, is_active: true }, error: null });
    orderService.shopRespond.mockResolvedValueOnce({
      id: ORDER_ID, shop_id: UUID_A_SHP, status: 'accepted',
    });

    const res = await request(app)
      .post('/shops/respond')
      .set('Authorization', `Bearer ${signShop()}`)
      // Attacker tries to accept on behalf of shop B — server must ignore.
      .send({ order_id: ORDER_ID, action: 'accept', shop_id: UUID_B_SHP });

    expect(res.status).toBe(200);
    expect(orderService.shopRespond).toHaveBeenCalledWith(ORDER_ID, UUID_A_SHP, 'accept');
  });

  test('POST /orders/:id/shop-respond — ignores any shop_id in body, uses JWT owner', async () => {
    arrangeShopLookup({ data: { id: UUID_A_SHP, user_id: UUID_A, is_active: true }, error: null });
    orderService.shopRespond.mockResolvedValueOnce({
      id: ORDER_ID, shop_id: UUID_A_SHP, status: 'accepted',
    });

    const res = await request(app)
      .post(`/orders/${ORDER_ID}/shop-respond`)
      .set('Authorization', `Bearer ${signShop()}`)
      .send({ action: 'accept', shop_id: UUID_B_SHP });

    expect(res.status).toBe(200);
    expect(orderService.shopRespond).toHaveBeenCalledWith(ORDER_ID, UUID_A_SHP, 'accept');
  });

  test('POST /orders/:id/shop-respond — decline path still works without body shop_id', async () => {
    arrangeShopLookup({ data: { id: UUID_A_SHP, user_id: UUID_A, is_active: true }, error: null });
    orderService.shopRespond.mockResolvedValueOnce({ declined: true });

    const res = await request(app)
      .post(`/orders/${ORDER_ID}/shop-respond`)
      .set('Authorization', `Bearer ${signShop()}`)
      .send({ action: 'decline' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Order declined');
    expect(orderService.shopRespond).toHaveBeenCalledWith(ORDER_ID, UUID_A_SHP, 'decline');
  });
});

// ─── GET ownership guards ─────────────────────────────────────────────────────

describe('shop routes — GET ownership guards', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('GET /:shopId/orders — 403 when caller is not owner', async () => {
    arrangeShopLookup({ data: { id: UUID_A_SHP, user_id: UUID_A, is_active: true }, error: null });

    const res = await request(app)
      .get(`/shops/${UUID_B_SHP}/orders`)
      .set('Authorization', `Bearer ${signShop()}`);

    expect(res.status).toBe(403);
    expect(shopService.getOrdersForShop).not.toHaveBeenCalled();
  });

  test('GET /:shopId/orders — 200 for owner', async () => {
    arrangeShopLookup({ data: { id: UUID_A_SHP, user_id: UUID_A, is_active: true }, error: null });
    shopService.getOrdersForShop.mockResolvedValueOnce([]);

    const res = await request(app)
      .get(`/shops/${UUID_A_SHP}/orders`)
      .set('Authorization', `Bearer ${signShop()}`);

    expect(res.status).toBe(200);
    expect(shopService.getOrdersForShop).toHaveBeenCalledWith(UUID_A_SHP, { status: undefined });
  });

  test('GET /:shopId — 403 when caller is not owner', async () => {
    arrangeShopLookup({ data: { id: UUID_A_SHP, user_id: UUID_A, is_active: true }, error: null });

    const res = await request(app)
      .get(`/shops/${UUID_B_SHP}`)
      .set('Authorization', `Bearer ${signShop()}`);

    expect(res.status).toBe(403);
    expect(shopService.getShopById).not.toHaveBeenCalled();
  });

  test('GET /by-user/:userId — 403 for different user', async () => {
    const OTHER_USER = '55555555-5555-4555-8555-555555555555';
    const res = await request(app)
      .get(`/shops/by-user/${OTHER_USER}`)
      .set('Authorization', `Bearer ${signShop()}`);

    expect(res.status).toBe(403);
    expect(shopService.getShopByUserId).not.toHaveBeenCalled();
  });

  test('GET /by-user/:userId — 200 for self', async () => {
    shopService.getShopByUserId.mockResolvedValueOnce({ id: UUID_A_SHP, user_id: UUID_A });

    const res = await request(app)
      .get(`/shops/by-user/${UUID_A}`)
      .set('Authorization', `Bearer ${signShop()}`);

    expect(res.status).toBe(200);
    expect(shopService.getShopByUserId).toHaveBeenCalledWith(UUID_A);
  });
});

// ─── PUT /:shopId ownership ───────────────────────────────────────────────────

describe('shop routes — PUT /:shopId', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('403 — attempting to update someone else\'s shop', async () => {
    arrangeShopLookup({ data: { id: UUID_A_SHP, user_id: UUID_A, is_active: true }, error: null });

    const res = await request(app)
      .put(`/shops/${UUID_B_SHP}`)
      .set('Authorization', `Bearer ${signShop()}`)
      .send({ shop_name: 'Malicious Rename', address: '666 attacker st', lat: 0, lng: 0 });

    expect(res.status).toBe(403);
    expect(shopService.updateShop).not.toHaveBeenCalled();
  });

  test('200 — updating own shop', async () => {
    arrangeShopLookup({ data: { id: UUID_A_SHP, user_id: UUID_A, is_active: true }, error: null });
    shopService.updateShop.mockResolvedValueOnce({ id: UUID_A_SHP, shop_name: 'Renamed' });

    const res = await request(app)
      .put(`/shops/${UUID_A_SHP}`)
      .set('Authorization', `Bearer ${signShop()}`)
      .send({ shop_name: 'Renamed', address: '12 Main St', lat: 11.0, lng: 76.9 });

    expect(res.status).toBe(200);
    expect(shopService.updateShop).toHaveBeenCalled();
  });
});

// ─── Validation regressions ───────────────────────────────────────────────────

describe('shop routes — validation', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('POST /respond — 400 when order_id missing', async () => {
    arrangeShopLookup({ data: { id: UUID_A_SHP, user_id: UUID_A, is_active: true }, error: null });
    const res = await request(app)
      .post('/shops/respond')
      .set('Authorization', `Bearer ${signShop()}`)
      .send({ action: 'accept' });
    expect(res.status).toBe(400);
  });

  test('POST /respond — 400 when action is not accept/decline', async () => {
    arrangeShopLookup({ data: { id: UUID_A_SHP, user_id: UUID_A, is_active: true }, error: null });
    const res = await request(app)
      .post('/shops/respond')
      .set('Authorization', `Bearer ${signShop()}`)
      .send({ order_id: ORDER_ID, action: 'steal' });
    expect(res.status).toBe(400);
  });
});
