// Account-level GitHub routes (require an authenticated session):
//   GET /api/github/repos   list the signed-in user's repositories
//
// Repo *connection* is project-scoped and lives in server.js under
//   POST   /api/projects/:id/github/connect
//   DELETE /api/projects/:id/github/repo      (disconnect)
//   POST   /api/projects/:id/github/sync
// because a repo is attached to a project, not to the account.
//
// File push uses the low-level Git Trees API (see github-api.pushFiles) so we
// never zip anything or run git on the server.

const express = require('express');
const ghApi = require('./github-api');
const users = require('./users');

const router = express.Router();

// Require a signed-in user, and load their token for Git API calls.
async function requireUserWithToken(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not signed in' });
  try {
    const user = await users.getWithTokenById(req.session.userId);
    if (!user) return res.status(401).json({ error: 'session user not found' });
    if (!user.access_token) return res.status(403).json({ error: 'no GitHub token on file; sign in again' });
    req.ghUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.get('/repos', requireUserWithToken, async (req, res) => {
  try {
    const repos = await ghApi.listRepos(req.ghUser.access_token);
    res.json({ repos });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = { router, requireUserWithToken };
