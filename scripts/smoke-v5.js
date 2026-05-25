// Smoke tests for v5 features:
// - /api/projects/:id/refine-brief generates a brief from raw editor text
// - /api/projects/:id/quick-spec generates a spec doc and saves it
// - "#docname" tokens in chat resolve and inject document content
// - findReferencedDocs unit-style check via the chat endpoint

const BASE = process.env.BASE || 'http://localhost:3001';
const j = (m, p, b) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

(async () => {
  console.log('— v5 smoke against', BASE);

  console.log('\n1. Create project + add a notes doc');
  const c = await j('POST', '/api/projects', { name: 'Smoke v5', region: 'ap-southeast-5', brief: '' });
  const pid = c.body.project.id;
  const noteRes = await j('POST', `/api/projects/${pid}/documents`, {
    name: 'sla-notes.md', type: 'notes', content: '# SLA Notes\n\nAvailability target is 99.95%. Activation date: **2027-03-14**. Code: ZEPHYR-7.',
    included_in_context: false, // intentionally NOT in context — test that #ref still pulls it in
  });
  console.log('   doc id:', noteRes.body.document.id);

  console.log('\n2. Refine-brief from editor text');
  const refine = await j('POST', `/api/projects/${pid}/refine-brief`, {
    source: 'Logistics dispatch app, 80,000 active users, Singapore region, PDPA-SG required, $7,000/month budget, postgres with read replicas, no EKS.',
  });
  console.log('   status:', refine.status, '— brief len:', refine.body?.document?.content?.length);
  const md = (refine.body?.document?.content || '').toLowerCase();
  console.log('   mentions Singapore:', md.includes('singapore'));
  console.log('   mentions PDPA-SG:', md.includes('pdpa-sg'));
  console.log('   mentions budget number:', /7[,.]?000/.test(md));

  console.log('\n3. Chat with #sla-notes reference (doc not in context!)');
  const ans = await j('POST', `/api/projects/${pid}/chat`, {
    message: 'Quote the activation code and date from #sla-notes verbatim.',
  });
  const a = (ans.body?.assistant?.content || '').toUpperCase();
  console.log('   mentions ZEPHYR-7:', a.includes('ZEPHYR-7'));
  console.log('   mentions 2027-03-14:', a.includes('2027-03-14') || a.includes('MARCH 14'));
  console.log('   first 200 chars:', (ans.body?.assistant?.content || '').slice(0, 200).replace(/\n/g, ' / '));

  console.log('\n4. Quick Spec endpoint');
  const qs = await j('POST', `/api/projects/${pid}/quick-spec`, {
    prompt: 'A simple webhook intake service that buffers events to S3 for 30 days and replays into DynamoDB.',
  });
  console.log('   status:', qs.status, '— doc name:', qs.body?.document?.name, '— len:', qs.body?.document?.content?.length);
  const qsmd = (qs.body?.document?.content || '').toLowerCase();
  console.log('   has Requirements section:', qsmd.includes('## 1. requirements'));
  console.log('   has Design section:', qsmd.includes('## 2. design'));
  console.log('   has Tasks section:', qsmd.includes('## 3. tasks'));
  console.log('   has mermaid block:', qsmd.includes('```mermaid'));

  console.log('\n5. Cleanup');
  await j('DELETE', `/api/projects/${pid}`);
  console.log('   ✅ v5 smoke complete');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
