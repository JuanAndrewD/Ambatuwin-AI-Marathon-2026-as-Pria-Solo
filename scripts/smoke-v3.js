// Smoke test for v3 endpoints: services overview, service detail with pricing,
// rate-limited chat (no LLM call here, just header inspection on a 400),
// and SPA shell.

(async () => {
  const BASE = 'http://localhost:3000';
  // Wait for server to come online
  for (let i = 0; i < 8; i++) {
    try { await fetch(BASE + '/api/catalog'); break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }

  console.log('1. /api/services-overview');
  const overview = await fetch(BASE + '/api/services-overview').then(r => r.json());
  console.log('   services:', overview.services.length, '— each has purpose:', overview.services.every(s => typeof s.purpose === 'string'));

  console.log('2. /api/services/EC2 (detail with pricing)');
  const ec2 = await fetch(BASE + '/api/services/EC2').then(r => r.json());
  console.log('   short_name:', ec2.doc.short_name, '— pricing rows:', ec2.pricing?.length);
  console.log('   sample:', ec2.pricing?.[0]);

  console.log('3. /api/services/CloudFront (global service)');
  const cf = await fetch(BASE + '/api/services/CloudFront').then(r => r.json());
  console.log('   pricing rows (should be 1, GLOBAL):', cf.pricing?.length, cf.pricing?.[0]);

  console.log('4. /api/services/Nope (404)');
  const nope = await fetch(BASE + '/api/services/Nope');
  console.log('   status:', nope.status);

  console.log('5. SPA shell at /');
  const spa = await fetch(BASE + '/');
  const html = await spa.text();
  console.log('   has #root:', html.includes('id="root"'));

  console.log('6. SPA fallback at /#/services/RDS');
  const fallback = await fetch(BASE + '/services/RDS');
  console.log('   status:', fallback.status, '(should be 200, served by SPA fallback)');

  console.log('7. Rate-limit headers on chat (no project, expect 404 + headers)');
  const r = await fetch(BASE + '/api/projects/nope/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }),
  });
  console.log('   X-RateLimit-Limit:', r.headers.get('x-ratelimit-limit'), 'X-RateLimit-Remaining:', r.headers.get('x-ratelimit-remaining'), 'status:', r.status);

  console.log('\n✅ v3 endpoints reachable.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
