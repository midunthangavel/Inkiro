'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

const ADMIN_KEY = process.env.ADMIN_API_KEY;
if (!ADMIN_KEY) {
  throw new Error('Missing required environment variable: ADMIN_API_KEY');
}

/**
 * Enforces X-Admin-Key header on all /api/v1/admin/* routes.
 * Uses timing-safe comparison to prevent timing-based key discovery.
 */
function adminAuth(req, res, next) {
  const provided = req.headers['x-admin-key'];

  if (!provided) {
    return res.status(401).json({ error: 'Admin key required' });
  }

  try {
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(ADMIN_KEY);

    const valid =
      providedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(providedBuf, expectedBuf);

    if (!valid) {
      logger.warn({ ip: req.ip }, 'Invalid admin key attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = adminAuth;
