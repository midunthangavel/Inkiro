'use strict';

const validate = require('../../src/middleware/validate');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRes() {
  const res  = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

/** Runs a validate middleware and returns { res, next } for assertions. */
function run(schema, body) {
  const req  = { body: body ?? {} };
  const res  = makeRes();
  const next = jest.fn();
  validate(schema)(req, res, next);
  return { res, next };
}

// ─── sendOtp ──────────────────────────────────────────────────────────────────

describe('validate — sendOtp', () => {
  const S = validate.schemas.sendOtp;

  test('passes valid 10-digit phone', () => {
    const { next, res } = run(S, { phone: '9876543210' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('rejects missing phone', () => {
    const { next, res } = run(S, {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects 9-digit phone (too short)', () => {
    expect(run(S, { phone: '987654321' }).res.status).toHaveBeenCalledWith(400);
  });

  test('rejects 11-digit phone (too long)', () => {
    expect(run(S, { phone: '98765432101' }).res.status).toHaveBeenCalledWith(400);
  });

  test('rejects phone containing letters', () => {
    expect(run(S, { phone: '98765abcde' }).res.status).toHaveBeenCalledWith(400);
  });
});

// ─── verifyOtp ────────────────────────────────────────────────────────────────

describe('validate — verifyOtp', () => {
  const S = validate.schemas.verifyOtp;

  test('passes valid payload', () => {
    const { next } = run(S, { phone: '9876543210', code: '123456', role: 'customer' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('passes with optional name field', () => {
    const { next } = run(S, { phone: '9876543210', code: '123456', role: 'shop', name: 'My Shop' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects invalid role', () => {
    expect(run(S, { phone: '9876543210', code: '123456', role: 'admin' }).res.status)
      .toHaveBeenCalledWith(400);
  });

  test('rejects 5-digit OTP', () => {
    expect(run(S, { phone: '9876543210', code: '12345', role: 'customer' }).res.status)
      .toHaveBeenCalledWith(400);
  });

  test('rejects 7-digit OTP', () => {
    expect(run(S, { phone: '9876543210', code: '1234567', role: 'customer' }).res.status)
      .toHaveBeenCalledWith(400);
  });

  test('rejects missing code', () => {
    expect(run(S, { phone: '9876543210', role: 'customer' }).res.status)
      .toHaveBeenCalledWith(400);
  });
});

// ─── confirmOrder ─────────────────────────────────────────────────────────────

describe('validate — confirmOrder', () => {
  const S     = validate.schemas.confirmOrder;
  const valid = { items: [{ name: 'rice' }], address: '123 Main St', lat: 11.0168, lng: 76.9558 };

  test('passes valid order body', () => {
    expect(run(S, valid).next).toHaveBeenCalledTimes(1);
  });

  test('rejects empty items array', () => {
    expect(run(S, { ...valid, items: [] }).res.status).toHaveBeenCalledWith(400);
  });

  test('rejects missing items', () => {
    const { address, lat, lng } = valid;
    expect(run(S, { address, lat, lng }).res.status).toHaveBeenCalledWith(400);
  });

  test('rejects address shorter than 5 chars', () => {
    expect(run(S, { ...valid, address: '123' }).res.status).toHaveBeenCalledWith(400);
  });

  test('rejects latitude > 90', () => {
    expect(run(S, { ...valid, lat: 91 }).res.status).toHaveBeenCalledWith(400);
  });

  test('rejects longitude < -180', () => {
    expect(run(S, { ...valid, lng: -181 }).res.status).toHaveBeenCalledWith(400);
  });

  test('rejects lat as a string', () => {
    expect(run(S, { ...valid, lat: '11.0168' }).res.status).toHaveBeenCalledWith(400);
  });
});

// ─── adminAssignRunner ────────────────────────────────────────────────────────

describe('validate — adminAssignRunner', () => {
  const S    = validate.schemas.adminAssignRunner;
  const UUID = '550e8400-e29b-41d4-a716-446655440000';

  test('passes two valid UUIDs', () => {
    expect(run(S, { order_id: UUID, runner_id: UUID }).next).toHaveBeenCalledTimes(1);
  });

  test('rejects non-UUID order_id', () => {
    expect(run(S, { order_id: 'not-a-uuid', runner_id: UUID }).res.status)
      .toHaveBeenCalledWith(400);
  });

  test('rejects missing runner_id', () => {
    expect(run(S, { order_id: UUID }).res.status).toHaveBeenCalledWith(400);
  });

  test('error body includes both `error` and `errors` keys', () => {
    const { res } = run(S, {});
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String), errors: expect.any(Array) })
    );
  });
});
