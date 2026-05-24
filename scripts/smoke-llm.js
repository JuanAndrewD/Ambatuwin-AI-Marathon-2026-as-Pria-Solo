// End-to-end smoke test against Chutes API + the architect pipeline.
// Run: node scripts/smoke-llm.js

require('dotenv').config();
const { design } = require('../lib/architect');

(async () => {
  const brief = `We are a Malaysian fintech preparing to launch a savings app for ~50,000 active users in Kuala Lumpur, peaking at ~6,000 concurrent. We need a secure PostgreSQL database with auto-failover (Multi-AZ), a containerised API tier behind a load balancer with auto-scaling, a Redis cache, a CDN for static assets, KMS-managed encryption, WAF, daily backups, and PDPA-MY data residency. Target budget: USD 4,000 / month.`;
  try {
    const res = await design({
      brief,
      regionCode: 'ap-southeast-5',
      additionalCompliance: ['PDPA-MY'],
    });
    console.log('--- Profile ---');
    console.log(JSON.stringify(res.profile, null, 2));
    console.log('\n--- Architecture name ---', res.arch.architecture_name);
    console.log('Components:', res.priced.items.length);
    console.log('Total: $' + res.priced.total + ' / month');
    console.log('Compliance OK:', res.compliance.ok);
    console.log('Validation issues:', res.priced.issues);
    console.log('\n--- Markdown preview (first 800 chars) ---');
    console.log(res.markdown.slice(0, 800));
  } catch (err) {
    console.error('FAIL:', err.message);
    process.exit(1);
  }
})();
