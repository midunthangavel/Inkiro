'use strict';

const { db, anonDb }                         = require('../db');
const logger                                 = require('../utils/logger');
const { emitToShop }                         = require('../socket/index');
const { notifyShop, notifyCustomer }         = require('./notificationService');
const EVENTS                                 = require('../socket/events');
const C                                      = require('../config/constants');

// ─── Client Guide ─────────────────────────────────────────────────────────────
//
// anonDb — all user-facing reads and writes (job acceptance, location updates,
//           profile updates, earnings queries, order/runner fetches).
//
// db     — runner settlement INSERT only. Settlements are a financial record and
//          must be written by service role regardless of who triggers delivery
//          completion. This keeps settlements out of reach of the anon key even
//          if it were ever leaked.

// ─── acceptJob ────────────────────────────────────────────────────────────────

async function acceptJob(runnerId, orderId) {
  const { data: updated, error } = await anonDb
    .from('orders')
    .update({ runner_id: runnerId, status: C.ORDER_STATUS.RUNNER_ASSIGNED })
    .eq('id', orderId)
    .is('runner_id', null)
    .in('status', [C.ORDER_STATUS.RUNNER_NOTIFIED, C.ORDER_STATUS.PENDING_RUNNER])
    .select()
    .single();

  // Postgres code 23505 = unique_violation on uniq_runner_active_order. The
  // runner already has an active order — this catches the double-tap race
  // that the row-level WHERE clause on `orders` cannot see.
  if (error && error.code === '23505') {
    const err = new Error('You already have an active order');
    err.status = 409;
    throw err;
  }

  if (error || !updated) {
    const err = new Error('Job is no longer available');
    err.status = 409;
    throw err;
  }

  await anonDb.from('runners').update({ is_available: false }).eq('id', runnerId);

  await notifyShop(
    updated.shop_id,
    EVENTS.RUNNER_ASSIGNED,
    { order_id: orderId, runner_id: runnerId },
    '🏃 Runner Assigned',
    'A runner is on the way to pick up the order.',
    { order_id: orderId }
  );

  await notifyCustomer(
    updated.customer_id,
    '🏃 Runner Assigned',
    'A runner is on their way to pick up your order.',
    { order_id: orderId }
  );

  // Auto-create customer↔runner and shop↔runner chat conversations
  const messageService = require('./messageService');
  messageService.autoCreateRunnerConversations(updated).catch(
    (err) => logger.warn({ err, order_id: orderId }, 'autoCreateRunnerConversations failed')
  );

  logger.info({ order_id: orderId, runner_id: runnerId }, 'Runner accepted job');
  return updated;
}

// ─── updateStatus ─────────────────────────────────────────────────────────────

