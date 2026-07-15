'use strict';

require('dotenv').config();

const http     = require('http');
const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const pinoHttp = require('pino-http');

const C                = require('./config/constants');
const logger           = require('./utils/logger');
const errorReporter    = require('./utils/errorReporter');
const requestId        = require('./middleware/requestId');
const { globalLimiter } = require('./middleware/rateLimit');
const socketInit       = require('./socket/index');

errorReporter.init();

const authRoute     = require('./routes/auth');
const ordersRoute   = require('./routes/orders');
const shopsRoute    = require('./routes/shops');
const runnersRoute  = require('./routes/runners');
const usersRoute    = require('./routes/users');
const adminRoute    = require('./routes/admin');
const healthRoute   = require('./routes/health');
const messagesRoute   = require('./routes/messages');
const addressesRoute  = require('./routes/addresses');

const orderExpiryJob  = require('./jobs/orderExpiryJob');
const runnerRetryJob  = require('./jobs/runnerRetryJob');
const morningPushJob  = require('./jobs/morningPushJob');

// ─── Environment ──────────────────────────────────────────────────────────────

const PORT     = process.env.PORT     || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const rawOrigins = process.env.CORS_ORIGINS || '*';
const corsOptions = rawOrigins === '*'
  ? { origin: '*' }
  : { origin: rawOrigins.split(',').map(s => s.trim()).filter(Boolean), credentials: true };

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,   // API-only server; CSP belongs on the web dashboards
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
}));
app.use(requestId);
app.use(pinoHttp({ logger }));
app.use(cors(corsOptions));
app.use(express.json({ limit: C.MAX_AUDIO_BASE64_BYTES }));

// ─── Routes ───────────────────────────────────────────────────────────────────

// /health runs BEFORE the global limiter so load balancers and uptime checks
// are never blocked by a 429. Everything else is rate-limited per IP.
app.use('/api/v1/health',  healthRoute);
app.use(globalLimiter);
app.use('/api/v1/auth',    authRoute);
app.use('/api/v1/orders',  ordersRoute);
app.use('/api/v1/shops',   shopsRoute);
app.use('/api/v1/runners',  runnersRoute);
app.use('/api/v1/users',    usersRoute);
app.use('/api/v1/admin',    adminRoute);
app.use('/api/v1/messages',   messagesRoute);
app.use('/api/v1/addresses',  addressesRoute);

// ─── 404 ──────────────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

const isProd = NODE_ENV === 'production';

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status  = err.status || 500;
  const message = (isProd && status === 500)
    ? 'Internal server error'
    : err.message || 'Internal server error';

  if (status >= 500) {
    (req.log || logger).error({ err }, 'Unhandled error');
    // Forward 5xx errors to Sentry. 4xx (client faults, known-safe 409s)
    // intentionally skipped to keep the telemetry signal clean.
    errorReporter.captureException(err, {
      requestId: req.id,
      method:    req.method,
      path:      req.originalUrl,
      userId:    req.user && req.user.userId,
    });
  }

  res.status(status).json({ error: message });
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const httpServer = http.createServer(app);

socketInit.init(httpServer);

orderExpiryJob.start();
runnerRetryJob.start();
morningPushJob.start();

httpServer.listen(PORT, () => {
  logger.info({ port: PORT, env: NODE_ENV }, 'Inkiro backend started');
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal, exitCode = 0) {
  logger.info({ signal }, 'Shutting down');
  orderExpiryJob.stop();
  runnerRetryJob.stop();
  morningPushJob.stop();
  httpServer.close(async () => {
    logger.info('HTTP server closed');
    await errorReporter.flush(2000);
    process.exit(exitCode);
  });

  // Hard-exit safety valve — if httpServer.close() hangs on open connections,
  // don't wedge the container waiting for them.
  setTimeout(() => {
    logger.warn('Forcing exit after shutdown timeout');
    process.exit(exitCode);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── Process-level error guards ───────────────────────────────────────────────
// An uncaught exception leaves Node's state undefined — we log, report, flush,
// then exit. Per Node's guidance, do NOT try to resume after uncaughtException.
// Unhandled promise rejections are logged + reported but do not exit (Node's
// --unhandled-rejections default will eventually trigger uncaughtException
// itself if the app is misconfigured).

process.on('uncaughtException', async (err) => {
  logger.fatal({ err }, 'uncaughtException — shutting down');
  errorReporter.captureException(err, { fatal: true });
  await errorReporter.flush(2000);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error({ err }, 'unhandledRejection');
  errorReporter.captureException(err, { unhandledRejection: true });
});

module.exports = app;
