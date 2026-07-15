'use strict';

jest.mock('../../src/db', () => ({
  db:     { from: jest.fn() },
  anonDb: { from: jest.fn() },
}));

const { db }           = require('../../src/db');
const { makeChain }    = require('../helpers/supabaseMock');
const { withCronLock } = require('../../src/utils/cronLock');

// ─── withCronLock ─────────────────────────────────────────────────────────────
//
// The helper issues two sequential UPDATEs: one to acquire the lock, one to
// release it. Both target the same `cron_locks` row, so each test queues two
// makeChain results in order.

describe('withCronLock', () => {
  beforeEach(() => jest.clearAllMocks());

  test('runs fn when the lock is acquired, then releases', async () => {
    // Acquire: one row returned → lock is ours.
    db.from.mockReturnValueOnce(makeChain({ data: [{ name: 'job' }], error: null }));
    // Release: single no-op update.
    db.from.mockReturnValueOnce(makeChain({ data: null, error: null }));

    const fn = jest.fn().mockResolvedValue(undefined);
    const result = await withCronLock('job', fn);

    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    // Both acquire and release hit cron_locks.
    expect(db.from).toHaveBeenNthCalledWith(1, 'cron_locks');
    expect(db.from).toHaveBeenNthCalledWith(2, 'cron_locks');
  });

  test('skips fn when another instance holds the lock', async () => {
    // Acquire returns zero rows — another instance already owns it.
    db.from.mockReturnValueOnce(makeChain({ data: [], error: null }));

    const fn = jest.fn();
    const result = await withCronLock('job', fn);

    expect(result).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    // No release call — we never acquired.
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  test('releases lock even when fn throws', async () => {
    db.from.mockReturnValueOnce(makeChain({ data: [{ name: 'job' }], error: null }));
    const releaseChain = makeChain({ data: null, error: null });
    db.from.mockReturnValueOnce(releaseChain);

    const boom = new Error('fn blew up');
    const fn   = jest.fn().mockRejectedValue(boom);

    await expect(withCronLock('job', fn)).rejects.toThrow('fn blew up');
    expect(fn).toHaveBeenCalledTimes(1);
    // Release must still have happened.
    expect(db.from).toHaveBeenCalledTimes(2);
    expect(releaseChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ locked_at: null, locked_by: null })
    );
  });

  test('returns false and logs when the acquire UPDATE errors', async () => {
    db.from.mockReturnValueOnce(
      makeChain({ data: null, error: { message: 'connection reset' } })
    );

    const fn = jest.fn();
    const result = await withCronLock('job', fn);

    expect(result).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
