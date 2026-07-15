'use strict';

const axios  = require('axios');
const { db } = require('../db');
const { emitToShop, emitToRunner, emitToShops } = require('../socket/index');
const logger = require('../utils/logger');
const {
  EXPO_PUSH_URL,
  EXPO_PUSH_SOUND,
  EXPO_PUSH_PRIORITY,
  EXPO_PUSH_CHANNEL_ID,
} = require('../config/constants');

// ─── Token Helpers ────────────────────────────────────────────────────────────

async function getTokensForUser(userId) {
  const { data, error } = await db
    .from('push_tokens')
    .select('id, token')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (error) {
    logger.warn({ error: error.message, user_id: userId }, 'Failed to fetch push tokens');
    return [];
  }
  return data || [];
}

async function getTokensForUsers(userIds) {
  if (!userIds || userIds.length === 0) return [];

  const { data, error } = await db
    .from('push_tokens')
    .select('id, token, user_id')
    .in('user_id', userIds)
    .eq('is_active', true);

  if (error) {
    logger.warn({ error: error.message }, 'Failed to fetch push tokens for users');
    return [];
  }
  return data || [];
}

function invalidateToken(token) {
  db.from('push_tokens')
    .update({ is_active: false })
    .eq('token', token)
    .then(() => logger.info({ token }, 'Stale push token invalidated'))
    .catch((err) =>
      logger.warn({ error: err.message, token }, 'Failed to invalidate stale push token')
    );
}

// ─── Core Push Sender ─────────────────────────────────────────────────────────

async function sendPush(tokens, title, body, data = {}) {
  if (!tokens || tokens.length === 0) return [];

  const tokenStrings = tokens
    .map((t) => (typeof t === 'string' ? t : t.token))
    .filter((t) => t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));

  if (tokenStrings.length === 0) return [];

  const payload = {
    to:        tokenStrings,
    title,
    body,
    data,
    sound:     EXPO_PUSH_SOUND,
    priority:  EXPO_PUSH_PRIORITY,
    channelId: EXPO_PUSH_CHANNEL_ID,
  };

  try {
    const response = await axios.post(EXPO_PUSH_URL, payload, {
      headers: {
        'Content-Type':    'application/json',
        Accept:            'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      timeout: 10000,
    });

    const tickets = response.data?.data || [];

    tickets.forEach((ticket, i) => {
      if (ticket.status === 'error') {
        const token = tokenStrings[i];
        logger.warn(
          { token, message: ticket.message, details: ticket.details },
          'Push ticket error'
        );
        if (ticket.details?.error === 'DeviceNotRegistered') {
          invalidateToken(token);
        }
      }
    });

    return tickets;
  } catch (err) {
    logger.warn({ error: err.message }, 'Expo push request failed');
    return [];
  }
}

// ─── Domain Notifiers ─────────────────────────────────────────────────────────

async function notifyShop(shopId, socketEvent, socketPayload, pushTitle, pushBody, pushData = {}) {
  emitToShop(shopId, socketEvent, socketPayload);

  if (!pushTitle || !pushBody) return;

  try {
    const { data: shop, error } = await db
      .from('shops')
      .select('user_id')
      .eq('id', shopId)
      .single();

    if (error) {
      logger.warn({ error: error.message, shop_id: shopId }, 'Failed to fetch shop for notification');
      return;
    }

    if (!shop) return;

    const tokens = await getTokensForUser(shop.user_id);
    if (tokens.length > 0) {
      await sendPush(tokens, pushTitle, pushBody, pushData);
    }
  } catch (err) {
    logger.warn({ error: err.message, shop_id: shopId }, 'notifyShop push failed');
  }
}

function notifyShops(shopIds, socketEvent, socketPayload) {
  emitToShops(shopIds, socketEvent, socketPayload);
}

/**
 * Broadcasts one Socket.IO event to N shops AND sends a single batched Expo push
 * to every device registered to those shops' owners.
 *
 * Replaces the legacy pattern of `shops.forEach(s => notifyShop(s.id, ...))`,
 * which fired 2 DB queries + 1 Expo POST per shop. This collapses that into 2
 * batched DB queries + 1 Expo POST regardless of shop count.
 */
async function notifyShopsWithPush(
  shopIds,
  socketEvent,
  socketPayload,
  pushTitle,
  pushBody,
  pushData = {}
) {
  if (!shopIds || shopIds.length === 0) return;

  emitToShops(shopIds, socketEvent, socketPayload);

  if (!pushTitle || !pushBody) return;

  try {
    // Batch 1/2 — resolve shops → owner user_ids in a single query.
    const { data: shops, error } = await db
      .from('shops')
      .select('user_id')
      .in('id', shopIds);

    if (error) {
      logger.warn({ error: error.message, shop_count: shopIds.length }, 'Failed to fetch shops for broadcast push');
      return;
    }

    const userIds = (shops || []).map((s) => s.user_id).filter(Boolean);
    if (userIds.length === 0) return;

    // Batch 2/2 — resolve user_ids → active push tokens in a single query.
    const tokens = await getTokensForUsers(userIds);
    if (tokens.length === 0) return;

    // Single Expo POST for every token at once.
    await sendPush(tokens, pushTitle, pushBody, pushData);
  } catch (err) {
    logger.warn({ error: err.message, shop_count: shopIds.length }, 'notifyShopsWithPush failed');
  }
}

async function notifyRunners(runners, socketEvent, socketPayload, pushTitle, pushBody, pushData = {}) {
  if (!runners || runners.length === 0) return;

  runners.forEach((runner) => emitToRunner(runner.id, socketEvent, socketPayload));

  if (!pushTitle || !pushBody) return;

  try {
    const userIds = runners.map((r) => r.user_id).filter(Boolean);
    const tokens  = await getTokensForUsers(userIds);
    if (tokens.length > 0) {
      await sendPush(tokens, pushTitle, pushBody, pushData);
    }
  } catch (err) {
    logger.warn({ error: err.message }, 'notifyRunners push failed');
  }
}

async function notifyCustomer(customerId, title, body, data = {}) {
  if (!customerId || !title || !body) return;

  try {
    const tokens = await getTokensForUser(customerId);
    if (tokens.length > 0) {
      await sendPush(tokens, title, body, data);
    }
  } catch (err) {
    logger.warn({ error: err.message, customer_id: customerId }, 'notifyCustomer push failed');
  }
}

module.exports = {
  sendPush,
  notifyShop,
  notifyShops,
  notifyShopsWithPush,
  notifyRunners,
  notifyCustomer,
};
