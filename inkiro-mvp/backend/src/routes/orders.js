'use strict';

const express            = require('express');
const asyncHandler       = require('../utils/asyncHandler');
const validate           = require('../middleware/validate');
const { requireAuth }    = require('../middleware/auth');
const requireShopProfile = require('../middleware/requireShopProfile');
const { parseVoiceLimiter } = require('../middleware/rateLimit');
const { anonDb }         = require('../db');
const orderService       = require('../services/orderService');
const voiceParser        = require('../voiceParser');
const { emitToCustomer, emitToShop, emitToRunner } = require('../socket/index');
const notificationService = require('../services/notificationService');

const router = express.Router();

// ─── POST /parse-voice ────────────────────────────────────────────────────────

router.post(
  '/parse-voice',
  requireAuth(['customer']),
  parseVoiceLimiter,
  validate(validate.schemas.parseVoice),
  asyncHandler(async (req, res) => {
    const { audio_base64, language } = req.body;

    try {
      const result = await voiceParser.parseVoiceOrder(audio_base64, language);
      res.json(result);
    } catch (err) {
      req.log.warn({ err }, 'Voice parsing failed');
      res.status(400).json({ error: err.message || 'Failed to parse voice order' });
    }
  })
);

// ─── POST /confirm ────────────────────────────────────────────────────────────

router.post(
  '/confirm',
  requireAuth(['customer']),
  validate(validate.schemas.confirmOrder),
  asyncHandler(async (req, res) => {
    const { items, address, lat, lng } = req.body;
    const idempotencyKey = req.headers['x-idempotency-key'] || null;

    const order = await orderService.confirmOrder({
      customerId:    req.user.userId, // avoids a DB lookup; passed directly to INSERT
      customerPhone: req.user.phone,
      items,
      address,
      lat,
      lng,
      idempotencyKey,
    });

    res.status(201).json({
      order_id:                   order.id,
      status:                     'broadcasting',
      estimated_delivery_minutes: 25,
    });
  })
);

// ─── POST /:id/shop-respond ───────────────────────────────────────────────────

router.post(
  '/:id/shop-respond',
  requireAuth(['shop']),
  requireShopProfile,
  validate({
    action:         { type: 'string', enum: ['accept', 'decline'], required: true },
    decline_reason: { type: 'string', required: false },
  }),
  asyncHandler(async (req, res) => {
    // shop id is derived from the JWT via requireShopProfile — never the body.
    const result = await orderService.shopRespond(
      req.params.id, req.shop.id, req.body.action, req.body.decline_reason
    );

    if (result.declined) return res.json({ message: 'Order declined' });
    res.json({ order: result });
  })
);

// ─── GET /customer/phone/:phone ───────────────────────────────────────────────

router.get(
  '/customer/phone/:phone',
  requireAuth(['customer']),
  asyncHandler(async (req, res) => {
    if (req.params.phone !== req.user.phone) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // req.user.userId comes from the JWT — no extra DB lookup needed.
    const orders = await orderService.listOrdersByCustomer(req.user.userId);
    res.json({ orders });
  })
);

// ─── GET /:id/status ──────────────────────────────────────────────────────────

router.get(
  '/:id/status',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const order = await orderService.getOrderById(req.params.id);

    let shop_name   = null;
    let runner_name = null;

    if (order.shop_id) {
      const { data: shop } = await anonDb
        .from('shops')
        .select('shop_name')
        .eq('id', order.shop_id)
        .maybeSingle();
      shop_name = shop?.shop_name || null;
    }

    if (order.runner_id) {
      const { data: runner } = await anonDb
        .from('runners')
        .select('user_id')
        .eq('id', order.runner_id)
        .maybeSingle();

      if (runner) {
        const { data: user } = await anonDb
          .from('users')
          .select('name')
          .eq('id', runner.user_id)
          .maybeSingle();
        runner_name = user?.name || null;
      }
    }

    const subtotal = (order.items || []).reduce(
      (sum, item) => sum + (item.estimated_price_rupees * item.quantity * 100),
      0
    );
    const total = subtotal + order.platform_fee_paise + order.delivery_fee_paise;

    res.json({
      status:       order.status,
      items:        order.items,
      total,
      shop_name,
      runner_name,
      created_at:   order.created_at,
      accepted_at:  order.accepted_at  || null,
      picked_up_at: order.picked_up_at || null,
      completed_at: order.completed_at || null,
    });
  })
);

// ─── GET /:id ─────────────────────────────────────────────────────────────────

router.get(
  '/:id',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const order = await orderService.getOrderByIdForUser(req.params.id, req.user);
    res.json({ order });
  })
);

// ─── POST /:id/mark-ready ─────────────────────────────────────────────────────

router.post(
  '/:id/mark-ready',
  requireAuth(['shop']),
  requireShopProfile,
  asyncHandler(async (req, res) => {
    const order = await orderService.markReady(req.params.id, req.shop.id);
    res.json({ order });
  })
);

// ─── POST /:id/cancel ─────────────────────────────────────────────────────────

router.post(
  '/:id/cancel',
  requireAuth(['customer']),
  asyncHandler(async (req, res) => {
    const order = await orderService.cancelOrder(req.params.id, req.user.userId);

    emitToCustomer(order.customer_id, 'order:updated', { id: order.id, status: 'cancelled' });

    if (order.shop_id) {
      notificationService.notifyShop(
        order.shop_id, 'order:cancelled', { order_id: order.id },
        '❌ Order cancelled', 'Customer cancelled this order', { order_id: order.id }
      );
    }
    if (order.runner_id) {
      notificationService.notifyRunners(
        [{ id: order.runner_id }], 'order:cancelled', { order_id: order.id },
        '❌ Order cancelled', 'Customer cancelled this order', { order_id: order.id }
      );
    }

    res.json({ ok: true });
  })
);

// ─── POST /:id/rate ───────────────────────────────────────────────────────────

router.post(
  '/:id/rate',
  requireAuth(['customer']),
  validate(validate.schemas.rateOrder),
  asyncHandler(async (req, res) => {
    const { rating, comment } = req.body;
    await orderService.rateOrder(req.params.id, req.user.userId, rating, comment);
    res.json({ ok: true });
  })
);

module.exports = router;
