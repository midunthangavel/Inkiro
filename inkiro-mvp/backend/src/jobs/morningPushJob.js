'use strict';

const cron          = require('node-cron');
const logger        = require('../utils/logger');
const errorReporter = require('../utils/errorReporter');
const { db }        = require('../db');
const { sendPush }  = require('../services/notificationService');

let morningTask = null;
let nightTask   = null;

async function _getRunnerTokens() {
  const { data: runners, error: rErr } = await db
    .from('runners')
    .select('user_id');

  if (rErr || !runners || runners.length === 0) return [];

  const userIds = runners.map((r) => r.user_id).filter(Boolean);
  if (userIds.length === 0) return [];

  const { data: tokenRows, error: tErr } = await db
    .from('push_tokens')
    .select('token')
    .in('user_id', userIds)
    .eq('is_active', true);

  if (tErr) {
    logger.warn({ error: tErr.message }, 'morningPushJob: failed to fetch runner tokens');
    return [];
  }

  return tokenRows || [];
}

async function _getOnlineRunnerTokens() {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // active in last 1h

  const { data: runners, error: rErr } = await db
    .from('runners')
    .select('id, user_id')
    .or(`is_available.eq.true,last_seen_at.gte.${cutoff}`);

  if (rErr || !runners || runners.length === 0) return [];

  const userIds = runners.map((r) => r.user_id).filter(Boolean);
  const { data: tokenRows } = await db
    .from('push_tokens')
    .select('token, user_id')
    .in('user_id', userIds)
    .eq('is_active', true);

  // Attach runner profile id so we can look up earnings per runner_id directly.
  const profileById = new Map(runners.map((r) => [r.user_id, r.id]));
  return (tokenRows || []).map((t) => ({ ...t, runner_id: profileById.get(t.user_id) }));
}

async function _getDailyEarningsByRunner(runnerIds) {
  if (runnerIds.length === 0) return new Map();
  const C = require('../config/constants');
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Filter by runner_id directly — avoids a nested join filter.
  const { data: rows, error } = await db
    .from('orders')
    .select('runner_id, runner_earning_paise')
    .gte('completed_at', todayStart.toISOString())
    .eq('status', C.ORDER_STATUS.DELIVERED)
    .in('runner_id', runnerIds);

  if (error) {
    logger.warn({ error: error.message }, 'morningPushJob: failed to fetch daily earnings');
    return new Map();
  }

  const byRunner = new Map();
  for (const row of rows || []) {
    const rid = row.runner_id;
    if (rid) byRunner.set(rid, (byRunner.get(rid) || 0) + (row.runner_earning_paise || 0));
  }
  return byRunner;
}

function start() {
  if (morningTask && nightTask) return;

  // 8 AM daily — wake up runners
  morningTask = cron.schedule('0 8 * * *', async () => {
    try {
      const tokens = await _getRunnerTokens();
      if (tokens.length > 0) {
        await sendPush(
          tokens,
          '☀️ Good morning!',
          'Ready for deliveries? Go online to start earning.',
          { type: 'morning_push' }
        );
        logger.info({ token_count: tokens.length }, 'Morning push sent to runners');
      }
    } catch (err) {
      logger.error({ err }, 'morningPushJob (morning): error');
      errorReporter.captureException(err, { job: 'morningPush' });
    }
  });

  // 10 PM daily — personalised day-end summary for runners who were online
  nightTask = cron.schedule('0 22 * * *', async () => {
    try {
      const tokenRows = await _getOnlineRunnerTokens();
      if (tokenRows.length === 0) return;

      const runnerIds = [...new Set(tokenRows.map((t) => t.runner_id).filter(Boolean))];
      const byRunner  = await _getDailyEarningsByRunner(runnerIds);

      // One push per token with that runner's personal total — not a platform aggregate.
      await Promise.all(tokenRows.map((t) => {
        const earned = Math.round((byRunner.get(t.runner_id) || 0) / 100);
        const body = earned > 0
          ? `You earned ₹${earned} today. Rest up for tomorrow!`
          : 'Get a head start tomorrow. Rest up!';
        return sendPush([t], '🌙 Great day!', body, { type: 'night_push' });
      }));

      logger.info({ token_count: tokenRows.length }, 'Night push sent to runners');
    } catch (err) {
      logger.error({ err }, 'morningPushJob (night): error');
      errorReporter.captureException(err, { job: 'nightPush' });
    }
  });

  logger.info('morningPushJob started (8 AM morning, 10 PM night)');
}

function stop() {
  if (morningTask) { morningTask.stop(); morningTask = null; }
  if (nightTask)   { nightTask.stop();   nightTask   = null; }
  logger.info('morningPushJob stopped');
}

module.exports = { start, stop };
