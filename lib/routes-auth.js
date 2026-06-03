// Authentication routes: GitHub OAuth login, callback, logout, and the
// "who am I" endpoint. On a successful callback we upsert the user into
// PostgreSQL and start an isolated cookie session via req.session.userId.

const crypto = require('crypto');
const express = require('express');
const gh = require('./github-config');
const ghApi = require('./github-api');
const users = require('./users');

const router = express.Router();

// Begin the OAuth dance. Generate a CSRF state nonce, stash it in the session,
// and redirect the browser to GitHub's consent screen.
router.get('/github', (req, res) => {
  if (!gh.isConfigured()) {
    return res.status(500).send('GitHub OAuth is not configured on this server.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  // Remember where to bounce the user back to after login (defaults to /app).
  req.session.returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '#/app';
  const url = ghApi.authorizeUrl({ state, redirectUri: gh.callbackUrl(req) });
  res.redirect(url);
});

// GitHub redirects back here with ?code and ?state.
router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query;
  try {
    if (!code) throw new Error('missing authorization code');
    if (!state || state !== req.session.oauthState) throw new Error('invalid OAuth state');
    delete req.session.oauthState;

    const token = await ghApi.exchangeCodeForToken({ code, redirectUri: gh.callbackUrl(req) });
    const profile = await ghApi.getAuthedUser(token);

    // Dynamically save or update the user in PostgreSQL.
    const user = await users.upsertFromGitHub(profile, token);

    // Start an isolated cookie session bound to this user's database row.
    req.session.userId = user.id;

    const returnTo = req.session.returnTo || '#/app';
    delete req.session.returnTo;
    res.redirect('/' + (returnTo.startsWith('#') ? returnTo : '#/app'));
  } catch (err) {
    console.error('[auth] callback error:', err.message);
    res.redirect('/#/app?auth_error=' + encodeURIComponent(err.message));
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('cia.sid');
    res.json({ ok: true });
  });
});

// Current session user (or null). Also reports whether GitHub OAuth is
// configured so the client can hide the login button when it isn't.
router.get('/me', async (req, res) => {
  const base = { configured: gh.isConfigured(), mode: gh.MODE };
  if (!req.session.userId) return res.json({ ...base, user: null });
  try {
    const user = await users.getById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.json({ ...base, user: null });
    }
    res.json({ ...base, user: users.publicUser(user) });
  } catch (err) {
    res.status(500).json({ ...base, user: null, error: err.message });
  }
});

module.exports = router;
