'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL)              throw new Error('Missing required environment variable: SUPABASE_URL');
if (!SUPABASE_ANON_KEY)         throw new Error('Missing required environment variable: SUPABASE_ANON_KEY');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY');

const BASE_AUTH_OPTIONS = {
  autoRefreshToken:   false, // No token refresh on the backend
  persistSession:     false, // No session storage
  detectSessionInUrl: false, // No OAuth redirects
};

// ─── Service Role Client ───────────────────────────────────────────────────────
//
// Bypasses ALL Row Level Security. Use only for:
//   • Admin routes  (/api/v1/admin/*)
//   • Cron jobs     (orderExpiryJob, runnerRetryJob)
//   • Notification service  (reads push tokens for any user)
//   • Runner settlement INSERTs (delivery completion — internal operation)
//
// Never pass this client to user-facing routes or expose its key to clients.

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: BASE_AUTH_OPTIONS,
});

// ─── Anon Client (static) ─────────────────────────────────────────────────────
//
// Subject to Phase 1 RLS policies in scripts/rls.sql. Use for all customer,
// shop, and runner operations. `auth.uid()` in policies returns NULL with this
// client because no user JWT is forwarded — Phase 1 policies are therefore
// written permissively for the anon role.
//
// See createUserClient() below for the migration path to Phase 2 (per-user RLS).

const anonDb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: BASE_AUTH_OPTIONS,
});

// ─── Per-Request User Client (Phase 2 migration target) ───────────────────────
//
// Creates an anon client that forwards the authenticated user's JWT as the
// Authorization header. With this client, `auth.uid()` in RLS policies resolves
// to the user's UUID (the `sub` claim in our JWT), enabling true per-user row
// isolation via Phase 2 policies in scripts/rls.sql.
//
// Prerequisites before switching services to this client:
//   1. JWT_SECRET in .env must match the custom JWT secret set in:
//      Supabase Dashboard → Settings → API → JWT Settings → JWT Secret
//   2. All issued tokens already include `sub: user.id` (done in auth route).
//
// Usage in a route handler:
//   const userDb = createUserClient(req.headers.authorization.slice(7));
//   const result = await userDb.from('orders').select('*');

function createUserClient(jwt) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: BASE_AUTH_OPTIONS,
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
  });
}

module.exports = { db, anonDb, createUserClient };
