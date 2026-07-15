'use strict';

// ─── Monetary (all values in paise) ──────────────────────────────────────────

const PLATFORM_FEE_PAISE   = 1200; // ₹12.00
const DELIVERY_FEE_PAISE   = 2800; // ₹28.00
const RUNNER_EARNING_PAISE = 3000; // ₹30.00

// ─── Proximity Radii (km) ─────────────────────────────────────────────────────

const SHOP_INITIAL_RADIUS_KM    = 2;  // First broadcast to shops
const SHOP_ESCALATION_RADIUS_KM = 4;  // After broadcast window with no acceptance
const RUNNER_INITIAL_RADIUS_KM  = 3;  // First runner search (attempt 1)
const RUNNER_MAX_RADIUS_KM      = 12; // After 3 attempts: 3 → 6 → 12 km
const RUNNER_RADIUS_MULTIPLIER  = 2;  // Each retry doubles the search radius

// Ensure: RUNNER_MAX_RADIUS_KM >= RUNNER_INITIAL_RADIUS_KM * (RUNNER_RADIUS_MULTIPLIER ^ (RUNNER_MAX_DISPATCH_ATTEMPTS - 1))
// i.e. 12 >= 3 * (2 ^ 2) = 12 ✓  — if any of these change, verify this invariant holds.

// ─── Timing (seconds unless stated) ──────────────────────────────────────────

const OTP_EXPIRY_MINUTES             = 10;
const IDEMPOTENCY_WINDOW_SECONDS     = 30; // Duplicate order guard window

const ORDER_BROADCAST_WINDOW_SECONDS  = 90; // Initial shop broadcast window; escalate after this
const ORDER_ESCALATION_GRACE_SECONDS  = 60; // Extra window after escalation before expiry
const ORDER_TOTAL_LIFETIME_SECONDS    = ORDER_BROADCAST_WINDOW_SECONDS + ORDER_ESCALATION_GRACE_SECONDS;
// ORDER_TOTAL_LIFETIME_SECONDS (150s): escalated orders expire 60s after broadcast window
// ORDER_ABSOLUTE_EXPIRY_SECONDS (300s): hard ceiling for ALL pending orders regardless of escalation
const ORDER_ABSOLUTE_EXPIRY_SECONDS   = 300;

const RUNNER_RETRY_INTERVAL_SECONDS   = 60; // Wait before re-dispatching next runner batch

// ─── Dispatch ─────────────────────────────────────────────────────────────────

const RUNNER_MAX_DISPATCH_ATTEMPTS = 3; // Attempts: 3 km, 6 km, 12 km
const RUNNER_MAX_PER_DISPATCH      = 5; // Max runners notified per batch

// ─── Cron Schedules (node-cron 6-field syntax: sec min hr dom mon dow) ───────

const CRON_ORDER_EXPIRY_SCHEDULE = '0 * * * * *';   // At second 0 of every minute
const CRON_RUNNER_RETRY_SCHEDULE = '*/30 * * * * *'; // Every 30 seconds

// ─── Voice / STT ─────────────────────────────────────────────────────────────

const MAX_AUDIO_BYTES        = 10 * 1024 * 1024;                     // 10 MB raw audio ceiling
const MAX_AUDIO_BASE64_BYTES = Math.ceil(MAX_AUDIO_BYTES * (4 / 3)); // ~13.3 MB base64 ceiling
// Note: Estimate only. Validate actual decoded size in voiceParser.js.
const STT_ENCODING           = 'LINEAR16';
const STT_SAMPLE_RATE        = 16000;
const DEFAULT_LANGUAGE       = 'ta-IN';
const GEMINI_MODEL           = 'gemini-2.5-flash';

// ─── Expo Push Notifications ──────────────────────────────────────────────────

const EXPO_PUSH_URL        = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_SOUND      = 'default';
const EXPO_PUSH_PRIORITY   = 'high';
const EXPO_PUSH_CHANNEL_ID = 'orders';

// ─── API ──────────────────────────────────────────────────────────────────────

const API_PREFIX = '/api/v1';

// ─── Pagination Defaults ──────────────────────────────────────────────────────

const CUSTOMER_ORDER_HISTORY_LIMIT = 20;
const SHOP_ORDER_HISTORY_LIMIT     = 20;
const ADMIN_ORDER_DEFAULT_LIMIT    = 50;

