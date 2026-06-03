// Server configuration & local-vs-production selection for GitHub OAuth.
//
// We register TWO GitHub OAuth apps:
//   • a production app  → GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
//   • a local/dev app   → GITHUB_CLIENT_ID_LOCAL / GITHUB_CLIENT_SECRET_LOCAL
//
// The local app's "Authorization callback URL" points at http://localhost,
// while the production app points at the Render URL. Selecting the right pair
// at runtime means the same codebase works in both environments without
// editing config.
//
// Selection rules (in priority order):
//   1. GITHUB_ENV=local|production explicitly forces a mode.
//   2. NODE_ENV=production (Render sets this) → production.
//   3. RENDER env var present (Render injects it) → production.
//   4. Otherwise → local.

function selectMode() {
  const forced = (process.env.GITHUB_ENV || '').toLowerCase();
  if (forced === 'local' || forced === 'production') return forced;
  if ((process.env.NODE_ENV || '').toLowerCase() === 'production') return 'production';
  if (process.env.RENDER || process.env.RENDER_EXTERNAL_URL) return 'production';
  return 'local';
}

const MODE = selectMode();

function credentials() {
  if (MODE === 'local') {
    return {
      clientId: process.env.GITHUB_CLIENT_ID_LOCAL || process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET_LOCAL || process.env.GITHUB_CLIENT_SECRET,
    };
  }
  return {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}

// The public base URL of this server, used to build the OAuth callback URL.
// Render injects RENDER_EXTERNAL_URL; locally we fall back to PORT.
function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  if (MODE === 'production' && process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '');
  }
  // Derive from the incoming request when available (handles proxies because
  // we set `trust proxy` in server.js).
  if (req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    if (host) return `${proto}://${host}`;
  }
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}

function callbackUrl(req) {
  return `${baseUrl(req)}/api/auth/github/callback`;
}

const { clientId, clientSecret } = credentials();

function isConfigured() {
  return Boolean(clientId && clientSecret);
}

module.exports = {
  MODE,
  clientId,
  clientSecret,
  isConfigured,
  baseUrl,
  callbackUrl,
};
