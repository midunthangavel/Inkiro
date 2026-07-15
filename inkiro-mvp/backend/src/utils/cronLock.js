'use strict';

const { db } = require('../db');
const logger = require('./logger');

const DEFAULT_STALE_MS = 5 * 60 * 1000;

// An instance identifier that shows up in cron_locks.locked_by — useful for
// telemetry when debugging "why was this cron skipped on instance A?".
const INSTANCE_ID = process.env.INSTANCE_ID || `${process.pid}@${require('os').hostname()}`;

/**
 * Runs `fn()` at most once across the fleet per cron tick, using a row in the
 * `cron_locks` table as a distributed mutex.
 *
 * Acquisition is a single UPDATE whose WHERE clause only matches when the row
 * is unclaimed or the previous holder's timestamp is older than `staleMs`.
 * Postgres serializes concurrent UPDATEs on the same row, so exactly one caller
 * observes `data.length === 1` — everyone else sees 0 and skips their tick.
 *
 * On exception (or normal completion), the lock is always released in `finally`.
 * If the process crashes before release, the staleness guard lets the next
 * instance pick up after `staleMs`.
 *
 * @param {string}   name    key in cron_locks.name (must exist — seeded by migration 0003)
 * @param {function} fn      async function to run while holding the lock
 * @param {object}   [opts]
 * @param {number}   [opts.staleMs=300000] how old a locked_at must be to be considered abandoned
 * @returns {Promise<boolean>} true if this caller ran fn; false if skipped
 */
async function withCronLock(name, fn, { staleMs = DEFAULT_STALE_MS } = {}) {
  const staleThreshold = new Date(Date.now() - staleMs).toISOString();
  const now            = new Date().toISOString();

  // Acquire. The .or() compiles to: locked_at IS NULL OR locked_at < staleThreshold.
  const { data, error } = await db
    .from('cron_locks')
    .update({ locked_at: now, locked_by: INSTANCE_ID })
    .eq('name', name)
    .or(`locked_at.is.null,locked_at.lt.${staleThreshold}`)
    .select('name');

  if (error) {
    logger.warn({ err: error, lock: name }, 'cronLock acquire failed — skipping tick');
    return false;
  }

  if (!data || data.length === 0) {
    // Another instance holds the lock. Normal outcome on multi-instance.
    logger.debug({ lock: name }, 'cronLock held by another instance — skipping tick');
    return false;
  }

  try {
    await fn();
    return true;
  } finally {
    const { error: releaseErr } = await db
      .from('cron_locks')
      .update({ locked_at: null, locked_by: null })
      .eq('name', name);

    if (releaseErr) {
      // Best-effort. The staleness guard will free the lock eventually.
      logger.warn({ err: releaseErr, lock: name }, 'cronLock release failed');
    }
  }
}

module.exports = { withCronLock };