// ─── Enums (mirror DB CHECK constraints exactly) ─────────────────────────────

const ORDER_STATUS = Object.freeze({
  PENDING:         'pending',
  // 'broadcasting' is NOT a persisted DB status — it is derived at the API
  // response layer only (returned to customer after POST /orders/confirm).
  ACCEPTED:        'accepted',
  RUNNER_NOTIFIED: 'runner_notified', // Runners pinged, awaiting acceptance
  RUNNER_ASSIGNED: 'runner_assigned',
  PICKED_UP:       'picked_up',
  DELIVERED:       'delivered',
  EXPIRED:         'expired',
  PENDING_RUNNER:  'pending_runner',  // Shop accepted, no runners found yet
  CANCELLED:       'cancelled',
});

// Statuses that indicate the order is still active (not terminal)
const ACTIVE_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.PENDING,
  ORDER_STATUS.ACCEPTED,
  ORDER_STATUS.RUNNER_NOTIFIED,
  ORDER_STATUS.RUNNER_ASSIGNED,
  ORDER_STATUS.PICKED_UP,
  ORDER_STATUS.PENDING_RUNNER,
]);

// Terminal statuses — order cannot change after reaching these
const TERMINAL_ORDER_STATUSES = Object.freeze([
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.EXPIRED,
]);

const USER_ROLES = Object.freeze({
  CUSTOMER: 'customer',
  SHOP:     'shop',
  RUNNER:   'runner',
});

const VEHICLE_TYPES = Object.freeze({
  WALK:  'walk',
  CYCLE: 'cycle',
  BIKE:  'bike',
});

const SHOP_RESPONSE_ACTIONS = Object.freeze({
  ACCEPT:  'accept',
  DECLINE: 'decline',
});

const RUNNER_STATUS_UPDATES = Object.freeze({
  PICKED_UP: 'picked_up',
  DELIVERED: 'delivered',
});

// Valid status transitions for runner update-status endpoint
const VALID_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.RUNNER_ASSIGNED]: ORDER_STATUS.PICKED_UP,
  [ORDER_STATUS.PICKED_UP]:       ORDER_STATUS.DELIVERED,
});

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = Object.freeze({
  // Monetary
  PLATFORM_FEE_PAISE,
  DELIVERY_FEE_PAISE,
  RUNNER_EARNING_PAISE,

  // Proximity
  SHOP_INITIAL_RADIUS_KM,
  SHOP_ESCALATION_RADIUS_KM,
  RUNNER_INITIAL_RADIUS_KM,
  RUNNER_MAX_RADIUS_KM,
  RUNNER_RADIUS_MULTIPLIER,

  // Timing
  OTP_EXPIRY_MINUTES,
  IDEMPOTENCY_WINDOW_SECONDS,
  ORDER_BROADCAST_WINDOW_SECONDS,
  ORDER_ESCALATION_GRACE_SECONDS,
  ORDER_TOTAL_LIFETIME_SECONDS,
  ORDER_ABSOLUTE_EXPIRY_SECONDS,
  RUNNER_RETRY_INTERVAL_SECONDS,

  // Dispatch
  RUNNER_MAX_DISPATCH_ATTEMPTS,
  RUNNER_MAX_PER_DISPATCH,

  // Cron
  CRON_ORDER_EXPIRY_SCHEDULE,
  CRON_RUNNER_RETRY_SCHEDULE,

  // Voice / STT
  MAX_AUDIO_BYTES,
  MAX_AUDIO_BASE64_BYTES,
  STT_ENCODING,
  STT_SAMPLE_RATE,
  DEFAULT_LANGUAGE,
  GEMINI_MODEL,

  // Push
  EXPO_PUSH_URL,
  EXPO_PUSH_SOUND,
  EXPO_PUSH_PRIORITY,
  EXPO_PUSH_CHANNEL_ID,

  // API
  API_PREFIX,

  // Pagination
  CUSTOMER_ORDER_HISTORY_LIMIT,
  SHOP_ORDER_HISTORY_LIMIT,
  ADMIN_ORDER_DEFAULT_LIMIT,

  // Enums
  ORDER_STATUS,
  ACTIVE_ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES,
  USER_ROLES,
  VEHICLE_TYPES,
  SHOP_RESPONSE_ACTIONS,
  RUNNER_STATUS_UPDATES,
  VALID_STATUS_TRANSITIONS,
});
