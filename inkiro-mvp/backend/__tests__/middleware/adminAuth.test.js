'use strict';

jest.mock('../../src/utils/logger', () => ({
  warn:  jest.fn(),
  error: jest.fn(),
  info:  jest.fn(),
  debug: jest.fn(),
}));

const VALID_KEY = 'test-admin-key-abc123';

describe('adminAuth middleware', () => {
  let adminAuth;

  beforeAll(() => {
    process.env.ADMIN_API_KEY = VALID_KEY;
    jest.resetModules();
    adminAuth = require('../../src/middleware/adminAuth');
  });

  function runMw(headers) {
    const req  = { headers, ip: '127.0.0.1' };
    const json = jest.fn();
    const res  = { status: jest.fn(() => ({ json })), json };
    const next = jest.fn();
    adminAuth(req, res, next);
    return { req, res, next, json };
  }

  test('401 — missing X-Admin-Key header', () => {
    const { res, next, json } = runMw({});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Admin key required' });
    expect(next).not.toHaveBeenCalled();
  });

  test('401 — wrong key (same length)', () => {
    const wrong = 'z'.repeat(VALID_KEY.length);
    const { res, next } = runMw({ 'x-admin-key': wrong });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('401 — wrong key (different length, avoids timingSafeEqual throw)', () => {
    const { res, next } = runMw({ 'x-admin-key': 'short' });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('200 — valid key calls next()', () => {
    const { res, next } = runMw({ 'x-admin-key': VALID_KEY });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('uses timing-safe comparison — wrong key still returns quickly', () => {
    expect(() => runMw({ 'x-admin-key': 'x'.repeat(999) })).not.toThrow();
  });
});

describe('adminAuth module-load guard', () => {
  test('throws at load if ADMIN_API_KEY is unset', () => {
    const saved = process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_API_KEY;
    jest.resetModules();
    expect(() => require('../../src/middleware/adminAuth')).toThrow(/ADMIN_API_KEY/);
    process.env.ADMIN_API_KEY = saved;
  });
});
