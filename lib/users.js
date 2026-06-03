// User data-access layer (PostgreSQL).
//
// A user is created or updated when GitHub calls our OAuth callback. We store
// the GitHub access token here (so we can push to repos on the user's behalf).
//
// NOTE: the connected-repository mapping does NOT live on the user. A repo is
// attached to a *project* (see lib/projects.js — max one repo per project,
// zero allowed). One account therefore owns many repos via its many projects.

const db = require('./db');

function rowToUser(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    github_id: Number(r.github_id),
    username: r.username,
    name: r.name,
    email: r.email,
    avatar_url: r.avatar_url,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// Public-safe shape (never leaks the access token to the client).
function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    github_id: u.github_id,
    username: u.username,
    name: u.name,
    email: u.email,
    avatar_url: u.avatar_url,
  };
}

// Upsert a GitHub profile + token. Returns the full user row (incl. token).
async function upsertFromGitHub(profile, accessToken) {
  const { id, login, name, email, avatar_url } = profile;
  const { rows } = await db.query(
    `INSERT INTO users (github_id, username, name, email, avatar_url, access_token, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (github_id) DO UPDATE SET
       username     = EXCLUDED.username,
       name         = EXCLUDED.name,
       email        = EXCLUDED.email,
       avatar_url   = EXCLUDED.avatar_url,
       access_token = EXCLUDED.access_token,
       updated_at   = now()
     RETURNING *`,
    [id, login, name || null, email || null, avatar_url || null, accessToken || null]
  );
  return { ...rowToUser(rows[0]), access_token: rows[0].access_token };
}

async function getById(id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return rowToUser(rows[0]);
}

// Includes the access token — used internally for Git API calls only.
async function getWithTokenById(id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  if (!rows[0]) return null;
  return { ...rowToUser(rows[0]), access_token: rows[0].access_token };
}

module.exports = {
  upsertFromGitHub,
  getById,
  getWithTokenById,
  publicUser,
};