async function updateStatus(runnerId, orderId, status) {
  const { data: order, error: fetchErr } = await anonDb
    .from('orders')
    .select('id, status, shop_id, customer_id, runner_id, runner_earning_paise')
    .eq('id', orderId)
    .single();

  if (fetchErr || !order) {
    const err = new Error('Order not found');
    err.status = 404;
    throw err;
  }

  if (order.runner_id !== runnerId) {
    const err = new Error('Not your order');
    err.status = 403;
    throw err;
  }

  const allowedNext = C.VALID_STATUS_TRANSITIONS[order.status];
  if (!allowedNext || allowedNext !== status) {
    const err = new Error(`Cannot transition from ${order.status} to ${status}`);
    err.status = 422;
    throw err;
  }

  const patch = { status };
  if (status === C.ORDER_STATUS.PICKED_UP) patch.picked_up_at = new Date().toISOString();
  if (status === C.ORDER_STATUS.DELIVERED) patch.completed_at = new Date().toISOString();

  const { data: updated, error } = await anonDb
    .from('orders')
    .update(patch)
    .eq('id', orderId)
    .select()
    .single();

  if (error) {
    logger.error({ err: error, order_id: orderId, status }, 'Failed to update order status');
    throw error;
  }

  if (status === C.ORDER_STATUS.PICKED_UP) {
    emitToShop(order.shop_id, EVENTS.ORDER_PICKED_UP, { order_id: orderId });
    await notifyCustomer(
      order.customer_id,
      '🛵 Order Picked Up',
      'Runner is on the way to your location!',
      { order_id: orderId }
    );
  }

  if (status === C.ORDER_STATUS.DELIVERED) {
    await anonDb.from('runners').update({ is_available: true }).eq('id', runnerId);

    const { data: runner } = await anonDb
      .from('runners')
      .select('total_earnings, streak_count, last_delivery_date, xp, level, total_deliveries')
      .eq('id', runnerId)
      .single();

    // Earnings update
    await anonDb
      .from('runners')
      .update({ total_earnings: (runner?.total_earnings || 0) + order.runner_earning_paise })
      .eq('id', runnerId);

    // Settlement INSERT uses service role — financial records must not be
    // writable via the anon key even if a Phase 1 anon policy were ever added.
    await db.from('runner_settlements').insert({
      runner_id:    runnerId,
      order_id:     orderId,
      amount_paise: order.runner_earning_paise,
      created_at:   new Date().toISOString(),
    });

    // Streak and XP update (only once per day)
    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (runner && runner.last_delivery_date !== today) {
      const newStreak    = runner.last_delivery_date === yesterday ? (runner.streak_count || 0) + 1 : 1;
      const newXp        = (runner.xp || 0) + 50;
      const newDeliveries = (runner.total_deliveries || 0) + 1;
      const LEVEL_XP     = [0, 250, 600, 1200, 2500, 5000];
      let   newLevel     = 1;
      for (let i = LEVEL_XP.length - 1; i >= 0; i--) {
        if (newXp >= LEVEL_XP[i]) { newLevel = i + 1; break; }
      }
      await anonDb.from('runners').update({
        streak_count:       newStreak,
        last_delivery_date: today,
        xp:                 newXp,
        level:              newLevel,
        total_deliveries:   newDeliveries,
      }).eq('id', runnerId);
    }

    await notifyShop(
      order.shop_id,
      'order:delivered',
      { order_id: orderId },
      '📦 Order Complete',
      `Order #${orderId.slice(0, 8)} delivered successfully.`,
      { order_id: orderId }
    );

    await notifyCustomer(
      order.customer_id,
      '📦 Order Delivered',
      'Your order has been delivered. Enjoy!',
      { order_id: orderId }
    );
  }

  logger.info({ order_id: orderId, runner_id: runnerId, status }, 'Order status updated');
  return updated;
}

// ─── updateLocation ───────────────────────────────────────────────────────────

async function updateLocation(runnerId, lat, lng, isAvailable) {
  const { error } = await anonDb
    .from('runners')
    .update({
      current_lat:  lat,
      current_lng:  lng,
      is_available: isAvailable,
      last_seen_at: new Date().toISOString(),
    })
    .eq('id', runnerId);

  if (error) {
    logger.error({ err: error, runner_id: runnerId }, 'Failed to update runner location');
    throw error;
  }
}

// ─── updateProfile ────────────────────────────────────────────────────────────

async function updateProfile(runnerId, { vehicleType, upiId }) {
  const validVehicleTypes = Object.values(C.VEHICLE_TYPES);
  if (vehicleType !== undefined && !validVehicleTypes.includes(vehicleType)) {
    const err = new Error(`vehicle_type must be one of: ${validVehicleTypes.join(', ')}`);
    err.status = 422;
    throw err;
  }

  const patch = {};
  if (vehicleType !== undefined) patch.vehicle_type = vehicleType;
  if (upiId       !== undefined) patch.upi_id       = upiId;

  if (Object.keys(patch).length === 0) return;

  const { error } = await anonDb
    .from('runners')
    .update(patch)
    .eq('id', runnerId);

  if (error) {
    logger.error({ err: error, runner_id: runnerId }, 'Failed to update runner profile');
    throw error;
  }
}

// ─── getRunnerById ────────────────────────────────────────────────────────────

async function getRunnerById(runnerId) {
  const { data, error } = await anonDb
    .from('runners')
    .select('*')
    .eq('id', runnerId)
    .single();

  if (error || !data) {
    const err = new Error('Runner not found');
    err.status = 404;
    throw err;
  }

  return data;
}

