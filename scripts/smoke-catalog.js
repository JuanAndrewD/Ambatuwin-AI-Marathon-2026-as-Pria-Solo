// Quick deterministic smoke test — does NOT call the LLM.
// Verifies that the pricing/guardrail layer works on its own.

const cat = require('../lib/catalog');

console.log('--- Regions ---');
console.log(cat.listRegions().map(r => `${r.code} (${r.country})`).join('\n'));

console.log('\n--- Sample component pricing in ap-southeast-5 (Malaysia) ---');
console.log('EC2 m5.large × 4 :', cat.priceEC2('m5.large', 'ap-southeast-5', 4));
console.log('RDS db.r5.large Multi-AZ + 200 GB :', cat.priceRDS('db.r5.large', 'ap-southeast-5', { storageGB: 200, multiAZ: true }));
console.log('ElastiCache cache.r5.large × 2 :', cat.priceElastiCache('cache.r5.large', 'ap-southeast-5', 2));
console.log('CloudFront 1TB / 5M req :', cat.priceCloudFront({ gbPerMonth: 1000, requestsPerMonth: 5_000_000, edgeRegion: 'apac' }));
console.log('NAT Gateway × 2, 200 GB :', cat.priceNATGateway('ap-southeast-5', { count: 2, gbPerMonth: 200 }));
console.log('S3 500 GB + 50K PUT + 500K GET :', cat.priceS3('ap-southeast-5', { storageGB: 500, putRequestsPerMonth: 50_000, getRequestsPerMonth: 500_000 }));

console.log('\n--- Compliance: ap-southeast-5 against [PDPA-MY, GDPR] ---');
console.log(cat.checkCompliance('ap-southeast-5', ['PDPA-MY', 'GDPR']));

console.log('\n--- Compliance: eu-west-1 against [GDPR] ---');
console.log(cat.checkCompliance('eu-west-1', ['GDPR']));

console.log('\n--- Region fallback: a service hypothetically missing ---');
console.log('Suggested fallback for EC2 from ap-southeast-5 :', cat.suggestRegionFallback('ap-southeast-5', 'EC2'));
