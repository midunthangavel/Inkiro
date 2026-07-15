'use strict';

const pino     = require('pino');
const NODE_ENV = process.env.NODE_ENV || 'development';
const isDev    = NODE_ENV === 'development';
const isTest   = NODE_ENV === 'test';

// ─── Log Level per Environment ────────────────────────────────────────────────

const LOG_LEVEL = {
  production:  'info',
  development: 'debug',
  test:        'silent',
}[NODE_ENV] || 'info';

// ─── Transport ────────────────────────────────────────────────────────────────
// pino-pretty runs in a worker thread (pino v7+).
// Only used in development — production uses structured JSON to stdout.
// IMPORTANT: pino-pretty must be installed as a dependency (not devDependency)
// because it's loaded at runtime by the worker thread.

const transport = isDev
  ? {
      target: 'pino-pretty',
      options: {
        colorize:      true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore:        'pid,hostname,app,env',
        singleLine:    false,
      },
    }
  : undefined;

// ─── Pino Instance ────────────────────────────────────────────────────────────

const logger = pino({
  level:   LOG_LEVEL,
  enabled: !isTest,

  ...(transport ? { transport } : {}),

  base: {
    app: 'inkiro-backend',
    env: NODE_ENV,
  },

  timestamp: pino.stdTimeFunctions.isoTime,

  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-admin-key"]',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
