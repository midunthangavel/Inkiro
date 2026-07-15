'use strict';

const { anonDb } = require('../db');
const logger     = require('../utils/logger');

// ─── Client Guide ─────────────────────────────────────────────────────────────
//
// anonDb — all user-facing reads and writes. Users can only read/update their
//          own profile (enforced at the route layer via JWT userId check).

const PUBLIC_FIELDS =
  'id, phone, name, role, default_address, default_lat, default_lng, created_at';

// ─── getUserById ──────────────────────────────────────────────────────────────

async function getUserById(userId) {
  const { data, error } = await anonDb
    .from('users')
    .select(PUBLIC_FIELDS)
    .eq('id', userId)
    .single();

  if (error || !data) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  return data;
}

// ─── updateUser ───────────────────────────────────────────────────────────────

async function updateUser(userId, { name, defaultAddress, defaultLat, defaultLng }) {
  const patch = {};
  if (name           !== undefined) patch.name            = name;
  if (defaultAddress !== undefined) patch.default_address = defaultAddress;
  if (defaultLat     !== undefined) patch.default_lat     = defaultLat;
  if (defaultLng     !== undefined) patch.default_lng     = defaultLng;

  if (Object.keys(patch).length === 0) {
    const err = new Error('No fields to update');
    err.status = 400;
    throw err;
  }

  const { data, error } = await anonDb
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select(PUBLIC_FIELDS)
    .single();

  if (error) {
    logger.error({ err: error, user_id: userId }, 'Failed to update user');
    throw error;
  }

  logger.info({ user_id: userId, fields: Object.keys(patch) }, 'User updated');
  return data;
}

module.exports = {
  getUserById,
  updateUser,
};
