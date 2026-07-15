'use strict';

describe('logger', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    jest.resetModules();
  });

  test('exposes the standard pino log methods', () => {
    const logger = require('../../src/utils/logger');
    for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      expect(typeof logger[m]).toBe('function');
    }
  });

  test('level is silent in test env', () => {
    process.env.NODE_ENV = 'test';
    jest.resetModules();
    const logger = require('../../src/utils/logger');
    expect(logger.level).toBe('silent');
  });

  test('level is info in production env', () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const logger = require('../../src/utils/logger');
    expect(logger.level).toBe('info');
  });

  test('level is debug in development env', () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    const logger = require('../../src/utils/logger');
    expect(logger.level).toBe('debug');
  });

  test('falls back to info for unknown NODE_ENV', () => {
    process.env.NODE_ENV = 'staging';
    jest.resetModules();
    const logger = require('../../src/utils/logger');
    expect(logger.level).toBe('info');
  });

  test('attaches app + env to base bindings', () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const logger = require('../../src/utils/logger');
    const child = logger.child({});
    expect(child.bindings().app).toBe('inkiro-backend');
    expect(child.bindings().env).toBe('production');
  });
});
