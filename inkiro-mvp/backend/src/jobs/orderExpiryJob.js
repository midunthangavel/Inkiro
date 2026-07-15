'use strict';

const cron              = require('node-cron');
const logger            = require('../utils/logger');
const errorReporter     = require('../utils/errorReporter');
const { withCronLock }  = require('../utils/cronLock');
const orderService      = require('../services/orderService');
const { CRON_ORDER_EXPIRY_SCHEDULE } = require('../config/constants');

let task = null;

function start() {
  if (task) return;

  task = cron.schedule(CRON_ORDER_EXPIRY_SCHEDULE, async () => {
    try {
      await withCronLock('orderExpiry', () => orderService.expireStaleOrders());
    } catch (err) {
      logger.error({ err }, 'orderExpiryJob: unhandled error');
      errorReporter.captureException(err, { job: 'orderExpiry' });
    }
  });

  logger.info({ schedule: CRON_ORDER_EXPIRY_SCHEDULE }, 'orderExpiryJob started');
}

function stop() {
  if (task) {
    task.stop();
    task = null;
    logger.info('orderExpiryJob stopped');
  }
}

module.exports = { start, stop };
