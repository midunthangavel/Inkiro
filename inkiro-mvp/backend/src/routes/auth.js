'use strict';

const express         = require('express');
const { randomInt }   = require('crypto');
const jwt             = require('jsonwebtoken');
const axios           = require('axios');
const { db, anonDb }  = require('../db');
const asyncHandler    = require('../utils/asyncHandler');
const validate        = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { sendOtpLimiter, verifyOtpLimiter } = require('../middleware/rateLimit');
const logger          = require('../utils/logger');
const C               = require('../config/constants');

const isDev = process.env.NODE_ENV === 'development';

const router = express.Router();

// ─── POST /send-otp ───────────────────────────────────────────────────────────

router.post(
  '/send-otp',
  sendOtpLimiter,
  validate(validate.schemas.sendOtp),
  asyncHandler(async (req, res) => {
    const { phone } = req.body;
    const code      = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + C.OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const { error } = await anonDb
      .from('otp_codes')
      .upsert({ phone, code, expires_at: expiresAt }, { onConflict: 'phone' });

    if (error) {
      req.log.error({ err: error }, 'Failed to store OTP');
      return res.status(500).json({ error: 'Failed to send OTP' });
    }

    if (isDev) {
      req.log.info({ phone, code }, 'OTP generated (dev mode)');
      return res.json({ message: 'OTP sent', dev_otp: code });
    }

    try {
      await axios.post(
        'https://www.fast2sms.com/dev/bulkV2',
        { variables_values: code, route: 'otp', numbers: phone },
        { headers: { authorization: process.env.FAST2SMS_API_KEY }, timeout: 5000 }
      );
    } catch (smsErr) {
      req.log.error({ err: smsErr, phone }, 'Fast2SMS delivery failed');
      return res.status(502).json({ error: 'Failed to send OTP' });
    }

    req.log.info({ phone }, 'OTP sent via Fast2SMS');
    res.json({ message: 'OTP sent' });
  })
);

// ─── POST /verify-otp ─────────────────────────────────────────────────────────

router.post(
  '/verify-otp',
  verifyOtpLimiter,
  validate(validate.schemas.verifyOtp),
  asyncHandler(async (req, res) => {
    const { phone, code, role, name } = req.body;

    const { data: otp, error: otpErr } = await anonDb
      .from('otp_codes')
      .select('code, expires_at')
      .eq('phone', phone)
      .maybeSingle();

    if (otpErr) {
      req.log.error({ err: otpErr }, 'OTP lookup failed');
      return res.status(500).json({ error: 'OTP lookup failed' });
    }

    if (!otp || otp.code !== code) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    if (new Date(otp.expires_at) < new Date()) {
      return res.status(401).json({ error: 'OTP expired' });
    }

    await anonDb.from('otp_codes').delete().eq('phone', phone);

    const { data: existing } = await anonDb
      .from('users')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    let user = existing;

    if (!user) {
      const { data: created, error: createErr } = await anonDb
        .from('users')
        .insert({ phone, role, name: name || null })
        .select()
        .single();

      if (createErr) {
        req.log.error({ err: createErr }, 'Failed to create user');
        return res.status(500).json({ error: 'Failed to create user' });
      }

      user = created;

      if (role === 'runner') {
        // Runner profile creation uses service role — INSERT into runners requires
        // knowledge of user.id but has no authenticated session yet.
        const { error: runnerErr } = await db
          .from('runners')
          .insert({
            user_id:        user.id,
            is_available:   false,
            is_verified:    false,
            total_earnings: 0,
          });

        if (runnerErr) {
          req.log.error({ err: runnerErr, user_id: user.id }, 'Failed to create runner profile');
        } else {
          req.log.info({ user_id: user.id }, 'Runner profile created');
        }
      }
    }

    const token = jwt.sign(
      { sub: user.id, userId: user.id, role: user.role, phone: user.phone, type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Refresh token — long-lived, carries minimal claims, used only by /auth/refresh
    const refreshToken = jwt.sign(
      { sub: user.id, userId: user.id, type: 'refresh' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    req.log.info({ user_id: user.id, role: user.role }, 'User authenticated');
    res.json({ user, token, refreshToken });
  })
);

// ─── POST /refresh ────────────────────────────────────────────────────────────

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    if (payload.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const { data: user } = await db
      .from('users')
      .select('id, role, phone')
      .eq('id', payload.userId)
      .maybeSingle();

    if (!user) return res.status(401).json({ error: 'User not found' });

    const token = jwt.sign(
      { sub: user.id, userId: user.id, role: user.role, phone: user.phone, type: 'access' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ token });
  })
);

// ─── POST /register-push-token ────────────────────────────────────────────────

router.post(
  '/register-push-token',
  requireAuth(),
  validate(validate.schemas.registerPushToken),
  asyncHandler(async (req, res) => {
    const { token, role } = req.body;
    const user_id = req.user.userId;

    // Push token writes use service role — user identity comes from our JWT middleware,
    // not from a Supabase session, so anonDb cannot enforce ownership here yet.
    const { error } = await db
      .from('push_tokens')
      .upsert(
        { user_id, token, role: role || null, is_active: true },
        { onConflict: 'token' }
      );

    if (error) {
      req.log.error({ err: error, user_id }, 'Failed to register push token');
      return res.status(500).json({ error: 'Failed to register push token' });
    }

    res.json({ message: 'Push token registered' });
  })
);

module.exports = router;
