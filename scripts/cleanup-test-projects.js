// Remove any project whose name starts with "Smoke test —" — these are
// left over from automated smoke runs.
(async () => {
  const list = await fetch('http://localhost:3000/api/projects').then(r => r.json());
  let removed = 0;
  for (const p of list.projects) {
    if (p.name.startsWith('Smoke test')) {
      await fetch('http://localhost:3000/api/projects/' + p.id, { method: 'DELETE' });
      removed++;
    }
  }
  console.log(`removed ${removed} stale test project(s).`);
})();
