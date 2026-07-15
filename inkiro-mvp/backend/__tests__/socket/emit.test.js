'use strict';

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));
jest.mock('../../src/utils/errorReporter', () => ({
  captureException: jest.fn(),
}));

// ─── Uninitialised ────────────────────────────────────────────────────────────

describe('socket/index — emit helpers when io is not initialised', () => {
  let mod;
  beforeEach(() => {
    jest.resetModules();
    mod = require('../../src/socket/index');
  });

  test('getIO throws a descriptive error', () => {
    expect(() => mod.getIO()).toThrow(/has not been initialised/);
  });

  test('emitToShop is a safe no-op', () => {
    expect(() => mod.emitToShop('shop-1', 'order:new', {})).not.toThrow();
  });

  test('emitToRunner is a safe no-op', () => {
    expect(() => mod.emitToRunner('r-1', 'job:available', {})).not.toThrow();
  });

  test('emitToShops is a safe no-op', () => {
    expect(() => mod.emitToShops(['s1'], 'order:new', {})).not.toThrow();
  });
});

// ─── Initialised with a mocked socket.io server ──────────────────────────────

describe('socket/index — emit helpers when io is initialised', () => {
  let mod, fakeEmit, fakeTo;

  beforeEach(() => {
    jest.resetModules();
    fakeEmit = jest.fn();
    fakeTo   = jest.fn(() => ({ emit: fakeEmit }));

    jest.doMock('socket.io', () => {
      class MockServer {
        constructor() { this.engine = { on: jest.fn() }; }
        on() { /* we don't exercise connection handler here */ }
        use() { /* auth middleware stub */ }
        to(room) { return fakeTo(room); }
      }
      return { Server: MockServer };
    });

    mod = require('../../src/socket/index');
    mod.init({ /* fake httpServer */ });
  });

  test('init() returns an instance retrievable via getIO()', () => {
    expect(mod.getIO()).toBeDefined();
  });

  test('emitToShop targets the shop:<id> room', () => {
    mod.emitToShop('SHOP-A', 'order:new', { id: 1 });
    expect(fakeTo).toHaveBeenCalledWith('shop:SHOP-A');
    expect(fakeEmit).toHaveBeenCalledWith('order:new', { id: 1 });
  });

  test('emitToRunner targets the runner:<id> room', () => {
    mod.emitToRunner('R-1', 'job:available', { x: 2 });
    expect(fakeTo).toHaveBeenCalledWith('runner:R-1');
    expect(fakeEmit).toHaveBeenCalledWith('job:available', { x: 2 });
  });

  test('emitToShops emits once per shop id, in order', () => {
    mod.emitToShops(['s1', 's2', 's3'], 'order:new', { ok: true });
    expect(fakeTo).toHaveBeenNthCalledWith(1, 'shop:s1');
    expect(fakeTo).toHaveBeenNthCalledWith(2, 'shop:s2');
    expect(fakeTo).toHaveBeenNthCalledWith(3, 'shop:s3');
    expect(fakeEmit).toHaveBeenCalledTimes(3);
    expect(fakeEmit).toHaveBeenCalledWith('order:new', { ok: true });
  });

  test('emitToShops is a no-op on empty array', () => {
    mod.emitToShops([], 'order:new', {});
    expect(fakeTo).not.toHaveBeenCalled();
  });

  test('emitToShops is a no-op on non-array input', () => {
    mod.emitToShops(null, 'order:new', {});
    mod.emitToShops(undefined, 'order:new', {});
    mod.emitToShops('s1', 'order:new', {});
    expect(fakeTo).not.toHaveBeenCalled();
  });
});
