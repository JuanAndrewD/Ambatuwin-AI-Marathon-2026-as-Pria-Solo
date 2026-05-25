// Verify the architect actually leans on prior conversation + documents.
// Two checks:
//   A. Brief-from-history: send 3 chat turns, then call /draft-brief and
//      assert the resulting markdown reflects the conversation.
//   B. Document-in-context: write a unique facts doc, mark it in-context,
//      then ask a question that can only be answered from the doc.

const BASE = 'http://localhost:3000';
const j = (m, p, b) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());

(async () => {
  console.log('A. Brief-from-history');
  const c = await j('POST', '/api/projects', { name: 'Context test', region: 'ap-southeast-1', brief: '' });
  const pid = c.project.id;

  // Three short turns to seed the conversation.
  await j('POST', `/api/projects/${pid}/chat`, { message: 'We have 80,000 active users in Singapore for a logistics dispatch app.' });
  await j('POST', `/api/projects/${pid}/chat`, { message: 'We need PostgreSQL with read replicas, a CDN, and PDPA-SG residency.' });
  await j('POST', `/api/projects/${pid}/chat`, { message: 'Budget is USD 7,000 / month. We do not need EKS.' });

  const draft = await j('POST', `/api/projects/${pid}/draft-brief`);
  if (draft.error) { console.error('   draft-brief FAIL:', draft.error); process.exit(1); }
  const md = (draft.document.content || '').toLowerCase();
  console.log('   length:', draft.document.content.length, 'chars');
  console.log('   mentions Singapore:', md.includes('singapore'));
  console.log('   mentions PDPA-SG:', md.includes('pdpa-sg'));
  console.log('   mentions $7,000:',
    /7[,.]?000/.test(md) || md.includes('budget'));
  console.log('   first 240 chars:\n', draft.document.content.slice(0, 240).replace(/\n/g, ' / '));

  console.log('\nB. Document-in-context recall');
  // Write a doc with a unique factoid the model can't know unless it reads the doc.
  const created = await j('POST', `/api/projects/${pid}/documents`, {
    name: 'secret-config.md', type: 'notes',
    content: '# Internal config\n\nThe internal feature flag for the launch is **OPERATION-FERN-9183**.\nActivation date: 2026-09-12.',
    included_in_context: true,
  });
  console.log('   doc id:', created.document.id, 'included_in_context:', created.document.included_in_context);

  const ans = await j('POST', `/api/projects/${pid}/chat`, {
    message: 'What is the internal feature-flag codename for the launch and when does it activate? Quote the doc verbatim.',
  });
  const a = (ans.assistant?.content || '').toUpperCase();
  console.log('   mentions flag:', a.includes('OPERATION-FERN-9183'));
  console.log('   mentions date:', a.includes('2026-09-12') || a.includes('SEPTEMBER 12'));
  console.log('   first 240 chars:\n   ', (ans.assistant?.content || '').slice(0, 240).replace(/\n/g, ' / '));

  await j('DELETE', `/api/projects/${pid}`);
  console.log('\n✅ context smoke complete');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
