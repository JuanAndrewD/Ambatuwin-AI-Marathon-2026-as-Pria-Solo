// HTTP smoke test for the auth gate + session wiring against a running server.
// Verifies:
//   - /api/catalog is public (200)
//   - /api/auth/me reports configured + no user before login
//   - /api/projects is 401 without a session
//   - /api/github/repos is 401 without a session
//
// Usage: BASE=http://localhost:3000 node scripts/smoke-auth-http.js
const BASE = process.env.BASE || 'http://localhost:3000';

function assert(cond, msg) {
  if (!cond) { console.error('   ❌ FAIL:', msg); process.exit(1); }
  console.log('   ✅', msg);
}

async function j(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try { parsed = await res.json(); } catch {}
  return { status: res.status, body: parsed };
}

(async () => {
  console.log('1. Public catalog endpoint');
  const cat = await j('GET', '/api/catalog');
  assert(cat.status === 200 && Array.isArray(cat.body.services), 'GET /api/catalog → 200 with services');

  console.log('2. /api/auth/me before login');
  const me = await j('GET', '/api/auth/me');
  assert(me.status === 200, '/api/auth/me → 200');
  assert(me.body.user === null, 'no user in session');
  assert(typeof me.body.configured === 'boolean', `reports configured=${me.body.configured}, mode=${me.body.mode}`);

  console.log('3. Project routes require auth');
  const list = await j('GET', '/api/projects');
  assert(list.status === 401, 'GET /api/projects → 401 without session');
  const create = await j('POST', '/api/projects', { name: 'nope' });
  assert(create.status === 401, 'POST /api/projects → 401 without session');

  console.log('4. GitHub routes require auth');
  const repos = await j('GET', '/api/github/repos');
  assert(repos.status === 401, 'GET /api/github/repos → 401 without session');
  const connect = await j('POST', '/api/github/connect', { mode: 'existing', owner: 'x', name: 'y' });
  assert(connect.status === 401, 'POST /api/github/connect → 401 without session');

  console.log('\n✅ auth HTTP smoke complete');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
