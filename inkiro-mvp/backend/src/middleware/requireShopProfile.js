'use strict';

const { anonDb } = require('../db');

/**
 * Resolves the authenticated user's shop row and attaches it to req.shop.
 *
 * Must run AFTER requireAuth(['shop']). Deriving the shop id from the JWT
 * subject (instead of the request body) closes the IDOR class of bugs where
 * a malicious shop owner could respond to or mutate another shop's orders.
 *
 * - 404 if the authenticated user has no shop profile yet.
 * - Populates req.shop = { id, user_id, is_active }
 */
async function requireShopProfile(req, res, next) {
  try {
    const { data, error } = await anonDb
      .from('shops')
      .select('id, user_id, is_active, is_blocked')
      .eq('user_id', req.user.userId)
      .maybeSingle();

    if (error) return next(error);
    if (!data) return res.status(404).json({ error: 'Shop profile not found' });
    if (data.is_blocked) return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });

    req.shop = data;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = requireShopProfile;
