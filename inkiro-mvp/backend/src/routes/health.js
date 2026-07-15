'use strict';

const express      = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { db }       = require('../db');

const router  = express.Router();
const started = Date.now();

// ─── GET /health ──────────────────────────────────────────────────────────────

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { error } = await db.from('users').select('id').limit(1);

    const dbOk = !error;

    res.status(dbOk ? 200 : 503).json({
      status:    dbOk ? 'ok' : 'degraded',
      db:        dbOk ? 'ok' : 'error',
      uptime_ms: Date.now() - started,
      timestamp: new Date().toISOString(),
    });
  })
);

module.exports = router;
