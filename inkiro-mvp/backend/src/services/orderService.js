'use strict';

const { db, anonDb }                                                  = require('../db');
const logger                                                          = require('../utils/logger');
const { notifyShop, notifyShops, notifyShopsWithPush, notifyRunners, notifyCustomer } = require('./notificationService');
const EVENTS                                                          = require('../socket/events');
const C                                                               = require('../config/constants');

// ─── Client Guide ─────────────────────────────────────────────────────────────
//
// anonDb (anon key, Phase 1 RLS) — user-initiated functions:
//   confirmOrder, shopRespond, getOrderById, listOrdersByCustomer
//
// db (service_role, bypasses RLS) — internal / admin / cron functions:
//   _dispatchRunners (fetches ALL runners; no single-user scope)
//   adminAssignRunner, expireStaleOrders, retryRunnerDispatch

// ─── Idempotency store ────────────────────────────────────────────────────────
// Keyed by `${customerId}:${idempotencyKey}` → { orderId, expiresAt }
const _idempotencyCache = new Map();

function _idempotencyKey(customerId, key) { return `${customerId}:${key}`; }

function _checkIdempotency(customerId, key) {
  const entry = _idempotencyCache.get(_idempotencyKey(customerId, key));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _idempotencyCache.delete(_idempotencyKey(customerId, key)); return null; }
  return entry.orderId;
}