// ─── getRunnerByUserId ────────────────────────────────────────────────────────

async function getRunnerByUserId(userId) {
  const { data, error } = await anonDb
    .from('runners')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, user_id: userId }, 'Failed to fetch runner by user');
    throw error;
  }

  if (!data) {
    const err = new Error('Runner profile not found');
    err.status = 404;
    throw err;
  }

  return data;
}

// ─── getActiveOrder ───────────────────────────────────────────────────────────

async function getActiveOrder(runnerId) {
  const { data, error } = await anonDb
    .from('orders')
    .select('*, shops(shop_name, address, lat, lng)')
    .eq('runner_id', runnerId)
    .in('status', [C.ORDER_STATUS.RUNNER_ASSIGNED, C.ORDER_STATUS.PICKED_UP])
    .maybeSingle();

  if (error) {
    logger.error({ err: error, runner_id: runnerId }, 'Failed to fetch active order');
    throw error;
  }

  return data;
}

// ─── getEarnings ──────────────────────────────────────────────────────────────

async function getEarnings(runnerId) {
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const todayStr = todayMidnight.toISOString();

  // Last 7 days starting 6 days ago, oldest first
  const days7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(todayMidnight);
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const since7Str = days7[0].toISOString();

  const [runnerRes, todayRes, allTimeRes, weekRes] = await Promise.all([
    anonDb.from('runners').select('total_earnings').eq('id', runnerId).single(),

    anonDb.from('orders')
      .select('runner_earning_paise')
      .eq('runner_id', runnerId)
      .eq('status', C.ORDER_STATUS.DELIVERED)
      .gte('completed_at', todayStr),

    anonDb.from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('runner_id', runnerId)
      .eq('status', C.ORDER_STATUS.DELIVERED),

    anonDb.from('orders')
      .select('runner_earning_paise, completed_at')
      .eq('runner_id', runnerId)
      .eq('status', C.ORDER_STATUS.DELIVERED)
      .gte('completed_at', since7Str),
  ]);

  if (runnerRes.error) {
    logger.error({ err: runnerRes.error, runner_id: runnerId }, 'Failed to fetch runner earnings');
    throw runnerRes.error;
  }

  const todayOrders = todayRes.data || [];
  const weekOrders  = weekRes.data  || [];

  const daily = days7.map(dayStart => {
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const earn = weekOrders
      .filter(o => {
        const t = new Date(o.completed_at).getTime();
        return t >= dayStart.getTime() && t < dayEnd.getTime();
      })
      .reduce((s, o) => s + (o.runner_earning_paise || 0), 0);
    return { earnings_paise: earn };
  });

  return {
    today_total:     todayOrders.reduce((sum, o) => sum + (o.runner_earning_paise || 0), 0),
    total_earnings:  runnerRes.data?.total_earnings || 0,
    today_orders:    todayOrders.length,
    all_time_orders: allTimeRes.count || 0,
    daily,
  };
}

// ─── requestWithdrawal ────────────────────────────────────────────────────────

async function requestWithdrawal(runnerId, amountPaise) {
  const { data: runner, error: re } = await anonDb
    .from('runners')
    .select('upi_id, total_earnings')
    .eq('id', runnerId)
    .single();

  if (re) throw re;
  if (!runner.upi_id) throw Object.assign(new Error('UPI ID not set in your profile'), { status: 400 });
  if (amountPaise <= 0)                   throw Object.assign(new Error('Nothing to withdraw'), { status: 400 });
  if (amountPaise > runner.total_earnings) throw Object.assign(new Error('Amount exceeds earnings'), { status: 400 });

  const { data, error } = await db
    .from('withdrawal_requests')
    .insert({ runner_id: runnerId, amount_paise: amountPaise, upi_id: runner.upi_id })
    .select()
    .single();

  if (error) {
    logger.error({ err: error, runner_id: runnerId }, 'Failed to create withdrawal request');
    throw error;
  }

  return data;
}

module.exports = {
  acceptJob,
  updateStatus,
  updateLocation,
  updateProfile,
  getRunnerById,
  getRunnerByUserId,
  getActiveOrder,
  getEarnings,
  requestWithdrawal,
};
