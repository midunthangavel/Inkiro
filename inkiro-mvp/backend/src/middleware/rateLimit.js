'use strict';

const rateLimit = require('express-rate-limit');

const skipInTest = () => process.env.NODE_ENV === 'test';

// ─── OTP send: 5 requests per phone/IP per 15 minutes ────────────────────────

const sendOtpLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            5,
  standardHeaders: true,
  legacyHeaders:  false,
  skip:           skipInTest,
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many OTP requests — please wait 15 minutes before trying again' }),
});

// ─── OTP verify: 10 attempts per phone per 10 minutes ────────────────────────
// Keyed by phone number so rotating IPs cannot bypass per-phone brute-force
// protection. Falls back to IP when phone is absent (e.g. malformed request).

const verifyOtpLimiter = rateLimit({
  windowMs:        10 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            skipInTest,
  keyGenerator:    (req) => req.body?.phone || req.ip,
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many verification attempts — please wait 10 minutes before trying again' }),
});

// ─── Voice parse: 10 requests per user per minute ────────────────────────────
// Each call hits Gemini with up to ~13 MB of audio — tighter limit prevents
// quota abuse independent of the global per-IP limiter.

const parseVoiceLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            skipInTest,
  keyGenerator:    (req) => req.user?.userId || req.ip,
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many voice parse requests — please wait before trying again' }),
});

// ─── Global: 120 requests per IP per minute ───────────────────────────────────

const globalLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             120,
  standardHeaders: true,
  legacyHeaders:   false,
  skip:            skipInTest,
  handler: (_req, res) =>
    res.status(429).json({ error: 'Too many requests — please slow down' }),
});

module.exports = { sendOtpLimiter, verifyOtpLimiter, globalLimiter, parseVoiceLimiter };
