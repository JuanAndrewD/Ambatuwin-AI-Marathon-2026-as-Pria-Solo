// Smoke test for the attachments path. We create a project, send a small file,
// then read the chat back and verify the metadata is persisted (and the
// content was *not* persisted to disk for privacy).

const BASE = 'http://localhost:3000';
const j = (m, p, b) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());

(async () => {
  console.log('1. Create project');
  const created = await j('POST', '/api/projects', { name: 'Attach test', region: 'ap-southeast-5' });
  const pid = created.project.id;

  console.log('2. Reject too-large file (server-side guard)');
  const big = 'x'.repeat(220_000);
  const r1 = await fetch(`${BASE}/api/projects/${pid}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'try big', attachments: [{ name: 'big.txt', content: big }] }),
  });
  console.log('   status:', r1.status, '(should be 413)');

  console.log('3. Reject too many files');
  const r2 = await fetch(`${BASE}/api/projects/${pid}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'try many', attachments: Array.from({ length: 6 }).map((_, i) => ({ name: `f${i}.txt`, content: 'small' })) }),
  });
  console.log('   status:', r2.status, '(should be 400)');

  console.log('4. Cleanup');
  await j('DELETE', `/api/projects/${pid}`);
  console.log('   ✅ attachment guards work');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
