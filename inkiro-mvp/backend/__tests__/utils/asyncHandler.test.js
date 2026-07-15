'use strict';

const asyncHandler = require('../../src/utils/asyncHandler');

describe('asyncHandler', () => {
  let req, res, next;
  beforeEach(() => {
    req  = {};
    res  = {};
    next = jest.fn();
  });

  test('passes req, res, next to the wrapped handler', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await asyncHandler(fn)(req, res, next);
    expect(fn).toHaveBeenCalledWith(req, res, next);
  });

  test('does not call next when the handler resolves', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await asyncHandler(fn)(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  test('forwards rejected promise to next(err)', async () => {
    const err = new Error('boom');
    const fn  = jest.fn().mockRejectedValue(err);
    await asyncHandler(fn)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(err);
  });

  test('forwards an async function that throws to next(err)', async () => {
    const err = new Error('async-throw');
    const fn  = jest.fn(async () => { throw err; });
    await asyncHandler(fn)(req, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });

  test('does not catch sync throws from non-async handlers (they bubble up)', () => {
    const err = new Error('sync-throw');
    const fn  = jest.fn(() => { throw err; });
    expect(() => asyncHandler(fn)(req, res, next)).toThrow('sync-throw');
    expect(next).not.toHaveBeenCalled();
  });

  test('handles non-Error rejection values', async () => {
    const fn = jest.fn().mockRejectedValue('string-rejection');
    await asyncHandler(fn)(req, res, next);
    expect(next).toHaveBeenCalledWith('string-rejection');
  });
});
