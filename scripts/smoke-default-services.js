// Verify a fresh project enables every service in the catalog by default.
const BASE = 'http://localhost:3000';

(async () => {
  for (let i = 0; i < 8; i++) {
    try { await fetch(BASE + '/api/catalog'); break; } catch { await new Promise(r => setTimeout(r, 500)); }
  }

  const cat = await fetch(BASE + '/api/catalog').then(r => r.json());
  const totalServices = cat.services.length;
  console.log('catalog services:', totalServices);

  const c = await fetch(BASE + '/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Default-services smoke', region: 'ap-southeast-5' }),
  }).then(r => r.json());

  const enabled = c.project.enabled_services || [];
  console.log('enabled on new project:', enabled.length);
  console.log('all enabled:', enabled.length === totalServices);
  console.log('missing:', cat.services.filter(s => !enabled.includes(s.name)).map(s => s.name));

  await fetch(BASE + '/api/projects/' + c.project.id, { method: 'DELETE' });
  console.log('✅ default-services smoke complete');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
