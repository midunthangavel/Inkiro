'use strict';

// Load .env.test BEFORE any module is required.
// middleware/auth.js throws at load-time if JWT_SECRET is missing.
// db.js throws at load-time if SUPABASE_* keys are missing (but db is mocked in tests).
require('dotenv').config({ path: require('path').resolve(__dirname, '.env.test') });
