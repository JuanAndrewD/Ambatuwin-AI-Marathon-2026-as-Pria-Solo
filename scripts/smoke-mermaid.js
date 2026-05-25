// Verify the Mermaid normaliser turns the LLM's single-line output back
// into something Mermaid can parse.

import('../client/src/lib/markdown.js').then(({ normaliseMermaid }) => {
  const broken = `flowchart LR subgraph Edge R53[Route53] CF[CloudFront] WAF[WAF] end subgraph App ALB[ALB] EC2_1[EC2 App Tier] EC2_2[EC2 App Tier] NAT[NAT Gateway] end subgraph Data RDS[(RDS Multi-AZ)] S3[(S3 Content Bucket)] end subgraph Ops KMS[KMS] Backup[Backup] end Users((Users)) --> R53 R53 --> CF WAF -.-> CF CF --> ALB ALB --> EC2_1 ALB --> EC2_2 EC2_1 --> RDS EC2_2 --> RDS EC2_1 --> S3 EC2_2 --> S3 EC2_1 -.-> NAT EC2_2 -.-> NAT KMS -.-> RDS KMS -.-> S3 Backup -.-> RDS Backup -.-> S3`;

  const fixed = normaliseMermaid(broken);
  console.log('--- input (truncated) ---');
  console.log(broken.slice(0, 80) + '…');
  console.log('\n--- normalised output ---');
  console.log(fixed);
  console.log('\n--- assertions ---');
  const lines = fixed.split('\n');
  const assertions = [
    ['header on its own line',         lines[0].trim() === 'flowchart LR'],
    ['multi-line (>= 8 lines)',         lines.length >= 8],
    ['contains 4 subgraphs',            (fixed.match(/^\s*subgraph /gm) || []).length === 4],
    ['contains 4 ends',                 (fixed.match(/^\s*end\s*$/gm) || []).length === 4],
    ['Users node on its own line',      /^Users\(\(Users\)\) --> R53\s*$/m.test(fixed)],
    ['edge "EC2_1 --> RDS" on own line',/^\s*EC2_1 --> RDS\s*$/m.test(fixed)],
  ];
  for (const [label, ok] of assertions) {
    console.log(`   ${ok ? '✅' : '❌'}  ${label}`);
  }
}).catch(err => { console.error('FAIL:', err); process.exit(1); });
