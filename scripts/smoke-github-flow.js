// Full-stack GitHub flow test with a MOCKED GitHub API.
//
// We stub global.fetch so the real OAuth token exchange, profile fetch, repo
// lookup, and Git Trees push all hit an in-memory fake GitHub. Everything else
// (Express app, sessions, PostgreSQL) is the real thing. This proves the
// callback → upsert → session → connect → sync pipeline end to end without
// needing real GitHub credentials.
//
// Usage:
//   set DATABASE_URL=postgres://postgres:postgres@localhost:5432/cia_test
//   node scripts/smoke-github-flow.js
require('dotenv').config();
process.env.GITHUB_CLIENT_ID_LOCAL = process.env.GITHUB_CLIENT_ID_LOCAL || 'test_id';
process.env.GITHUB_CLIENT_SECRET_LOCAL = process.env.GITHUB_CLIENT_SECRET_LOCAL || 'test_secret';
process.env.GITHUB_ENV = 'local';
process.env.SESSION_SECRET = 'test-secret';

const http = require('http');
const assert = (cond, msg) => {
  if (!cond) { console.error('   ❌ FAIL:', msg); process.exit(1); }
  console.log('   ✅', msg);
};

// ---- In-memory fake GitHub --------------------------------------------------
const fakeRepoFiles = {}; // path -> content (after push)
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = typeof url === 'string' ? url : url.url;
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};

  function json(status, obj) {
    return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  }

  // OAuth token exchange
  if (u === 'https://github.com/login/oauth/access_token') {
    return json(200, { access_token: 'gho_faketoken', token_type: 'bearer', scope: 'repo' });
  }
  // Authed user
  if (u === 'https://api.github.com/user' && method === 'GET') {
    return json(200, { id: 4242, login: 'octodev', name: 'Octo Dev', email: 'octo@example.com', avatar_url: 'http://x/octo.png' });
  }
  if (u === 'https://api.github.com/user/emails') {
    return json(200, [{ email: 'octo@example.com', primary: true, verified: true }]);
  }
  // Repo lookup
  if (/\/repos\/octodev\/deliverables$/.test(u) && method === 'GET') {
    return json(200, {
      name: 'deliverables', full_name: 'octodev/deliverables',
      owner: { login: 'octodev' }, default_branch: 'main', private: true,
      html_url: 'https://github.com/octodev/deliverables',
    });
  }
  // Git data: base ref
  if (/\/git\/ref\/heads\/main$/.test(u) && method === 'GET') {
    return json(200, { object: { sha: 'basecommitsha' } });
  }
  if (/\/git\/commits\/basecommitsha$/.test(u) && method === 'GET') {
    return json(200, { tree: { sha: 'basetreesha' } });
  }
  // Blobs
  if (/\/git\/blobs$/.test(u) && method === 'POST') {
    const content = Buffer.from(body.content, 'base64').toString('utf8');
    return json(201, { sha: 'blob_' + Math.random().toString(36).slice(2, 8), _content: content });
  }
  // Trees
  if (/\/git\/trees$/.test(u) && method === 'POST') {
    for (const t of body.tree) fakeRepoFiles[t.path] = true;
    return json(201, { sha: 'newtreesha' });
  }
  // Commit
  if (/\/git\/commits$/.test(u) && method === 'POST') {
    return json(201, { sha: 'newcommitsha' });
  }
  // Move ref
  if (/\/git\/refs\/heads\/main$/.test(u) && method === 'PATCH') {
    return json(200, { ref: 'refs/heads/main', object: { sha: body.sha } });
  }
  // Fallback to real network (shouldn't happen)
  return realFetch(url, opts);
};

const app = require('../server');
const db = require('../lib/db');

let server, base;
function req(method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const r = http.request(base + path, { method, headers }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = buf ? JSON.parse(buf) : null; } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: buf });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  await db.init();
  // Clean any prior test user.
  await db.query('DELETE FROM users WHERE github_id = $1', [4242]);

  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;

  console.log('1. Start OAuth, capture state + session cookie');
  const start = await req('GET', '/api/auth/github?returnTo=%23/app');
  assert(start.status === 302, 'login redirects (302)');
  const loc = start.headers.location;
  const state = new URL(loc).searchParams.get('state');
  assert(!!state, 'state nonce present in redirect');
  const cookie = (start.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  assert(/cia\.sid/.test(cookie), 'session cookie set on login start');

  console.log('2. OAuth callback → upsert user + start session');
  const cb = await req('GET', `/api/auth/github/callback?code=fakecode&state=${state}`, { cookie });
  assert(cb.status === 302, 'callback redirects back to app');

  console.log('3. /api/auth/me reflects the signed-in user');
  const me = await req('GET', '/api/auth/me', { cookie });
  assert(me.body.user && me.body.user.username === 'octodev', 'session user is octodev');
  assert(me.body.user.access_token === undefined, 'access token NOT leaked to client');

  console.log('4. Create a project + a doc (now authorized)');
  const proj = await req('POST', '/api/projects', { cookie, body: { name: 'GH Flow', region: 'ap-southeast-5', brief: '# Brief\nhello' } });
  assert(proj.status === 201, 'project created');
  const pid = proj.body.project.id;
  await req('POST', `/api/projects/${pid}/documents`, { cookie, body: { name: 'notes.md', type: 'notes', content: '# Notes\nbody' } });

  console.log('5. Connect an existing repo (mapping saved on user row)');
  const conn = await req('POST', '/api/github/connect', { cookie, body: { mode: 'existing', owner: 'octodev', name: 'deliverables' } });
  assert(conn.status === 200, 'connect returns 200');
  assert(conn.body.repo.full_name === 'octodev/deliverables', 'repo mapping returned');
  const me2 = await req('GET', '/api/auth/me', { cookie });
  assert(me2.body.user.repo && me2.body.user.repo.full_name === 'octodev/deliverables', 'repo mapping persisted on user');

  console.log('6. Sync project markdown via Git Trees API (mocked)');
  const sync = await req('POST', `/api/projects/${pid}/github/sync`, { cookie, body: { path: 'gh-flow' } });
  assert(sync.status === 200, 'sync returns 200');
  assert(sync.body.result.commit_sha === 'newcommitsha', 'commit created');
  assert(sync.body.files.some(f => /gh-flow\/.+\.md$/.test(f)), 'markdown files pushed under target dir');
  assert(Object.keys(fakeRepoFiles).length >= 2, `blobs/tree built (${Object.keys(fakeRepoFiles).join(', ')})`);

  console.log('7. Sync without a session is rejected');
  const noauth = await req('POST', `/api/projects/${pid}/github/sync`, { body: {} });
  assert(noauth.status === 401, 'sync requires a session');

  console.log('8. Logout clears the session');
  await req('POST', '/api/auth/logout', { cookie });
  const meAfter = await req('GET', '/api/auth/me', { cookie });
  assert(meAfter.body.user === null, 'session destroyed after logout');

  console.log('\n9. Cleanup');
  await db.query('DELETE FROM users WHERE github_id = $1', [4242]);
  await new Promise(r => server.close(r));
  await db.pool.end();
  console.log('\n✅ GitHub flow smoke complete');
  process.exit(0);
})().catch(async (e) => {
  console.error('FAIL:', e.stack || e.message);
  try { await db.pool.end(); } catch {}
  process.exit(1);
});
