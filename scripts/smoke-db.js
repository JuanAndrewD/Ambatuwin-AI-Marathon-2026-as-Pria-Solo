// Integration smoke test for the PostgreSQL-backed user + project layer.
// Exercises the data modules directly (no GitHub OAuth required):
//   - schema init
//   - user upsert (simulating an OAuth callback)
//   - project create / list / get / update / delete (scoped per user)
//   - document CRUD
//   - cross-user isolation (user B cannot see user A's project)
//   - repo mapping on the user row
//
// Usage:
//   set DATABASE_URL=postgres://user:pass@localhost:5432/cia
//   node scripts/smoke-db.js
require('dotenv').config();

const db = require('../lib/db');
const users = require('../lib/users');
const projects = require('../lib/projects');

function assert(cond, msg) {
  if (!cond) { console.error('   ❌ FAIL:', msg); process.exit(1); }
  console.log('   ✅', msg);
}

(async () => {
  console.log('0. Init schema');
  await db.init();

  console.log('1. Upsert two users (simulated OAuth callbacks)');
  const a = await users.upsertFromGitHub({ id: 900001, login: 'alice', name: 'Alice', email: 'a@example.com', avatar_url: 'http://x/a.png' }, 'tok_alice');
  const b = await users.upsertFromGitHub({ id: 900002, login: 'bob', name: 'Bob', email: 'b@example.com', avatar_url: 'http://x/b.png' }, 'tok_bob');
  assert(a.id && b.id && a.id !== b.id, `two distinct users created (a=${a.id}, b=${b.id})`);

  console.log('2. Upsert is idempotent on github_id + refreshes token');
  const a2 = await users.upsertFromGitHub({ id: 900001, login: 'alice', name: 'Alice R', email: 'a@example.com' }, 'tok_alice_2');
  assert(a2.id === a.id, 'same user id on re-login');
  const aTok = await users.getWithTokenById(a.id);
  assert(aTok.access_token === 'tok_alice_2', 'access token updated on re-login');

  console.log('3. Create projects for each user');
  const pa = await projects.createProject(a.id, { name: 'Alice project', region: 'ap-southeast-5', brief: 'alice brief' });
  const pb = await projects.createProject(b.id, { name: 'Bob project', region: 'ap-southeast-1' });
  assert(pa.id && pb.id, 'projects created');
  assert(pa.documents.length === 1 && pa.documents[0].type === 'brief', 'brief doc auto-created');
  assert(pa.enabled_services.length > 0, 'default enabled_services populated');

  console.log('4. List is scoped per user');
  const listA = await projects.listProjects(a.id);
  const listB = await projects.listProjects(b.id);
  assert(listA.length === 1 && listA[0].id === pa.id, 'alice sees only her project');
  assert(listB.length === 1 && listB[0].id === pb.id, 'bob sees only his project');

  console.log('5. Cross-user isolation');
  const stolen = await projects.getProject(b.id, pa.id);
  assert(stolen === null, 'bob cannot read alice project by id');
  const badDelete = await projects.deleteProject(b.id, pa.id);
  assert(badDelete === false, 'bob cannot delete alice project');
  const stillThere = await projects.getProject(a.id, pa.id);
  assert(stillThere !== null, 'alice project still intact after bob attempt');

  console.log('6. Document CRUD');
  const doc = await projects.createDocument(a.id, pa.id, { name: 'notes.md', type: 'notes', content: '# hi' });
  assert(doc && doc.id, 'doc created');
  const updated = await projects.updateDocument(a.id, pa.id, doc.id, { content: '# updated' });
  assert(updated.content === '# updated', 'doc updated');
  const briefId = (await projects.getProject(a.id, pa.id)).documents.find(d => d.type === 'brief').id;
  const refusedBrief = await projects.deleteDocument(a.id, pa.id, briefId);
  assert(refusedBrief === false, 'brief is undeletable');
  const delOk = await projects.deleteDocument(a.id, pa.id, doc.id);
  assert(delOk === true, 'notes doc deleted');

  console.log('7. Chat append + clear');
  await projects.appendChat(a.id, pa.id, { role: 'user', content: 'hello' });
  let fresh = await projects.getProject(a.id, pa.id);
  assert(fresh.chat.length === 1, 'chat appended');
  await projects.clearChat(a.id, pa.id);
  fresh = await projects.getProject(a.id, pa.id);
  assert(fresh.chat.length === 0, 'chat cleared');

  console.log('8. Update project (brief mirror into brief doc)');
  await projects.updateProject(a.id, pa.id, { brief: 'new brief text', name: 'Alice renamed' });
  fresh = await projects.getProject(a.id, pa.id);
  assert(fresh.name === 'Alice renamed', 'name updated');
  assert(fresh.documents.find(d => d.type === 'brief').content === 'new brief text', 'brief doc mirrors project.brief');

  console.log('9. Repo mapping on the user row');
  const withRepo = await users.setRepo(a.id, { owner: 'alice', name: 'deliverables', full_name: 'alice/deliverables', branch: 'main' });
  assert(withRepo.repo && withRepo.repo.full_name === 'alice/deliverables', 'repo mapping stored on user');
  const cleared = await users.setRepo(a.id, null);
  assert(cleared.repo === null, 'repo mapping cleared');

  console.log('10. Cascade delete (deleting user removes their projects)');
  await db.query('DELETE FROM users WHERE id = $1', [a.id]);
  const afterCascade = await projects.getProject(a.id, pa.id);
  assert(afterCascade === null, 'project removed when owner user deleted');

  console.log('11. Cleanup');
  await db.query('DELETE FROM users WHERE github_id IN ($1, $2)', [900001, 900002]);

  console.log('\n✅ DB smoke complete');
  await db.pool.end();
  process.exit(0);
})().catch(async (e) => {
  console.error('FAIL:', e.message);
  try { await db.pool.end(); } catch {}
  process.exit(1);
});
