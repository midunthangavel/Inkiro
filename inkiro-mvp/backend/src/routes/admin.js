'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const adminAuth = require('../middleware/adminAuth');
const orderService = require('../services/orderService');
const shopService = require('../services/shopService');
const { db } = require('../db');
const C = require('../config/constants');

const router = express.Router();

// All admin routes require the admin key header
router.use(adminAuth);

// ─── GET /dashboard ───────────────────────────────────────────────────────────

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const todayStr = todayMidnight.toISOString();

    const [
      todayOrdersRes,
      todayDeliveredRes,
      activeRunnersRes,
      activeShopsRes,
      pendingOrdersRes,
      failedOrdersRes,
    ] = await Promise.all([
      db.from('orders')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayStr),

      db.from('orders')
        .select('platform_fee_paise, delivery_fee_paise')
        .eq('status', C.ORDER_STATUS.DELIVERED)
        .gte('completed_at', todayStr),

      db.from('runners')
        .select('id', { count: 'exact', head: true })
        .eq('is_available', true),

      db.from('shops')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),

      db.from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', C.ORDER_STATUS.PENDING),

      db.from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', C.ORDER_STATUS.EXPIRED)
        .gte('created_at', todayStr),
    ]);

    const today_revenue = (todayDeliveredRes.data || []).reduce(
      (sum, o) => sum + (o.platform_fee_paise || 0) + (o.delivery_fee_paise || 0),
      0
    );

    res.json({
      today_orders: todayOrdersRes.count || 0,
      today_revenue,
      active_runners: activeRunnersRes.count || 0,
      active_shops: activeShopsRes.count || 0,
      pending_orders: pendingOrdersRes.count || 0,
      failed_orders: failedOrdersRes.count || 0,
    });
  })
);

// ─── POST /assign-runner ──────────────────────────────────────────────────────

router.post(
  '/assign-runner',
  validate(validate.schemas.adminAssignRunner),
  asyncHandler(async (req, res) => {
    const { order_id, runner_id } = req.body;
    const order = await orderService.adminAssignRunner(order_id, runner_id);
    res.json({ order });
  })
);

// ─── GET /orders ──────────────────────────────────────────────────────────────

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const { status } = req.query;

    let query = db
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(C.ADMIN_ORDER_DEFAULT_LIMIT);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;

    if (error) {
      req.log.error({ err: error }, 'Admin: failed to list orders');
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    res.json({ orders: data || [] });
  })
);

// ─── GET /shops ───────────────────────────────────────────────────────────────

router.get(
  '/shops',
  asyncHandler(async (req, res) => {
    const shops = await shopService.listShops();
    res.json({ shops });
  })
);

// ─── GET /runners ─────────────────────────────────────────────────────────────

router.get(
  '/runners',
  asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from('runners')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      req.log.error({ err: error }, 'Admin: failed to list runners');
      return res.status(500).json({ error: 'Failed to fetch runners' });
    }

    res.json({ runners: data || [] });
  })
);

// ─── POST /shops/:id/block · /shops/:id/unblock ───────────────────────────────

router.post(
  '/shops/:id/block',
  asyncHandler(async (req, res) => {
    const { error } = await db.from('shops').update({ is_blocked: true }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: 'Failed to block shop' });
    res.json({ ok: true });
  })
);

router.post(
  '/shops/:id/unblock',
  asyncHandler(async (req, res) => {
    const { error } = await db.from('shops').update({ is_blocked: false }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: 'Failed to unblock shop' });
    res.json({ ok: true });
  })
);

// ─── POST /runners/:id/block · /runners/:id/unblock ──────────────────────────

router.post(
  '/runners/:id/block',
  asyncHandler(async (req, res) => {
    const { error } = await db.from('runners').update({ is_blocked: true }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: 'Failed to block runner' });
    res.json({ ok: true });
  })
);

router.post(
  '/runners/:id/unblock',
  asyncHandler(async (req, res) => {
    const { error } = await db.from('runners').update({ is_blocked: false }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: 'Failed to unblock runner' });
    res.json({ ok: true });
  })
);

// ─── PUT /orders/:id/note ─────────────────────────────────────────────────────

router.put(
  '/orders/:id/note',
  asyncHandler(async (req, res) => {
    const { note } = req.body;
    if (typeof note !== 'string') return res.status(400).json({ error: 'note must be a string' });
    const { error } = await db.from('orders').update({ admin_note: note.trim() || null }).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: 'Failed to save note' });
    res.json({ ok: true });
  })
);

module.exports = router;
