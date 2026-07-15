'use strict';

jest.mock('../../src/utils/logger', () => {
  const child = jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn() });
  return { child, info: jest.fn(), error: jest.fn(), warn: jest.fn() };
});

const logger    = require('../../src/utils/logger');
const requestId = require('../../src/middleware/requestId');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('requestId middleware', () => {
  let req, res, next;
  beforeEach(() => {
    req  = {};
    res  = { setHeader: jest.fn() };
    next = jest.fn();
    logger.child.mockClear();
    res.setHeader.mockClear();
  });

  test('assigns a UUID v4 to req.id', () => {
    requestId(req, res, next);
    expect(req.id).toMatch(UUID_V4);
  });

  test('sets X-Request-ID response header to the same id', () => {
    requestId(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.id);
  });

  test('attaches a pino child logger on req.log bound to the request id', () => {
    requestId(req, res, next);
    expect(logger.child).toHaveBeenCalledWith({ request_id: req.id });
    expect(req.log).toBeDefined();
  });

  test('calls next()', () => {
    requestId(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  test('generates a unique id per request', () => {
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      const r = {};
      requestId(r, { setHeader: jest.fn() }, jest.fn());
      seen.add(r.id);
    }
    expect(seen.size).toBe(20);
  });
});
