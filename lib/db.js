// PostgreSQL connection pool + schema bootstrap.
//
// This module replaces the old file-backed `data/projects.json` store with a
// real relational database. Two tables are created on boot:
//
//   users     — one row per GitHub account that signs in. Holds the OAuth
//               access token (used for Git API calls) and the connected
//               repository mapping (owner/name/branch) for that user.
//   projects  — one row per architecture engagement, owned by a user via a
//               foreign key. Documents, chat history and the last plan live
//               in JSONB columns so the shape mirrors the old JSON tree.
//
// The express-session store (connect-pg-simple) manages its own `session`
// table; we let it create that lazily.

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    '[db] DATABASE_URL is not set. The app needs a PostgreSQL connection ' +
    'string (see .env). Auth and project storage will fail until it is set.'
  );
}

// Render's managed Postgres (and most hosted providers) require TLS. Local
// Postgres usually does not. Detect localhost and disable SSL there.
function sslConfig(conn) {
  if (!conn) return false;
  if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(conn)) return false;
  if (/\bsslmode=disable\b/.test(conn)) return false;
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString,
  ssl: sslConfig(connectionString),
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected idle client error:', err.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  github_id     BIGINT UNIQUE NOT NULL,
  username      TEXT NOT NULL,
  name          TEXT,
  email         TEXT,
  avatar_url    TEXT,
  access_token  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  region            TEXT NOT NULL DEFAULT 'ap-southeast-5',
  brief             TEXT NOT NULL DEFAULT '',
  enabled_services  JSONB NOT NULL DEFAULT '[]'::jsonb,
  chat              JSONB NOT NULL DEFAULT '[]'::jsonb,
  documents         JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_plan         JSONB,
  repo              JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);

-- Migration for databases created before the repo mapping moved from the user
-- to the project. A repo belongs to a project (max one per project, zero
-- allowed); a user can therefore own many repos via their many projects.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo JSONB;
ALTER TABLE users DROP COLUMN IF EXISTS repo;
`;

let initPromise = null;

// Idempotent schema creation. Awaited once at server start; safe to call again.
function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await pool.query(SCHEMA);
      console.log('[db] schema ready (users, projects)');
    })().catch((err) => {
      initPromise = null; // allow a retry on next call
      throw err;
    });
  }
  return initPromise;
}

module.exports = { pool, query, init };
