'use strict';

const cron             = require('node-cron');
const logger           = require('../utils/logger');
const errorReporter    = require('../utils/errorReporter');
const { withCronLock } = require('../utils/cronLock');
const orderService     = require('../services/orderService');
const { CRON_RUNNER_RETRY_SCHEDULE } = require('../config/constants');

let task = null;

function start() {
  if (task) return;

  task = cron.schedule(CRON_RUNNER_RETRY_SCHEDULE, async () => {
    try {
      await withCronLock('runnerRetry', () => orderService.retryRunnerDispatch());
    } catch (err) {
      logger.error({ err }, 'runnerRetryJob: unhandled error');
      errorReporter.captureException(err, { job: 'runnerRetry' });
    }
  });

  logger.info({ schedule: CRON_RUNNER_RETRY_SCHEDULE }, 'runnerRetryJob started');
}

function stop() {
  if (task) {
    task.stop();
    task = null;
    logger.info('runnerRetryJob stopped');
  }
}

module.exports = { start, stop };
