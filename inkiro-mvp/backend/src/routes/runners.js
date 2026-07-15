'use strict';

const express              = require('express');
const asyncHandler         = require('../utils/asyncHandler');
const validate             = require('../middleware/validate');
const { requireAuth }      = require('../middleware/auth');
const requireRunnerProfile = require('../middleware/requireRunnerProfile');
const runnerService        = require('../services/runnerService');

const router = express.Router();

// ─── Ownership Guard ──────────────────────────────────────────────────────────
//
// For GET routes that include a :runnerId (or :userId) in the path, we refuse
// to serve the request unless the authenticated caller owns that resource.
// Admins read the same data through /api/v1/admin/*, which is gated by the
// admin key and never reaches this router.

function ensureOwnsRunner(req, res, next) {
  if (req.runner.id !== req.params.runnerId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function ensureOwnsUser(req, res, next) {
  if (req.user.userId !== req.params.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ─── POST /accept-job ─────────────────────────────────────────────────────────

router.post(
  '/accept-job',
  requireAuth(['runner']),
  requireRunnerProfile,
  validate(validate.schemas.acceptJob),
  asyncHandler(async (req, res) => {
    const { order_id } = req.body;
    const order = await runnerService.acceptJob(req.runner.id, order_id);
    res.json({ order });
  })
);

// ─── POST /update-status ──────────────────────────────────────────────────────

router.post(
  '/update-status',
  requireAuth(['runner']),
  requireRunnerProfile,
  validate(validate.schemas.updateStatus),
  asyncHandler(async (req, res) => {
    const { order_id, status } = req.body;
    const order = await runnerService.updateStatus(req.runner.id, order_id, status);
    res.json({ order });
  })
);

// ─── POST /update-location ────────────────────────────────────────────────────

router.post(
  '/update-location',
  requireAuth(['runner']),
  requireRunnerProfile,
  validate(validate.schemas.updateLocation),
  asyncHandler(async (req, res) => {
    const { lat, lng, is_available } = req.body;
    await runnerService.updateLocation(req.runner.id, lat, lng, is_available);
    res.json({ message: 'Location updated' });
  })
);

// ─── POST /update-profile ─────────────────────────────────────────────────────

router.post(
  '/update-profile',
  requireAuth(['runner']),
  requireRunnerProfile,
  validate(validate.schemas.updateProfile),
  asyncHandler(async (req, res) => {
    const { vehicle_type, upi_id } = req.body;
    await runnerService.updateProfile(req.runner.id, {
      vehicleType: vehicle_type,
      upiId:       upi_id,
    });
    res.json({ message: 'Profile updated' });
  })
);

// ─── GET /by-user/:userId ─────────────────────────────────────────────────────

router.get(
  '/by-user/:userId',
  requireAuth(['runner']),
  ensureOwnsUser,
  asyncHandler(async (req, res) => {
    const runner = await runnerService.getRunnerByUserId(req.params.userId);
    res.json({ runner });
  })
);

// ─── GET /:runnerId/active-order ──────────────────────────────────────────────

router.get(
  '/:runnerId/active-order',
  requireAuth(['runner']),
  requireRunnerProfile,
  ensureOwnsRunner,
  asyncHandler(async (req, res) => {
    const order = await runnerService.getActiveOrder(req.params.runnerId);
    res.json({ order });
  })
);

// ─── GET /:runnerId/earnings ──────────────────────────────────────────────────

router.get(
  '/:runnerId/earnings',
  requireAuth(['runner']),
  requireRunnerProfile,
  ensureOwnsRunner,
  asyncHandler(async (req, res) => {
    const earnings = await runnerService.getEarnings(req.params.runnerId);
    res.json(earnings);
  })
);

// ─── GET /:runnerId/history ───────────────────────────────────────────────────

const orderService = require('../services/orderService');

router.get(
  '/:runnerId/history',
  requireAuth(['runner']),
  requireRunnerProfile,
  ensureOwnsRunner,
  asyncHandler(async (req, res) => {
    const orders = await orderService.listOrdersByRunner(req.params.runnerId, {
      limit: 50,
      onlyDelivered: true,
    });
    res.json({ orders });
  })
);

// ─── POST /:runnerId/withdraw ─────────────────────────────────────────────────

router.post(
  '/:runnerId/withdraw',
  requireAuth(['runner']),
  requireRunnerProfile,
  ensureOwnsRunner,
  asyncHandler(async (req, res) => {
    const { amount_paise } = req.body;
    if (!amount_paise || typeof amount_paise !== 'number' || amount_paise <= 0) {
      return res.status(400).json({ error: 'amount_paise must be a positive number' });
    }
    const request = await runnerService.requestWithdrawal(req.params.runnerId, amount_paise);
    res.status(201).json({ request });
  })
);

// ─── GET /:runnerId ───────────────────────────────────────────────────────────

router.get(
  '/:runnerId',
  requireAuth(['runner']),
  requireRunnerProfile,
  ensureOwnsRunner,
  asyncHandler(async (req, res) => {
    const runner = await runnerService.getRunnerById(req.params.runnerId);
    res.json({ runner });
  })
);

module.exports = router;
