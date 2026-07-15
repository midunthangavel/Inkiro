'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('Missing required environment variable: JWT_SECRET');

/**
 * Returns middleware that enforces JWT authentication.
 * @param {string[]} roles - Allowed roles. Empty array allows any authenticated user.
 */
function requireAuth(roles = []) {
  return function (req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = header.slice(7);
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = {
      userId: payload.userId,
      role:   payload.role,
      phone:  payload.phone,
    };

    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}

module.exports = { requireAuth };
