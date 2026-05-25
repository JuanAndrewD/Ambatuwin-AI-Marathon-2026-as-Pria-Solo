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
  ECS:         { tagline: 'Managed container orchestration', icon: 'Boxes' },
  Fargate:     { tagline: 'Serverless containers', icon: 'Boxes' },
  ECR:         { tagline: 'Private container registry', icon: 'Package' },
  WAF:         { tagline: 'Web application firewall', icon: 'Shield' },
  Shield:      { tagline: 'DDoS protection', icon: 'ShieldCheck' },
  KMS:         { tagline: 'Customer-managed encryption keys', icon: 'KeyRound' },
  Backup:      { tagline: 'Centralised backup orchestration', icon: 'Archive' },
  DataTransferOut: { tagline: 'Egress data transfer', icon: 'ArrowUpFromLine' },
  SQS:         { tagline: 'Managed message queues', icon: 'Inbox' },
  SNS:         { tagline: 'Pub/sub topics + push delivery', icon: 'Bell' },
  EventBridge: { tagline: 'Event bus and rule engine', icon: 'Radio' },
  APIGateway:  { tagline: 'Managed API front door', icon: 'Webhook' },
  Cognito:     { tagline: 'User identity and federation', icon: 'UserCheck' },
  SecretsManager: { tagline: 'Encrypted secret rotation', icon: 'Lock' },
  OpenSearch:  { tagline: 'Managed search & log analytics', icon: 'Search' },
  Athena:      { tagline: 'Serverless SQL on S3', icon: 'Sigma' },
  Glue:        { tagline: 'Serverless ETL + data catalog', icon: 'Workflow' },
  CloudWatch:  { tagline: 'Metrics, logs, and alarms', icon: 'LineChart' },
  VPC:         { tagline: 'Virtual networking primitives', icon: 'Network' },
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
