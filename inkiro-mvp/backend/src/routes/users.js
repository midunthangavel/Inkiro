'use strict';

const express         = require('express');
const asyncHandler    = require('../utils/asyncHandler');
const validate        = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const userService     = require('../services/userService');

const router = express.Router();

// ─── Self-only guard ──────────────────────────────────────────────────────────
// A user may only read or modify their own record.

function requireSelf(req, res, next) {
  if (req.user.userId !== req.params.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ─── GET /:id ─────────────────────────────────────────────────────────────────

router.get(
  '/:id',
  requireAuth(),
  requireSelf,
  asyncHandler(async (req, res) => {
    const user = await userService.getUserById(req.params.id);
    res.json({ user });
  })
);

// ─── PUT /:id ─────────────────────────────────────────────────────────────────

router.put(
  '/:id',
  requireAuth(),
  requireSelf,
  validate(validate.schemas.updateUser),
  asyncHandler(async (req, res) => {
    const { name, default_address, default_lat, default_lng } = req.body;

    const user = await userService.updateUser(req.params.id, {
      name,
      defaultAddress: default_address,
      defaultLat:     default_lat,
      defaultLng:     default_lng,
    });

    res.json({ user });
  })
);

module.exports = router;
