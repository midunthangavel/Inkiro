'use strict';

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE_RE = /^\d{10}$/;
const OTP_RE   = /^\d{6}$/;

// ─── Field Validator ──────────────────────────────────────────────────────────

function validateField(key, value, rule, errors) {
  const missing = value === undefined || value === null || value === '';

  if (rule.required && missing) {
    errors.push(`${key} is required`);
    return;
  }
  if (missing) return;

  if (rule.type === 'string' && typeof value !== 'string') {
    errors.push(`${key} must be a string`);
    return;
  }
  if (rule.type === 'number' && typeof value !== 'number') {
    errors.push(`${key} must be a number`);
    return;
  }
  if (rule.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${key} must be a boolean`);
    return;
  }
  if (rule.type === 'array' && !Array.isArray(value)) {
    errors.push(`${key} must be an array`);
    return;
  }
  if (rule.uuid && !UUID_RE.test(value)) {
    errors.push(`${key} must be a valid UUID`);
  }
  if (rule.pattern && !rule.pattern.test(value)) {
    errors.push(`${key} format is invalid`);
  }
  if (rule.enum && !rule.enum.includes(value)) {
    errors.push(`${key} must be one of: ${rule.enum.join(', ')}`);
  }
  if (rule.minLength && typeof value === 'string' && value.trim().length < rule.minLength) {
    errors.push(`${key} must be at least ${rule.minLength} characters`);
  }
  if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) {
    errors.push(`${key} must be at most ${rule.maxLength} characters`);
  }
  if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
    errors.push(`${key} must be >= ${rule.min}`);
  }
  if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
    errors.push(`${key} must be <= ${rule.max}`);
  }
  if (rule.minItems && Array.isArray(value) && value.length < rule.minItems) {
    errors.push(`${key} must contain at least ${rule.minItems} item(s)`);
  }
}

// ─── Middleware Factory ───────────────────────────────────────────────────────

function validate(schema) {
  return function (req, res, next) {
    try {
      const errors = [];
      const body   = req.body || {};

      for (const [key, rule] of Object.entries(schema)) {
        validateField(key, body[key], rule, errors);
      }

      if (errors.length > 0) {
        return res.status(400).json({ error: errors[0], errors });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

validate.schemas = {
  sendOtp: {
    phone: { type: 'string', pattern: PHONE_RE, required: true },
  },

  verifyOtp: {
    phone: { type: 'string', pattern: PHONE_RE, required: true },
    code:  { type: 'string', pattern: OTP_RE,   required: true },
    role:  { type: 'string', enum: ['customer', 'shop', 'runner'], required: true },
    name:  { type: 'string', minLength: 1, maxLength: 100 },
  },

  // user_id now sourced from req.user (JWT); only token + role required in body
  registerPushToken: {
    token: { type: 'string', minLength: 1, required: true },
    role:  { type: 'string', enum: ['customer', 'shop', 'runner'] },
  },

  parseVoice: {
    audio_base64: { type: 'string', minLength: 1, required: true },
    language:     { type: 'string', enum: ['ta-IN', 'en-IN'] },
  },

  // customer_phone now sourced from req.user (JWT)
  confirmOrder: {
    items:   { type: 'array',  minItems: 1,        required: true },
    address: { type: 'string', minLength: 5,        required: true },
    lat:     { type: 'number', min: -90,  max: 90,  required: true },
    lng:     { type: 'number', min: -180, max: 180, required: true },
  },

  // shop_id is derived from the JWT (via requireShopProfile middleware),
  // never from the request body — prevents IDOR across shops.
  shopRespond: {
    order_id: { type: 'string', uuid: true, required: true },
    action:   { type: 'string', enum: ['accept', 'decline'], required: true },
  },

  // user_id now sourced from req.user (JWT)
  registerShop: {
    shop_name: { type: 'string', minLength: 1, maxLength: 100, required: true },
    address:   { type: 'string', minLength: 5, required: true },
    lat:       { type: 'number', min: -90,  max: 90,  required: true },
    lng:       { type: 'number', min: -180, max: 180, required: true },
  },

  // runner_id is derived from the JWT (via requireRunnerProfile middleware),
  // never from the request body — prevents IDOR across runners.
  acceptJob: {
    order_id: { type: 'string', uuid: true, required: true },
  },

  updateStatus: {
    order_id: { type: 'string', uuid: true, required: true },
    status:   { type: 'string', enum: ['picked_up', 'delivered'], required: true },
  },

  updateLocation: {
    lat:          { type: 'number',  min: -90,  max: 90,  required: true },
    lng:          { type: 'number',  min: -180, max: 180, required: true },
    is_available: { type: 'boolean', required: true },
  },

  updateProfile: {
    vehicle_type: { type: 'string', enum: ['walk', 'cycle', 'bike'] },
    upi_id:       { type: 'string', maxLength: 50 },
  },

  updateUser: {
    name:            { type: 'string', minLength: 1, maxLength: 100 },
    default_address: { type: 'string', minLength: 5 },
    default_lat:     { type: 'number', min: -90,  max: 90  },
    default_lng:     { type: 'number', min: -180, max: 180 },
  },

  updateShop: {
    shop_name: { type: 'string', minLength: 1, maxLength: 100 },
    address:   { type: 'string', minLength: 5 },
    lat:       { type: 'number', min: -90,  max: 90  },
    lng:       { type: 'number', min: -180, max: 180 },
  },

  adminAssignRunner: {
    order_id:  { type: 'string', uuid: true, required: true },
    runner_id: { type: 'string', uuid: true, required: true },
  },

  rateOrder: {
    rating:  { type: 'number', min: 1, max: 5, required: true },
    comment: { type: 'string', maxLength: 500 },
  },
};

module.exports = validate;
