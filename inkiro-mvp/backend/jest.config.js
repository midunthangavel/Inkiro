'use strict';

module.exports = {
  testEnvironment: 'node',
  setupFiles: ['./jest.setup.js'],
  testMatch:  ['**/__tests__/**/*.test.js'],

  collectCoverageFrom: [
    'src/**/*.js',
    // ── Always excluded ─────────────────────────────────────────────────────
    '!src/index.js',              // entry point — starts cron jobs on load
    '!src/config/env.js',         // env-var validation, exercised at boot
    // ── Infrastructure (always mocked) ──────────────────────────────────────
    '!src/db.js',                 // always mocked in tests
    '!src/jobs/**',               // thin cron wrappers, tested structurally
    '!src/voiceParser.js',        // AI/speech parsing — integration test scope
    // ── Not yet covered (incrementally fill, then remove) ──────────────────
    '!src/routes/health.js',
    '!src/routes/users.js',
    '!src/services/shopService.js',
    '!src/services/userService.js',
  ],

  coverageThreshold: {
    global: {
      lines:      70,
      functions:  70,
      branches:   70,
      statements: 70,
    },
  },

  coverageReporters: ['text', 'text-summary', 'lcov'],
};
