// Verify the SPA shell is served correctly.
fetch('http://localhost:3000/').then(r => r.text()).then(html => {
  console.log('html length:', html.length);
  console.log('has #root:', html.includes('id="root"'));
  console.log('has bundled script:', /assets\/index-.*\.js/.test(html));
  console.log('title:', (html.match(/<title>(.*?)<\/title>/) || [])[1]);
}).catch(e => { console.error(e.message); process.exit(1); });
