// Public-facing catalog summary used by the Resources panel.

const { CATALOG, listRegions } = require('./catalog');

const SERVICE_DESCRIPTIONS = {
  EC2:         { tagline: 'Resizable compute capacity', icon: 'Cpu' },
  RDS:         { tagline: 'Managed relational databases', icon: 'Database' },
  DynamoDB:    { tagline: 'Serverless NoSQL key-value store', icon: 'Layers' },
  S3:          { tagline: 'Object storage for any volume', icon: 'HardDrive' },
  EBS:         { tagline: 'Block storage for EC2', icon: 'HardDrive' },
  ALB:         { tagline: 'Application Load Balancer', icon: 'Network' },
  NATGateway:  { tagline: 'Outbound internet for private subnets', icon: 'Network' },
  CloudFront:  { tagline: 'Global CDN edge network', icon: 'Globe' },
  Route53:     { tagline: 'Authoritative DNS', icon: 'Compass' },
  Lambda:      { tagline: 'Serverless functions', icon: 'Zap' },
  ElastiCache: { tagline: 'Managed Redis / Memcached', icon: 'Database' },
  EKS:         { tagline: 'Managed Kubernetes', icon: 'Boxes' },
  WAF:         { tagline: 'Web application firewall', icon: 'Shield' },
  Shield:      { tagline: 'DDoS protection', icon: 'ShieldCheck' },
  KMS:         { tagline: 'Customer-managed encryption keys', icon: 'KeyRound' },
  Backup:      { tagline: 'Centralised backup orchestration', icon: 'Archive' },
  DataTransferOut: { tagline: 'Egress data transfer', icon: 'ArrowUpFromLine' },
};

function summariseServices() {
  return Object.entries(CATALOG.services).map(([name, svc]) => ({
    name,
    category: svc.category,
    available_in: svc.available_in,
    billing_unit: svc.billing_unit,
    tagline: SERVICE_DESCRIPTIONS[name]?.tagline || '',
    icon: SERVICE_DESCRIPTIONS[name]?.icon || 'Cube',
  }));
}

function getCatalogPublic() {
  return {
    meta: CATALOG._meta,
    regions: listRegions(),
    services: summariseServices(),
    compliance_frameworks: Object.entries(CATALOG.compliance_frameworks).map(([code, m]) => ({
      code, full_name: m.full_name, data_must_stay_in: m.data_must_stay_in,
    })),
  };
}

module.exports = { getCatalogPublic, summariseServices };
