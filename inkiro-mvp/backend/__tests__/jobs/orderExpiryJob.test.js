'use strict';

jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() })),
}));

jest.mock('../../src/utils/cronLock', () => ({
  withCronLock: jest.fn(async (_name, fn) => fn()),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../src/utils/errorReporter', () => ({
  captureException: jest.fn(),
}));

jest.mock('../../src/services/orderService', () => ({
  expireStaleOrders:   jest.fn().mockResolvedValue(undefined),
  retryRunnerDispatch: jest.fn().mockResolvedValue(undefined),
}));

const cron                           = require('node-cron');
const cronLock                       = require('../../src/utils/cronLock');
const logger                         = require('../../src/utils/logger');
const errorReporter                  = require('../../src/utils/errorReporter');
const orderService                   = require('../../src/services/orderService');
const { CRON_ORDER_EXPIRY_SCHEDULE } = require('../../src/config/constants');
const job                            = require('../../src/jobs/orderExpiryJob');

describe('orderExpiryJob', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(()  => job.stop());

  test('start() schedules with the configured cron expression', () => {
    job.start();
    expect(cron.schedule).toHaveBeenCalledTimes(1);
    expect(cron.schedule).toHaveBeenCalledWith(
      CRON_ORDER_EXPIRY_SCHEDULE,
      expect.any(Function)
    );
  });

  test('start() is idempotent — second call does NOT re-schedule', () => {
    job.start();
    job.start();
    expect(cron.schedule).toHaveBeenCalledTimes(1);
  });

  test('scheduled callback acquires the cron lock and calls expireStaleOrders', async () => {
    job.start();
    const cb = cron.schedule.mock.calls[0][1];
    await cb();
    expect(cronLock.withCronLock).toHaveBeenCalledWith('orderExpiry', expect.any(Function));
    expect(orderService.expireStaleOrders).toHaveBeenCalledTimes(1);
  });

  test('errors are caught, logged, and reported — never throw out of cron', async () => {
    const err = new Error('DB down');
    cronLock.withCronLock.mockRejectedValueOnce(err);
    job.start();
    const cb = cron.schedule.mock.calls[0][1];
    await expect(cb()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith({ err }, expect.stringContaining('orderExpiryJob'));
    expect(errorReporter.captureException).toHaveBeenCalledWith(err, { job: 'orderExpiry' });
  });

  test('stop() stops the task and allows re-scheduling on next start()', () => {
    job.start();
    const task = cron.schedule.mock.results[0].value;
    job.stop();
    expect(task.stop).toHaveBeenCalledTimes(1);

    job.start();
    expect(cron.schedule).toHaveBeenCalledTimes(2);
  });

  test('stop() on an unstarted job is a safe no-op', () => {
    expect(() => job.stop()).not.toThrow();
  });
});
