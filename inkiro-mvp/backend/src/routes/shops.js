'use strict';

const express            = require('express');
const asyncHandler       = require('../utils/asyncHandler');
const validate           = require('../middleware/validate');
const { requireAuth }    = require('../middleware/auth');
const requireShopProfile = require('../middleware/requireShopProfile');
const shopService        = require('../services/shopService');
const orderService       = require('../services/orderService');
const { anonDb }         = require('../db');

const router = express.Router();

// ─── Ownership Guards ─────────────────────────────────────────────────────────
//
// Admins read shop data through /api/v1/admin/*, which is gated by the admin
// key and never reaches this router. So these guards only need to prove that
// the authenticated shop user owns the :shopId / :userId in the path.

function ensureOwnsShop(req, res, next) {
  if (req.shop.id !== req.params.shopId) {
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

// ─── POST /register ───────────────────────────────────────────────────────────
//
// Intentionally does NOT use requireShopProfile — the shop profile is being
// created here, so looking it up first would always 404.

router.post(
  '/register',
  requireAuth(['shop']),
  validate(validate.schemas.registerShop),
  asyncHandler(async (req, res) => {
    const { shop_name, address, lat, lng } = req.body;

    const shop = await shopService.registerShop(req.user.userId, {
      shopName: shop_name,
      address,
      lat,
      lng,
    });

    res.status(201).json({ shop });
  })
);

// ─── POST /respond ────────────────────────────────────────────────────────────
//
// Alias for POST /orders/:id/shop-respond. Kept for backward compatibility.
// shop_id comes from the JWT via requireShopProfile — never from the body.

router.post(
  '/respond',
  requireAuth(['shop']),
  requireShopProfile,
  validate(validate.schemas.shopRespond),
  asyncHandler(async (req, res) => {
    const { order_id, action } = req.body;
    const result = await orderService.shopRespond(order_id, req.shop.id, action);

    if (result.declined) return res.json({ message: 'Order declined' });
    res.json({ order: result });
  })
);

// ─── GET /by-user/:userId ─────────────────────────────────────────────────────

router.get(
  '/by-user/:userId',
  requireAuth(['shop']),
  ensureOwnsUser,
  asyncHandler(async (req, res) => {
    const shop = await shopService.getShopByUserId(req.params.userId);
    res.json({ shop });
  })
);

// ─── GET /:shopId/orders ──────────────────────────────────────────────────────

router.get(
  '/:shopId/orders',
  requireAuth(['shop']),
  requireShopProfile,
  ensureOwnsShop,
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const orders = await shopService.getOrdersForShop(req.params.shopId, { status });
    res.json({ orders });
  })
);

// ─── PUT /:shopId ─────────────────────────────────────────────────────────────

router.put(
  '/:shopId',
  requireAuth(['shop']),
  requireShopProfile,
  ensureOwnsShop,
  validate(validate.schemas.updateShop),
  asyncHandler(async (req, res) => {
    const { shop_name, address, lat, lng } = req.body;
    const shop = await shopService.updateShop(
      req.params.shopId,
      req.user.userId,
      { shopName: shop_name, address, lat, lng },
    );
    res.json({ shop });
  })
);

// ─── GET /:shopId ─────────────────────────────────────────────────────────────

router.get(
  '/:shopId',
  requireAuth(['shop']),
  requireShopProfile,
  ensureOwnsShop,
  asyncHandler(async (req, res) => {
    const shop = await shopService.getShopById(req.params.shopId);
    res.json({ shop });
  })
);

// ─── GET /:shopId/items ───────────────────────────────────────────────────────

router.get(
  '/:shopId/items',
  requireAuth(['shop']),
  requireShopProfile,
  ensureOwnsShop,
  asyncHandler(async (req, res) => {
    const { data, error } = await anonDb
      .from('shop_items')
      .select('*')
      .eq('shop_id', req.params.shopId)
      .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: 'Failed to fetch items' });
    res.json({ items: data || [] });
  })
);

// ─── POST /:shopId/items ──────────────────────────────────────────────────────

router.post(
  '/:shopId/items',
  requireAuth(['shop']),
  requireShopProfile,
  ensureOwnsShop,
  asyncHandler(async (req, res) => {
    const { name, unit, price_paise } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    const { data, error } = await anonDb
      .from('shop_items')
      .insert({ shop_id: req.params.shopId, name: name.trim(), unit: unit?.trim() || 'piece', price_paise: price_paise || 0 })
      .select()
      .single();
    if (error) return res.status(500).json({ error: 'Failed to add item' });
    res.status(201).json({ item: data });
  })
);

// ─── PUT /:shopId/items/:itemId ───────────────────────────────────────────────

router.put(
  '/:shopId/items/:itemId',
  requireAuth(['shop']),
  requireShopProfile,
  ensureOwnsShop,
  asyncHandler(async (req, res) => {
    const { name, unit, price_paise, in_stock } = req.body;
    const patch = {};
    if (name        !== undefined) patch.name        = name.trim();
    if (unit        !== undefined) patch.unit        = unit.trim();
    if (price_paise !== undefined) patch.price_paise = price_paise;
    if (in_stock    !== undefined) patch.in_stock    = in_stock;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
    const { data, error } = await anonDb
      .from('shop_items')
      .update(patch)
      .eq('id', req.params.itemId)
      .eq('shop_id', req.params.shopId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: 'Failed to update item' });
    res.json({ item: data });
  })
);

// ─── DELETE /:shopId/items/:itemId ────────────────────────────────────────────

router.delete(
  '/:shopId/items/:itemId',
  requireAuth(['shop']),
  requireShopProfile,
  ensureOwnsShop,
  asyncHandler(async (req, res) => {
    const { error } = await anonDb
      .from('shop_items')
      .delete()
      .eq('id', req.params.itemId)
      .eq('shop_id', req.params.shopId);
    if (error) return res.status(500).json({ error: 'Failed to delete item' });
    res.json({ ok: true });
  })
);

module.exports = router;
