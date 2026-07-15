'use strict';

/*
 * errorReporter — opt-in Sentry integration.
 * ───────────────────────────────────────────
 * - If SENTRY_DSN is unset, every exported function is a no-op (zero overhead).
 * - If SENTRY_DSN is set but @sentry/node isn't installed, we warn once and
 *   continue as a no-op — the app keeps running, just without external telemetry.
 * - If both are set, errors forward to Sentry with the supplied context.
 *
 * We keep @sentry/node out of package.json so default installs stay lean. To
 * enable:  npm install @sentry/node   and set SENTRY_DSN in the environment.
 */

const logger = require('./logger');

let Sentry      = null;
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  try {
    // Dynamic require so a missing @sentry/node doesn't break cold start.
    // eslint-disable-next-line global-require, import/no-unresolved
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment:      process.env.NODE_ENV || 'development',
      tracesSampleRate: 0,
      // Disable Sentry's own uncaughtException handler — we install our own
      // in index.js so logger + flush happen in a deterministic order.
      integrations: (defaults) => defaults.filter(
        (i) => !['OnUncaughtException', 'OnUnhandledRejection'].includes(i.name)
      ),
    });
    logger.info('Sentry error reporting enabled');
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND') {
      logger.warn('SENTRY_DSN is set but @sentry/node is not installed. Run: npm install @sentry/node');
    } else {
      logger.warn({ err: { message: err.message } }, 'Failed to initialise Sentry');
    }
    Sentry = null;
  }
}

/**
 * Reports an Error to Sentry with optional structured context.
 * Safe to call regardless of whether Sentry is active.
 */
function captureException(err, context = {}) {
  if (!Sentry) return;
  try {
    Sentry.captureException(err, { extra: context });
  } catch (e) {
    logger.error({ err: e }, 'Failed to report error to Sentry');
  }
}

/**
 * Reports a message to Sentry at the given severity ('fatal', 'error',
 * 'warning', 'info', 'debug'). Used by cron jobs on consecutive failures.
 */
function captureMessage(msg, level = 'warning', context = {}) {
  if (!Sentry) return;
  try {
    Sentry.captureMessage(msg, { level, extra: context });
  } catch (e) {
    logger.error({ err: e }, 'Failed to report message to Sentry');
  }
}

/**
 * Flushes queued events before process exit. Returns true if flushed
 * within `timeoutMs`, false on timeout. Always resolves — never rejects.
 */
async function flush(timeoutMs = 2000) {
  if (!Sentry) return true;
  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}

module.exports = { init, captureException, captureMessage, flush };
