'use strict';

const request = require('supertest');
const express = require('express');
const jwt     = require('jsonwebtoken');

// ─── Mocks (declared before any require of the module under test) ─────────────

jest.mock('../../src/db', () => ({
  db:               { from: jest.fn() },
  anonDb:           { from: jest.fn() },
  createUserClient: jest.fn(),
}));

jest.mock('axios');

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const axios          = require('axios');
const { db, anonDb } = require('../../src/db');
const { makeChain }  = require('../helpers/supabaseMock');
const authRouter     = require('../../src/routes/auth');

const JWT_SECRET = process.env.JWT_SECRET;

// ─── Minimal test app ─────────────────────────────────────────────────────────

/** Avoids loading index.js (and its cron jobs). */
function buildApp() {
  const app = express();
  app.use(express.json());
  // Stub pino-http's req.log so route handlers don't throw on req.log.info/error
  app.use((req, _res, next) => {
    req.log = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    next();
  });
  app.use('/auth', authRouter);
  return app;
}

// ─── POST /auth/send-otp ──────────────────────────────────────────────────────

describe('POST /auth/send-otp', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  test('400 — missing phone', async () => {
    const res = await request(app).post('/auth/send-otp').send({});
    expect(res.status).toBe(400);
  });

  test('400 — invalid phone (8 digits)', async () => {
    const res = await request(app).post('/auth/send-otp').send({ phone: '12345678' });
    expect(res.status).toBe(400);
  });

  test('500 — DB upsert error', async () => {
    anonDb.from.mockReturnValueOnce(
      makeChain({ data: null, error: { message: 'DB write failure' } })
    );
    const res = await request(app).post('/auth/send-otp').send({ phone: '9876543210' });
    expect(res.status).toBe(500);
  });

  test('502 — Fast2SMS network failure', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    axios.post.mockRejectedValueOnce(new Error('network timeout'));
    const res = await request(app).post('/auth/send-otp').send({ phone: '9876543210' });
    expect(res.status).toBe(502);
  });

  test('200 — OTP sent successfully', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    axios.post.mockResolvedValueOnce({ data: { return: true } });
    const res = await request(app).post('/auth/send-otp').send({ phone: '9876543210' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('OTP sent');
  });
});

// ─── POST /auth/verify-otp ────────────────────────────────────────────────────

describe('POST /auth/verify-otp', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  const VALID_BODY = { phone: '9876543210', code: '123456', role: 'customer' };
  const FUTURE     = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const PAST       = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  test('400 — missing code and role', async () => {
    const res = await request(app).post('/auth/verify-otp').send({ phone: '9876543210' });
    expect(res.status).toBe(400);
  });

  test('401 — OTP record not found', async () => {
    anonDb.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    const res = await request(app).post('/auth/verify-otp').send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid OTP');
  });

  test('401 — wrong OTP code', async () => {
    anonDb.from.mockReturnValueOnce(
      makeChain({ data: { code: '999999', expires_at: FUTURE }, error: null })
    );
    const res = await request(app).post('/auth/verify-otp').send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  test('401 — expired OTP', async () => {
    anonDb.from.mockReturnValueOnce(
      makeChain({ data: { code: '123456', expires_at: PAST }, error: null })
    );
    const res = await request(app).post('/auth/verify-otp').send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('OTP expired');
  });

  test('200 — valid OTP, existing user → returns signed JWT', async () => {
    const fakeUser = { id: 'uid-001', phone: '9876543210', role: 'customer', name: null };

    anonDb.from
      // 1. otp_codes select → maybeSingle
      .mockReturnValueOnce(makeChain({ data: { code: '123456', expires_at: FUTURE }, error: null }))
      // 2. otp_codes delete → awaited directly (thenable)
      .mockReturnValueOnce(makeChain({ data: null, error: null }))
      // 3. users select → maybeSingle → existing user found
      .mockReturnValueOnce(makeChain({ data: fakeUser, error: null }));

    const res = await request(app).post('/auth/verify-otp').send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('uid-001');
    expect(res.body.token).toBeDefined();

    const decoded = jwt.verify(res.body.token, JWT_SECRET);
    expect(decoded.sub).toBe('uid-001');
    expect(decoded.userId).toBe('uid-001');
    expect(decoded.role).toBe('customer');
  });

  test('200 — valid OTP, new user created', async () => {
    const newUser = { id: 'uid-002', phone: '9876543210', role: 'customer', name: 'Alice' };

    anonDb.from
      .mockReturnValueOnce(makeChain({ data: { code: '123456', expires_at: FUTURE }, error: null }))
      .mockReturnValueOnce(makeChain({ data: null, error: null }))    // otp_codes delete
      .mockReturnValueOnce(makeChain({ data: null,    error: null })) // users maybeSingle → none
      .mockReturnValueOnce(makeChain({ data: newUser, error: null })); // users insert → single

    const res = await request(app)
      .post('/auth/verify-otp')
      .send({ ...VALID_BODY, name: 'Alice' });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('uid-002');
  });
});

// ─── POST /auth/register-push-token ──────────────────────────────────────────

describe('POST /auth/register-push-token', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  function signToken(extra = {}) {
    return jwt.sign(
      { sub: 'uid-001', userId: 'uid-001', role: 'customer', phone: '9876543210', ...extra },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  test('401 — no Authorization header', async () => {
    const res = await request(app)
      .post('/auth/register-push-token')
      .send({ token: 'ExponentPushToken[xxx]' });
    expect(res.status).toBe(401);
  });

  test('401 — malformed JWT', async () => {
    const res = await request(app)
      .post('/auth/register-push-token')
      .set('Authorization', 'Bearer not-a-jwt')
      .send({ token: 'ExponentPushToken[xxx]' });
    expect(res.status).toBe(401);
  });

  test('400 — missing push token in body', async () => {
    const res = await request(app)
      .post('/auth/register-push-token')
      .set('Authorization', `Bearer ${signToken()}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('200 — push token registered', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));
    const res = await request(app)
      .post('/auth/register-push-token')
      .set('Authorization', `Bearer ${signToken()}`)
      .send({ token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxxxx]' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Push token registered');
  });

  test('500 — DB upsert error for push token', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: null, error: { message: 'DB error' } }));
    const res = await request(app)
      .post('/auth/register-push-token')
      .set('Authorization', `Bearer ${signToken()}`)
      .send({ token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxxxx]' });
    expect(res.status).toBe(500);
  });
});
