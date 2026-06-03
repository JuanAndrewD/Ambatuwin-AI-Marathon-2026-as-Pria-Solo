// Verifies the schema migration: an old database with `repo` on users gets it
// dropped, and `repo` is added to projects, on init(). Run against an empty DB
// that already has the OLD shape.
require('dotenv').config({ override: true });
const db = require('../lib/db');

async function colExists(table, col) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, col]
  );
  return rows.length > 0;
}

(async () => {
  // Seed the OLD shape.
  await db.query(`DROP TABLE IF EXISTS projects; DROP TABLE IF EXISTS users;`);
  await db.query(`CREATE TABLE users (id BIGSERIAL PRIMARY KEY, github_id BIGINT UNIQUE NOT NULL, username TEXT NOT NULL, repo JSONB)`);
  await db.query(`CREATE TABLE projects (id TEXT PRIMARY KEY, user_id BIGINT REFERENCES users(id), name TEXT NOT NULL)`);

  console.log('before: users.repo =', await colExists('users', 'repo'), '| projects.repo =', await colExists('projects', 'repo'));

  await db.init();

  const usersRepo = await colExists('users', 'repo');
  const projectsRepo = await colExists('projects', 'repo');
  console.log('after:  users.repo =', usersRepo, '| projects.repo =', projectsRepo);

  if (usersRepo) { console.error('   ❌ FAIL: users.repo should have been dropped'); process.exit(1); }
  if (!projectsRepo) { console.error('   ❌ FAIL: projects.repo should have been added'); process.exit(1); }
  console.log('   ✅ migration moved repo from users → projects');

  await db.pool.end();
  process.exit(0);
})().catch(async (e) => { console.error('FAIL:', e.message); try { await db.pool.end(); } catch {} process.exit(1); });
