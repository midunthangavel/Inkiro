'use strict';

const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

/**
 * Injects a UUID v4 request ID into every request.
 * Attaches a pino child logger to req.log with request_id bound.
 * Sets X-Request-ID on the response for client-side correlation.
 */
function requestId(req, res, next) {
  const id = randomUUID();
  req.id  = id;
  req.log = logger.child({ request_id: id });
  res.setHeader('X-Request-ID', id);
  next();
}

module.exports = requestId;
