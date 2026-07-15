'use strict';

const { db, anonDb } = require('../db');
const logger         = require('../utils/logger');

// ─── Client Guide ─────────────────────────────────────────────────────────────
//
// anonDb — all user-facing functions (registerShop, getShopById, getShopByUserId,
//           getOrdersForShop). Subject to Phase 1 RLS policies.
//
// db     — listShops is called only from admin routes and needs full table access.

// ─── registerShop ─────────────────────────────────────────────────────────────

async function registerShop(userId, { shopName, address, lat, lng }) {
  const { data: existing } = await anonDb
    .from('shops')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    const err = new Error('User already has a registered shop');
    err.status = 409;
    throw err;
  }

  const { data: shop, error } = await anonDb
    .from('shops')
    .insert({
      user_id:   userId,
      shop_name: shopName,
      address,
      lat,
      lng,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    logger.error({ err: error, user_id: userId }, 'Failed to register shop');
    throw error;
  }

  logger.info({ shop_id: shop.id, user_id: userId }, 'Shop registered');
  return shop;
}

// ─── updateShop ───────────────────────────────────────────────────────────────

async function updateShop(shopId, userId, { shopName, address, lat, lng }) {
  // Verify ownership before updating
  const { data: existing, error: fetchErr } = await anonDb
    .from('shops')
    .select('id, user_id')
    .eq('id', shopId)
    .single();

  if (fetchErr || !existing) {
    const err = new Error('Shop not found');
    err.status = 404;
    throw err;
  }

  if (existing.user_id !== userId) {
    const err = new Error('Forbidden: you do not own this shop');
    err.status = 403;
    throw err;
  }

  const patch = {};
  if (shopName !== undefined) patch.shop_name = shopName;
  if (address  !== undefined) patch.address   = address;
  if (lat      !== undefined) patch.lat       = lat;
  if (lng      !== undefined) patch.lng       = lng;

  if (Object.keys(patch).length === 0) {
    const err = new Error('No fields to update');
    err.status = 400;
    throw err;
  }

  const { data: shop, error } = await anonDb
    .from('shops')
    .update(patch)
    .eq('id', shopId)
    .select()
    .single();

  if (error) {
    logger.error({ err: error, shop_id: shopId }, 'Failed to update shop');
    throw error;
  }

  logger.info(
    { shop_id: shopId, user_id: userId, fields: Object.keys(patch) },
    'Shop updated',
  );
  return shop;
}

// ─── getShopById ──────────────────────────────────────────────────────────────

async function getShopById(shopId) {
  const { data, error } = await anonDb
    .from('shops')
    .select('*')
    .eq('id', shopId)
    .single();

  if (error || !data) {
    const err = new Error('Shop not found');
    err.status = 404;
    throw err;
  }

  return data;
}

// ─── getShopByUserId ──────────────────────────────────────────────────────────

async function getShopByUserId(userId) {
  const { data, error } = await anonDb
    .from('shops')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, user_id: userId }, 'Failed to fetch shop by user');
    throw error;
  }

  if (!data) {
    const err = new Error('Shop not found for this user');
    err.status = 404;
    throw err;
  }

  return data;
}

// ─── getOrdersForShop ─────────────────────────────────────────────────────────

async function getOrdersForShop(shopId, { status } = {}) {
  let query = anonDb
    .from('orders')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;

  if (error) {
    logger.error({ err: error, shop_id: shopId }, 'Failed to fetch shop orders');
    throw error;
  }

  return data || [];
}

// ─── listShops (admin only) ───────────────────────────────────────────────────

async function listShops() {
  const { data, error } = await db
    .from('shops')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ err: error }, 'Failed to list shops');
    throw error;
  }

  return data || [];
}

module.exports = {
  registerShop,
  updateShop,
  getShopById,
  getShopByUserId,
  getOrdersForShop,
  listShops,
};
