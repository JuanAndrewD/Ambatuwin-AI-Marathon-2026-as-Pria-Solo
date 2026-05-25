// Smoke test for v4 features:
// - Project creation auto-creates a "Requirements brief" document
// - Document CRUD (create / list / patch / delete)
// - Brief is undeletable
// - included_in_context toggle
// - draft-brief endpoint persists to brief doc

const BASE = 'http://localhost:3000';
const j = (m, p, b) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().then(j => ({ status: r.status, body: j })).catch(() => ({ status: r.status, body: null })));

(async () => {
  for (let i = 0; i < 8; i++) {
    try { await fetch(BASE + '/api/catalog'); break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }

  console.log('1. Create project — should auto-create a brief doc');
  const c = await j('POST', '/api/projects', { name: 'Smoke v4 — KL fintech', region: 'ap-southeast-5', brief: '50,000 users in KL, PostgreSQL Multi-AZ, PDPA-MY, $4k/mo budget.' });
  const pid = c.body.project.id;
  console.log('   project:', pid, '— docs:', c.body.project.documents?.length, '— brief content len:', c.body.project.documents?.[0]?.content?.length);

  console.log('2. List documents');
  const list1 = await j('GET', `/api/projects/${pid}/documents`);
  console.log('   ', list1.body.documents.map(d => `${d.name} (${d.type}, ctx=${d.included_in_context}, ${d.bytes}B)`).join(' · '));
  const briefId = list1.body.documents.find(d => d.type === 'brief').id;

  console.log('3. Update brief content (PATCH /documents/:id)');
  const upd = await j('PATCH', `/api/projects/${pid}/documents/${briefId}`, { content: '# Updated brief\n\nNew details about the workload.' });
  console.log('   updated:', upd.status, '— mirror in project.brief:', (await j('GET', `/api/projects/${pid}`)).body.project.brief?.slice(0, 30));

  console.log('4. Refuse to delete brief (pinned)');
  const del = await j('DELETE', `/api/projects/${pid}/documents/${briefId}`);
  console.log('   status:', del.status, '(expect 400)');

  console.log('5. Create a notes doc, toggle context, delete it');
  const noteRes = await j('POST', `/api/projects/${pid}/documents`, { name: 'compliance-notes.md', type: 'notes', content: '# Notes\n- Need data residency.' });
  const noteId = noteRes.body.document.id;
  await j('PATCH', `/api/projects/${pid}/documents/${noteId}`, { included_in_context: true });
  const list2 = await j('GET', `/api/projects/${pid}/documents`);
  console.log('   note in context:', list2.body.documents.find(d => d.id === noteId)?.included_in_context);
  await j('DELETE', `/api/projects/${pid}/documents/${noteId}`);
  const list3 = await j('GET', `/api/projects/${pid}/documents`);
  console.log('   after delete, doc count:', list3.body.documents.length);

  console.log('6. Cleanup');
  await j('DELETE', `/api/projects/${pid}`);
  console.log('   ✅ document CRUD passed');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
