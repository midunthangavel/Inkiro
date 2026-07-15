'use strict';

const { anonDb } = require('../db');

/**
 * Resolves the authenticated user's runner row and attaches it to req.runner.
 *
 * Must run AFTER requireAuth(['runner']). By deriving the runner id from the
 * JWT subject (not request body), this middleware closes the IDOR class of
 * bugs where a malicious runner could pass another runner's id and mutate
 * their state.
 *
 * - 404 if the authenticated user has no runner profile yet.
 * - Populates req.runner = { id, user_id, is_available, is_verified }
 */
async function requireRunnerProfile(req, res, next) {
  try {
    const { data, error } = await anonDb
      .from('runners')
      .select('id, user_id, is_available, is_verified, is_blocked')
      .eq('user_id', req.user.userId)
      .maybeSingle();

    if (error) return next(error);
    if (!data) return res.status(404).json({ error: 'Runner profile not found' });
    if (data.is_blocked) return res.status(403).json({ error: 'Your account has been suspended. Contact support.' });

    req.runner = data;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = requireRunnerProfile;
