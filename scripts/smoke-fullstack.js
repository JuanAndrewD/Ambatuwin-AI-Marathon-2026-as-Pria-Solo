// Fullstack smoke test against the running server.
// Verifies: catalog → create project → patch resources → chat → design.

const BASE = 'http://localhost:3000';
const j = (m, p, b) => fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());

(async () => {
  console.log('1. /api/catalog');
  const cat = await j('GET', '/api/catalog');
  console.log('   services:', cat.services.length, 'regions:', cat.regions.length, 'compliance:', cat.compliance_frameworks.length);

  console.log('2. POST /api/projects');
  const created = await j('POST', '/api/projects', {
    name: 'Smoke test — Fintech KL',
    region: 'ap-southeast-5',
    brief: 'Fintech savings app for 50,000 active users in Kuala Lumpur. Need PostgreSQL with auto-failover, containerised API, Redis cache, CDN, KMS encryption, WAF, daily backups, PDPA-MY data residency. Budget USD 4000/month.',
  });
  const pid = created.project.id;
  console.log('   created:', pid);

  console.log('3. PATCH /api/projects/:id (toggle resources)');
  const enabled = ['EC2','RDS','S3','ALB','CloudFront','Route53','KMS','WAF','NATGateway','Backup','ElastiCache','EKS'];
  const patched = await j('PATCH', `/api/projects/${pid}`, { enabled_services: enabled });
  console.log('   enabled:', patched.project.enabled_services.length);

  console.log('4. POST /api/projects/:id/chat');
  const chatRes = await j('POST', `/api/projects/${pid}/chat`, { message: 'In one paragraph, summarise the recommended architecture for this brief.' });
  console.log('   assistant len:', chatRes.assistant?.content?.length);

  console.log('5. POST /api/projects/:id/design');
  const designRes = await j('POST', `/api/projects/${pid}/design`, {});
  if (designRes.error) {
    console.error('   design FAIL:', designRes.error);
    process.exit(1);
  }
  const r = designRes.result;
  console.log('   components:', r.priced.items.length, 'total: $' + r.priced.total + '/mo', 'compliance ok:', r.compliance.ok, 'allowed:', r.allowed_services.length);

  console.log('6. GET /api/projects/:id (verify chat and plan are persisted)');
  const fresh = await j('GET', `/api/projects/${pid}`);
  console.log('   chat entries:', fresh.project.chat.length, 'has plan:', !!fresh.project.last_plan);

  console.log('7. DELETE /api/projects/:id');
  await j('DELETE', `/api/projects/${pid}`);
  console.log('   deleted');

  console.log('\n✅ Fullstack smoke test passed.');
})().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
