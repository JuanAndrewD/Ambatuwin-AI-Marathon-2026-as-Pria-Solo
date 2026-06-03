// GitHub repository routes (all require an authenticated session):
//   GET  /api/github/repos                 list the user's repos
//   POST /api/github/connect               connect an existing repo OR create one,
//                                           registering the mapping in the user's row
//   POST /api/github/disconnect            clear the connected-repo mapping
//   POST /api/projects/:id/github/sync     push the project's markdown to the repo
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

// Connect a repository to the user. Two modes:
//   { mode: 'existing', owner, name, branch? }
//   { mode: 'create',   name, private?, description? }
router.post('/connect', requireUserWithToken, async (req, res) => {
  const { mode } = req.body || {};
  try {
    let repoInfo;
    if (mode === 'create') {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'repository name is required' });
      const created = await ghApi.createRepo(req.ghUser.access_token, {
        name,
        description: String(req.body?.description || 'Architecture deliverables — Cloud Infrastructure Architect'),
        private: req.body?.private !== false,
        auto_init: true,
      });
      repoInfo = created;
    } else {
      const owner = String(req.body?.owner || '').trim();
      const name = String(req.body?.name || '').trim();
      if (!owner || !name) return res.status(400).json({ error: 'owner and name are required' });
      repoInfo = await ghApi.getRepo(req.ghUser.access_token, owner, name);
    }

    const branch = String(req.body?.branch || '').trim() || repoInfo.default_branch || 'main';
    const mapping = {
      owner: repoInfo.owner.login,
      name: repoInfo.name,
      full_name: repoInfo.full_name,
      branch,
      default_branch: repoInfo.default_branch,
      html_url: repoInfo.html_url,
      private: repoInfo.private,
      connected_at: new Date().toISOString(),
    };
    // Register the mapping inside the user's specific database row.
    const updated = await users.setRepo(req.ghUser.id, mapping);
    res.json({ user: users.publicUser(updated), repo: mapping });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/disconnect', requireUserWithToken, async (req, res) => {
  try {
    const updated = await users.setRepo(req.ghUser.id, null);
    res.json({ user: users.publicUser(updated) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, requireUserWithToken };
