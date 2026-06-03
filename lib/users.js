// User data-access layer (PostgreSQL).
//
// A user is created or updated when GitHub calls our OAuth callback. We store
// the GitHub access token (so we can push to repos on the user's behalf) and
// the connected-repository mapping inside the user's own row — there is no
// generic dump directory.

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
    repo: r.repo || null,
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
    repo: u.repo || null,
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

// Register / update the connected repository mapping inside the user's row.
// repo: { owner, name, branch, html_url, default_branch, connected_at }
async function setRepo(id, repo) {
  const { rows } = await db.query(
    `UPDATE users SET repo = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, repo ? JSON.stringify(repo) : null]
  );
  return rowToUser(rows[0]);
}

module.exports = {
  upsertFromGitHub,
  getById,
  getWithTokenById,
  setRepo,
  publicUser,
};
