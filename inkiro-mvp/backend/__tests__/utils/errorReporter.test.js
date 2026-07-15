'use strict';

// errorReporter's branching depends on env vars and a conditional require of
// '@sentry/node'. Each test below configures those before re-requiring the
// module via jest.isolateModules(), so state from one test can't leak into
// another (the module caches its init state in a closure).

describe('errorReporter', () => {
  const ORIGINAL_DSN = process.env.SENTRY_DSN;

  afterEach(() => {
    if (ORIGINAL_DSN === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = ORIGINAL_DSN;
    jest.resetModules();
  });

  test('no-op when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;

    jest.isolateModules(() => {
      const er = require('../../src/utils/errorReporter');
      er.init();
      expect(() => er.captureException(new Error('boom'))).not.toThrow();
      expect(() => er.captureMessage('hi')).not.toThrow();
    });
  });

  test('flush() resolves true when Sentry is not configured', async () => {
    delete process.env.SENTRY_DSN;

    await jest.isolateModulesAsync(async () => {
      const er = require('../../src/utils/errorReporter');
      er.init();
      await expect(er.flush(50)).resolves.toBe(true);
    });
  });

  test('captureException forwards to @sentry/node when DSN is set', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.io/1';

    const sentryMock = {
      init:             jest.fn(),
      captureException: jest.fn(),
      captureMessage:   jest.fn(),
      flush:            jest.fn().mockResolvedValue(true),
    };

    jest.isolateModules(() => {
      // Provide a virtual mock since @sentry/node is not a real dependency.
      jest.doMock('@sentry/node', () => sentryMock, { virtual: true });

      const er = require('../../src/utils/errorReporter');
      er.init();
      er.captureException(new Error('boom'), { foo: 'bar' });
    });

    expect(sentryMock.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://fake@sentry.io/1',
    }));
    expect(sentryMock.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: { foo: 'bar' } })
    );
  });

  test('captureMessage forwards to Sentry with level and extra context', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.io/1';

    const sentryMock = {
      init:             jest.fn(),
      captureException: jest.fn(),
      captureMessage:   jest.fn(),
      flush:            jest.fn().mockResolvedValue(true),
    };

    jest.isolateModules(() => {
      jest.doMock('@sentry/node', () => sentryMock, { virtual: true });

      const er = require('../../src/utils/errorReporter');
      er.init();
      er.captureMessage('consecutive cron failure', 'error', { job: 'orderExpiry' });
    });

    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      'consecutive cron failure',
      expect.objectContaining({ level: 'error', extra: { job: 'orderExpiry' } })
    );
  });

  test('init is idempotent — second call does not re-init Sentry', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.io/1';

    const sentryMock = {
      init:             jest.fn(),
      captureException: jest.fn(),
      captureMessage:   jest.fn(),
      flush:            jest.fn().mockResolvedValue(true),
    };

    jest.isolateModules(() => {
      jest.doMock('@sentry/node', () => sentryMock, { virtual: true });

      const er = require('../../src/utils/errorReporter');
      er.init();
      er.init();
      er.init();
    });

    expect(sentryMock.init).toHaveBeenCalledTimes(1);
  });

  test('falls back to no-op when @sentry/node is not installed', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.io/1';

    jest.isolateModules(() => {
      // Simulate MODULE_NOT_FOUND by making the virtual mock throw on require.
      jest.doMock('@sentry/node', () => {
        const err = new Error('Cannot find module \'@sentry/node\'');
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      }, { virtual: true });

      const er = require('../../src/utils/errorReporter');
      er.init();
      expect(() => er.captureException(new Error('boom'))).not.toThrow();
      expect(() => er.captureMessage('hi', 'info')).not.toThrow();
    });
  });

  test('captureException swallows errors thrown by Sentry itself', () => {
    process.env.SENTRY_DSN = 'https://fake@sentry.io/1';

    const sentryMock = {
      init:             jest.fn(),
      captureException: jest.fn(() => { throw new Error('sentry blew up'); }),
      captureMessage:   jest.fn(),
      flush:            jest.fn().mockResolvedValue(true),
    };

    jest.isolateModules(() => {
      jest.doMock('@sentry/node', () => sentryMock, { virtual: true });

      const er = require('../../src/utils/errorReporter');
      er.init();
      expect(() => er.captureException(new Error('app error'))).not.toThrow();
    });
  });
});
