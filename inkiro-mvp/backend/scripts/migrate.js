#!/usr/bin/env node
'use strict';

/*
 * Inkiro migration runner
 * ───────────────────────
 * Applies numbered SQL files in scripts/migrations/ that haven't been applied
 * yet (tracked in the `_migrations` table).
 *
 * Usage
 *   node scripts/migrate.js           → apply all pending
 *   node scripts/migrate.js --dry-run → print the pending SQL without applying
 *   node scripts/migrate.js --status  → show which migrations have been applied
 *
 * Environment
 *   DATABASE_URL — direct Postgres connection string. In Supabase:
 *     Settings → Database → Connection string → "URI" (use the pooled one on
 *     port 6543 for scripts, not the direct 5432).
 *
 * Migration files
 *   scripts/migrations/NNNN_description.sql  — numeric prefix is the id
 *     0001_add_foo.sql
 *     0002_drop_bar.sql
 *
 * Each migration runs inside a transaction. Failure rolls back; nothing is
 * marked applied. Re-run after fixing the SQL.
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const TRACKER_SQL    = `
  CREATE TABLE IF NOT EXISTS _migrations (
    id         INTEGER     PRIMARY KEY,
    name       TEXT        NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

// ─── CLI flags ────────────────────────────────────────────────────────────────

const flag = (name) => process.argv.includes(name);
const DRY  = flag('--dry-run');
const STAT = flag('--status');

// ─── Load migrations from disk ────────────────────────────────────────────────

function loadMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`No migrations directory at ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  return files.map(file => {
    const m = file.match(/^(\d+)_(.+)\.sql$/);
    if (!m) {
      console.error(`Bad migration filename: ${file}  (expected NNNN_name.sql)`);
      process.exit(1);
    }
    return {
      id:   parseInt(m[1], 10),
      name: m[2],
      file,
      sql:  fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'),
    };
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const migrations = loadMigrations();

  if (migrations.length === 0) {
    console.log('No migrations found.');
    return;
  }

  const url = process.env.DATABASE_URL;

  // --dry-run works offline: print every migration as pending.
  if (!url && DRY) {
    console.log(`-- DATABASE_URL not set; showing all ${migrations.length} migration(s) as pending:\n`);
    for (const m of migrations) {
      console.log(`-- ═══ ${m.file} ═══`);
      console.log(m.sql);
      console.log(`INSERT INTO _migrations (id, name) VALUES (${m.id}, '${m.name.replace(/'/g, "''")}');`);
      console.log('');
    }
    return;
  }

  if (!url) {
    console.error(
      'DATABASE_URL is not set.\n' +
      'Supabase → Settings → Database → Connection string → URI.\n' +
      'Example: DATABASE_URL=postgresql://postgres.xxx:<pw>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres\n' +
      '\nTip: `npm run migrate:dry` works without DATABASE_URL and prints every SQL file.'
    );
    process.exit(1);
  }

  let pg;
  try {
    pg = require('pg');
  } catch {
    console.error('The "pg" package is not installed. Run: npm install --save-dev pg');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(TRACKER_SQL);

    const { rows: applied } = await client.query('SELECT id, name, applied_at FROM _migrations ORDER BY id ASC');
    const appliedIds = new Set(applied.map(r => r.id));

    if (STAT) {
      console.log(`Applied: ${applied.length} / ${migrations.length}\n`);
      for (const m of migrations) {
        const row = applied.find(r => r.id === m.id);
        const mark = row ? `✓ ${row.applied_at.toISOString()}` : '·';
        console.log(`  ${String(m.id).padStart(4, '0')}  ${mark}  ${m.name}`);
      }
      return;
    }

    const pending = migrations.filter(m => !appliedIds.has(m.id));

    if (pending.length === 0) {
      console.log(`All ${migrations.length} migrations already applied.`);
      return;
    }

    if (DRY) {
      console.log(`-- ${pending.length} pending migration(s):\n`);
      for (const m of pending) {
        console.log(`-- ═══ ${m.file} ═══`);
        console.log(m.sql);
        console.log(`INSERT INTO _migrations (id, name) VALUES (${m.id}, '${m.name.replace(/'/g, "''")}');`);
        console.log('');
      }
      return;
    }

    for (const m of pending) {
      process.stdout.write(`Applying ${m.file} … `);
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO _migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
        await client.query('COMMIT');
        console.log('ok');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        console.error(`  ${err.message}`);
        process.exit(1);
      }
    }
    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
