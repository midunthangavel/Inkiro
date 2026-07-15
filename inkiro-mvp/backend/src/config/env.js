'use strict';

require('dotenv').config();

// ─── Validation Helpers ───────────────────────────────────────────────────────

function requireStr(name, options = {}) {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    if (options.default !== undefined) return options.default;
    fatal(`Missing required environment variable: ${name}`);
  }

  const value = raw.trim();

  if (options.startsWith && !value.startsWith(options.startsWith)) {
    fatal(
      `${name} must start with "${options.startsWith}". ` +
        `Got: "${value.substring(0, 30)}..."`
    );
  }

  if (options.minLength && value.length < options.minLength) {
    fatal(`${name} must be at least ${options.minLength} characters long.`);
  }

  if (options.enum && !options.enum.includes(value)) {
    fatal(
      `${name} must be one of [${options.enum.join(', ')}]. Got: "${value}"`
    );
  }

  if (options.validator) options.validator(value);

  return value;
}

function requireInt(name, options = {}) {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    if (options.default !== undefined) return options.default;
    fatal(`Missing required environment variable: ${name}`);
  }

  const value = parseInt(raw, 10);

  if (isNaN(value)) {
    fatal(`${name} must be a valid integer. Got: "${raw}"`);
  }
  if (options.min !== undefined && value < options.min) {
    fatal(`${name} must be >= ${options.min}. Got: ${value}`);
  }
  if (options.max !== undefined && value > options.max) {
    fatal(`${name} must be <= ${options.max}. Got: ${value}`);
  }

  return value;
}

function requireFloat(name, options = {}) {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    if (options.default !== undefined) return options.default;
    fatal(`Missing required environment variable: ${name}`);
  }

  const value = parseFloat(raw);

  if (isNaN(value)) {
    fatal(`${name} must be a valid number. Got: "${raw}"`);
  }
  if (options.min !== undefined && value < options.min) {
    fatal(`${name} must be >= ${options.min}. Got: ${value}`);
  }
  if (options.max !== undefined && value > options.max) {
    fatal(`${name} must be <= ${options.max}. Got: ${value}`);
  }

  return value;
}

function fatal(message) {
  console.error(`\n[FATAL] Inkiro startup failure: ${message}\n`);
  process.exit(1);
}

// ─── Validate All Variables ───────────────────────────────────────────────────

const env = {
  // ── Server ──────────────────────────────────────────────────────────────────
  NODE_ENV: requireStr('NODE_ENV', {
    enum: ['development', 'production', 'test'],
    default: 'development',
  }),

  PORT: requireInt('PORT', {
    min: 1024,
    max: 65535,
    default: 3000,
  }),

  // CORS_ORIGINS: "*" allows all origins (development only).
  // In production set to a comma-separated list of allowed origins.
  CORS_ORIGINS: requireStr('CORS_ORIGINS', { default: '*' }),

  // ── Auth ────────────────────────────────────────────────────────────────────
  JWT_SECRET: requireStr('JWT_SECRET', {
    minLength: 32,
    validator: (v) => {
      if (process.env.NODE_ENV === 'production' && /dev|change|replace|placeholder/i.test(v)) {
        fatal('JWT_SECRET appears to be a development placeholder — generate a real secret before deploying');
      }
    },
  }),

  // ── Supabase ─────────────────────────────────────────────────────────────────
  SUPABASE_URL: requireStr('SUPABASE_URL', {
    startsWith: 'https://',
    minLength: 20,
  }),

  SUPABASE_SERVICE_ROLE_KEY: requireStr('SUPABASE_SERVICE_ROLE_KEY', {
    minLength: 20,
  }),

  // ── Gemini ───────────────────────────────────────────────────────────────────
  GEMINI_API_KEY: requireStr('GEMINI_API_KEY', {
    minLength: 10,
  }),

  // ── Admin ────────────────────────────────────────────────────────────────────
  ADMIN_API_KEY: requireStr('ADMIN_API_KEY', {
    minLength: 16,
    validator: (v) => {
      if (process.env.NODE_ENV === 'production' && /dev|admin|inkiro|test/i.test(v)) {
        fatal('ADMIN_API_KEY appears to be a development placeholder — generate a real key before deploying');
      }
    },
  }),

  // ── Default Coordinates (Coimbatore – Gandhipuram) ───────────────────────────
  DEFAULT_LAT: requireFloat('DEFAULT_LAT', {
    min: -90,
    max: 90,
    default: 11.0168,
  }),

  DEFAULT_LNG: requireFloat('DEFAULT_LNG', {
    min: -180,
    max: 180,
    default: 76.9558,
  }),
};

// ─── Derived Flags ────────────────────────────────────────────────────────────

env.isDev  = env.NODE_ENV === 'development';
env.isProd = env.NODE_ENV === 'production';
env.isTest = env.NODE_ENV === 'test';

Object.freeze(env);

module.exports = env;