function _storeIdempotency(customerId, key, orderId) {
  _idempotencyCache.set(_idempotencyKey(customerId, key), {
    orderId,
    expiresAt: Date.now() + C.IDEMPOTENCY_WINDOW_SECONDS * 1000,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _runnerRadius(attemptNumber) {
  const raw = C.RUNNER_INITIAL_RADIUS_KM * Math.pow(C.RUNNER_RADIUS_MULTIPLIER, attemptNumber - 1);
  return Math.min(raw, C.RUNNER_MAX_RADIUS_KM);
}

// _dispatchRunners runs as an internal system operation (triggered by shop accept
// or cron retry). It needs visibility of ALL available runners, not just those
// belonging to the requesting user. Service role is correct here.
//
// Spatial query: get_nearby_runners (scripts/postgis.sql) uses ST_DWithin on
// the runners.location GEOGRAPHY column — the database returns only runners
// within radius, ordered by distance. Previously this fetched every available
// runner and filtered in JavaScript memory.
async function _dispatchRunners(order, attemptNumber) {
  const radius         = _runnerRadius(attemptNumber);
  const now            = new Date().toISOString();
  const earningsRupees = Math.round(C.RUNNER_EARNING_PAISE / 100);

  const { data: nearby, error } = await db
    .rpc('get_nearby_runners', {
      origin_lat:  order.lat,
      origin_lng:  order.lng,
      radius_km:   radius,
      max_results: C.RUNNER_MAX_PER_DISPATCH,
    });

  if (error) {
    logger.error({ err: error, order_id: order.id }, 'Failed to fetch nearby runners for dispatch');
    return;
  }

  if (!nearby || nearby.length === 0) {
    logger.info({ order_id: order.id, attempt: attemptNumber, radius_km: radius }, 'No runners in radius');

    if (attemptNumber >= C.RUNNER_MAX_DISPATCH_ATTEMPTS) {
      await db.from('orders').update({ status: C.ORDER_STATUS.EXPIRED }).eq('id', order.id);
      logger.warn({ order_id: order.id }, 'Order expired — no runners after max attempts');
      return;
    }

    await db
      .from('orders')
      .update({
        status:             C.ORDER_STATUS.PENDING_RUNNER,
        dispatch_attempts:  attemptNumber,
        last_dispatched_at: now,
      })
      .eq('id', order.id);
    return;
  }

  await notifyRunners(
    nearby,
    EVENTS.JOB_AVAILABLE,
    { order_id: order.id, address: order.address, lat: order.lat, lng: order.lng },
    'New Delivery Job',
    `₹${earningsRupees} · Tap to accept`,
    { order_id: order.id }
  );

  await db
    .from('orders')
    .update({
      status:             C.ORDER_STATUS.RUNNER_NOTIFIED,
      dispatch_attempts:  attemptNumber,
      last_dispatched_at: now,
    })
    .eq('id', order.id);

  logger.info(
    { order_id: order.id, runners_notified: nearby.length, radius_km: radius, attempt: attemptNumber },
    'Runners dispatched'
  );
}

// ─── confirmOrder ─────────────────────────────────────────────────────────────

// Spatial query: get_nearby_shops (scripts/postgis.sql) uses ST_DWithin on
// shops.location GEOGRAPHY — only shops within SHOP_INITIAL_RADIUS_KM are
// returned, sorted by distance. Previously this fetched every active shop and
// filtered the full result set in JavaScript memory.
async function confirmOrder({ customerId, customerPhone, items, address, lat, lng, idempotencyKey }) {
  // customerId is sourced directly from req.user (JWT) in the route — no DB lookup needed.

  if (idempotencyKey) {
    const existingId = _checkIdempotency(customerId, idempotencyKey);
    if (existingId) return { id: existingId, _idempotent: true };
  }

  const { data: nearbyShops, error: shopsErr } = await anonDb
    .rpc('get_nearby_shops', {
      origin_lat: lat,
      origin_lng: lng,
      radius_km:  C.SHOP_INITIAL_RADIUS_KM,
    });

  if (shopsErr) {
    logger.error({ err: shopsErr }, 'Failed to fetch nearby shops for order broadcast');
    throw shopsErr;
  }

  const shops        = nearbyShops || [];
  const broadcastIds = shops.map((s) => s.id);

  const { data: order, error: orderErr } = await anonDb
    .from('orders')
    .insert({
      customer_id:          customerId,
      customer_phone:       customerPhone,
      items,
      address,
      lat,
      lng,
      status:               C.ORDER_STATUS.PENDING,
      platform_fee_paise:   C.PLATFORM_FEE_PAISE,
      delivery_fee_paise:   C.DELIVERY_FEE_PAISE,
      runner_earning_paise: C.RUNNER_EARNING_PAISE,
      broadcast_shop_ids:   broadcastIds,
    })
    .select()
    .single();

  if (orderErr) {
    logger.error({ err: orderErr }, 'Failed to create order');
    throw orderErr;
  }

  if (idempotencyKey) _storeIdempotency(customerId, idempotencyKey, order.id);

  const socketPayload = {
    order_id:   order.id,
    items:      order.items,
    address:    order.address,
    lat:        order.lat,
    lng:        order.lng,
    created_at: order.created_at,
  };

  // Single batched call: one Socket.IO broadcast + one Expo POST for every
  // shop in range. Replaces the per-shop loop that scaled as O(shops).
  notifyShopsWithPush(
    broadcastIds,
    EVENTS.ORDER_NEW,
    socketPayload,
    '🔔 New Order',
    'New order received. Open app to accept.',
    { order_id: order.id }
  ).catch((err) => logger.warn({ err, order_id: order.id }, 'Broadcast notification failed'));

  logger.info({ order_id: order.id, shops_notified: broadcastIds.length }, 'Order created and broadcast');
  return order;
}

// ─── shopRespond ──────────────────────────────────────────────────────────────

async function shopRespond(orderId, shopId, action, declineReason) {
  if (action === 'decline') {
    if (declineReason) {
      await anonDb.from('orders').update({ decline_reason: declineReason }).eq('id', orderId);
    }
    logger.info({ order_id: orderId, shop_id: shopId, decline_reason: declineReason }, 'Shop declined order');
    return { declined: true };
  }

  const handoffCode = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit 1000-9999

  const { data: updated, error } = await anonDb
    .from('orders')
    .update({
      status:       C.ORDER_STATUS.ACCEPTED,
      shop_id:      shopId,
      handoff_code: handoffCode,
      accepted_at:  new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('status', C.ORDER_STATUS.PENDING)
    .select()
    .single();

  if (error || !updated) {
    const err = new Error('Order is no longer available');
    err.status = 409;
    throw err;
  }

  const otherShopIds = (updated.broadcast_shop_ids || []).filter((id) => id !== shopId);
  if (otherShopIds.length > 0) {
    notifyShops(otherShopIds, EVENTS.ORDER_TAKEN, { order_id: orderId });
  }

  await notifyCustomer(
    updated.customer_id,
    '✅ Order Accepted',
    'A shop has accepted your order and is preparing it.',
    { order_id: orderId }
  );

  // _dispatchRunners uses service role (needs full runner visibility).
  await _dispatchRunners(updated, 1);

  // Auto-create customer↔shop chat conversation (fire-and-forget)
  const messageService = require('./messageService');
  messageService.autoCreateForOrder(updated).catch(
    (err) => logger.warn({ err, order_id: orderId }, 'autoCreateForOrder failed')
  );

  logger.info({ order_id: orderId, shop_id: shopId }, 'Shop accepted order');
  return updated;
}

// ─── getOrderById ─────────────────────────────────────────────────────────────
// Internal fetch — no ownership check. Use getOrderByIdForUser in routes.

async function getOrderById(orderId) {
  const { data, error } = await anonDb
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (error || !data) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  return data;
}

// ─── getOrderByIdForUser ──────────────────────────────────────────────────────
// Ownership-checked fetch. Throws 403 unless the requesting user is:
//   customer  — owns the order
//   shop      — accepted shop or in the broadcast list
//   runner    — assigned runner

async function _userOwnsShop(userId, shopId) {
  if (!shopId) return false;
  const { data } = await anonDb.from('shops').select('id').eq('user_id', userId).eq('id', shopId).maybeSingle();
  return !!data;
}

async function _userOwnsRunner(userId, runnerId) {
  if (!runnerId) return false;
  const { data } = await anonDb.from('runners').select('id').eq('user_id', userId).eq('id', runnerId).maybeSingle();
  return !!data;
}

async function _userInBroadcast(userId, broadcastShopIds) {
  if (!broadcastShopIds || broadcastShopIds.length === 0) return false;
  const { data } = await anonDb.from('shops').select('id').eq('user_id', userId).in('id', broadcastShopIds).maybeSingle();
  return !!data;
}

async function getOrderByIdForUser(orderId, user) {
  const order = await getOrderById(orderId);

  if (user.role === 'customer' && order.customer_id === user.userId) return order;

  if (user.role === 'shop') {
    if (await _userOwnsShop(user.userId, order.shop_id)) return order;
    if (await _userInBroadcast(user.userId, order.broadcast_shop_ids)) return order;
  }

  if (user.role === 'runner' && await _userOwnsRunner(user.userId, order.runner_id)) return order;

  throw Object.assign(new Error('Forbidden'), { status: 403 });
}

// ─── cancelOrder ──────────────────────────────────────────────────────────────
// Customer-only cancel. Atomic UPDATE guards against double-cancel race.
// Frees any assigned runner on success.

async function cancelOrder(orderId, userId) {
  const order = await getOrderById(orderId);

  if (order.customer_id !== userId) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }

  const cancellable = ['pending', 'pending_runner', 'runner_notified', 'accepted', 'runner_assigned'];
  if (!cancellable.includes(order.status)) {
    throw Object.assign(new Error('Order cannot be cancelled at this stage'), { status: 400 });
  }

  const { data: updated, error } = await anonDb
    .from('orders')
    .update({
      status:       'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: 'customer',
    })
    .eq('id', orderId)
    .in('status', cancellable)
    .select()
    .single();

  if (error || !updated) {
    throw Object.assign(new Error('Order is no longer cancellable'), { status: 409 });
  }

  if (updated.runner_id) {
    await anonDb.from('runners').update({ is_available: true }).eq('id', updated.runner_id);
  }

  logger.info({ order_id: orderId, customer_id: userId }, 'Order cancelled by customer');
  return updated;
}

// ─── listOrdersByCustomer ─────────────────────────────────────────────────────

async function listOrdersByCustomer(customerId) {
  const { data, error } = await anonDb
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    logger.error({ err: error, customer_id: customerId }, 'Failed to list customer orders');
    throw error;
  }

  return data || [];
}

// ─── adminAssignRunner ────────────────────────────────────────────────────────

async function adminAssignRunner(orderId, runnerId) {
  const { data: order, error: orderErr } = await db
    .from('orders')
    .select('id, lat, lng, address')
    .eq('id', orderId)
    .single();

  if (orderErr || !order) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  const { data: runner, error: runnerErr } = await db
    .from('runners')
    .select('id, user_id')
    .eq('id', runnerId)
    .single();

  if (runnerErr || !runner) {
    const err = new Error('Runner not found');
    err.status = 404;
    throw err;
  }

  const { data: updated, error } = await db
    .from('orders')
    .update({ status: C.ORDER_STATUS.RUNNER_NOTIFIED, runner_id: runnerId })
    .eq('id', orderId)
    .select()
    .single();

  if (error) {
    logger.error({ err: error, order_id: orderId, runner_id: runnerId }, 'Failed to admin-assign runner');
    throw error;
  }

  const earningsRupees = Math.round(C.RUNNER_EARNING_PAISE / 100);
  await notifyRunners(
    [runner],
    EVENTS.JOB_AVAILABLE,
    { order_id: orderId, address: order.address, lat: order.lat, lng: order.lng },
    'New Delivery Job',
    `₹${earningsRupees} · You have been assigned a delivery.`,
    { order_id: orderId }
  );

  logger.info({ order_id: orderId, runner_id: runnerId }, 'Admin assigned runner');
  return updated;
}

// ─── expireStaleOrders (cron) ─────────────────────────────────────────────────

async function expireStaleOrders() {
  const broadcastCutoff = new Date(Date.now() - C.ORDER_BROADCAST_WINDOW_SECONDS * 1000).toISOString();
  const graceCutoff     = new Date(Date.now() - C.ORDER_ESCALATION_GRACE_SECONDS  * 1000).toISOString();

  const { data: toEscalate, error: escalateErr } = await db
    .from('orders')
    .select('id, lat, lng, broadcast_shop_ids')
    .eq('status', C.ORDER_STATUS.PENDING)
    .lt('created_at', broadcastCutoff)
    .is('escalated_at', null);

  if (escalateErr) {
    logger.error({ err: escalateErr }, 'expireStaleOrders: escalation query failed');
  } else if (toEscalate && toEscalate.length > 0) {
    for (const order of toEscalate) {
      // Spatial query per order: get_nearby_shops returns only shops within the
      // escalation radius for this specific order's location. Previously the
      // codebase fetched all active shops once and filtered in JS per order.
      const { data: widerShops, error: shopErr } = await db
        .rpc('get_nearby_shops', {
          origin_lat: order.lat,
          origin_lng: order.lng,
          radius_km:  C.SHOP_ESCALATION_RADIUS_KM,
        });

      if (shopErr) {
        logger.warn({ err: shopErr, order_id: order.id }, 'Failed to fetch nearby shops for escalation');
        continue;
      }

      const nearby      = widerShops || [];
      const existingIds = order.broadcast_shop_ids || [];
      const newShops    = nearby.filter((s) => !existingIds.includes(s.id));
      const allShopIds  = [...new Set([...existingIds, ...nearby.map((s) => s.id)])];

      await db
        .from('orders')
        .update({ escalated_at: new Date().toISOString(), broadcast_shop_ids: allShopIds })
        .eq('id', order.id);

      const socketPayload = { order_id: order.id };
      newShops.forEach((shop) =>
        notifyShop(
          shop.id,
          EVENTS.ORDER_NEW,
          socketPayload,
          '🔔 New Order',
          'New order received. Open app to accept.',
          { order_id: order.id }
        ).catch((err) => logger.warn({ err, shop_id: shop.id, order_id: order.id }, 'Escalation notify failed'))
      );

      logger.info(
        { order_id: order.id, new_shops_notified: newShops.length },
        'Order escalated to wider radius'
      );
    }
  }

  const { data: expired, error: expireErr } = await db
    .from('orders')
    .update({ status: C.ORDER_STATUS.EXPIRED })
    .eq('status', C.ORDER_STATUS.PENDING)
    .lt('escalated_at', graceCutoff)
    .select('id');

  if (expireErr) {
    logger.error({ err: expireErr }, 'expireStaleOrders: expiry query failed');
    return;
  }

  if (expired && expired.length > 0) {
    logger.info({ count: expired.length }, 'Expired stale orders after grace period');
  }
}

// ─── retryRunnerDispatch (cron) ───────────────────────────────────────────────

async function retryRunnerDispatch() {
  const retryCutoff = new Date(Date.now() - C.RUNNER_RETRY_INTERVAL_SECONDS * 1000).toISOString();

  const { data: orders, error } = await db
    .from('orders')
    .select('id, lat, lng, address, dispatch_attempts')
    .in('status', [C.ORDER_STATUS.PENDING_RUNNER, C.ORDER_STATUS.RUNNER_NOTIFIED])
    .lt('last_dispatched_at', retryCutoff);

  if (error) {
    logger.error({ err: error }, 'retryRunnerDispatch: DB error');
    return;
  }

  if (!orders || orders.length === 0) return;

  for (const order of orders) {
    const nextAttempt = (order.dispatch_attempts || 0) + 1;

    if (nextAttempt > C.RUNNER_MAX_DISPATCH_ATTEMPTS) {
      await db.from('orders').update({ status: C.ORDER_STATUS.EXPIRED }).eq('id', order.id);
      logger.warn({ order_id: order.id }, 'Order expired — exceeded max dispatch attempts');
      continue;
    }

    await _dispatchRunners(order, nextAttempt);
  }
}

// ─── markReady ────────────────────────────────────────────────────────────────

async function markReady(orderId, shopId) {
  const { data: updated, error } = await anonDb
    .from('orders')
    .update({ ready_for_pickup_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('shop_id', shopId)
    .select()
    .single();

  if (error || !updated) {
    const err = new Error('Order not found or not owned by this shop');
    err.status = 404;
    throw err;
  }

  await notifyCustomer(
    updated.customer_id,
    'Packed',
    'Your shop has packed the order. Runner is on the way.',
    { order_id: orderId }
  );

  logger.info({ order_id: orderId, shop_id: shopId }, 'Order marked ready for pickup');
  return updated;
}

// ─── rateOrder ────────────────────────────────────────────────────────────────

async function rateOrder(orderId, customerId, rating, comment) {
  const { data: order, error: findErr } = await anonDb
    .from('orders')
    .select('id, status, runner_id, rating')
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .single();

  if (findErr || !order) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }
  if (order.status !== C.ORDER_STATUS.DELIVERED) {
    const err = new Error('Only delivered orders can be rated');
    err.status = 400;
    throw err;
  }
  if (order.rating) {
    const err = new Error('Already rated');
    err.status = 409;
    throw err;
  }

  const { error: updErr } = await anonDb
    .from('orders')
    .update({
      rating,
      rating_comment: comment || null,
      rated_at:       new Date().toISOString(),
    })
    .eq('id', orderId);

  if (updErr) throw updErr;

  if (order.runner_id) {
    await db.rpc('increment_runner_rating', { r_id: order.runner_id, delta: rating });
  }

  logger.info({ order_id: orderId, customer_id: customerId, rating }, 'Order rated');
  return { ok: true };
}

// ─── listOrdersByRunner ───────────────────────────────────────────────────────

async function listOrdersByRunner(runnerId, opts = {}) {
  const { limit = 50, onlyDelivered = false } = opts;
  let query = anonDb
    .from('orders')
    .select('*')
    .eq('runner_id', runnerId)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (onlyDelivered) query = query.eq('status', C.ORDER_STATUS.DELIVERED);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

module.exports = {
  confirmOrder,
  shopRespond,
  markReady,
  rateOrder,
  getOrderById,
  getOrderByIdForUser,
  cancelOrder,
  listOrdersByCustomer,
  listOrdersByRunner,
  adminAssignRunner,
  expireStaleOrders,
  retryRunnerDispatch,
};
