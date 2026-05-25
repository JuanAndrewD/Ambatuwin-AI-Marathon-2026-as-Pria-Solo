// Static knowledge base for the per-service detail pages. The chat agent can
// surface this content too, but it lives outside the LLM so the docs are
// reproducible and not subject to hallucination.

const SERVICE_DOCS = {
  EC2: {
    short_name: 'Amazon EC2',
    purpose: 'Resizable virtual servers (Linux/Windows). The default for stateful workloads, custom runtimes, or anything you would otherwise run on a physical machine.',
    when_to_use: [
      'Containerised or traditional API tiers behind an ALB',
      'Self-managed databases or specialised workloads (e.g. game servers)',
      'GPU compute for inference (using `g`/`p` family)',
    ],
    how_to_implement: [
      'Place instances in **private subnets** across at least two AZs.',
      'Front them with an Application Load Balancer + target group.',
      'Use Auto Scaling Groups with target-tracking on CPU or request count.',
      'Restrict SSH to a bastion or use SSM Session Manager (no inbound 22).',
    ],
    pairs_well_with: ['ALB', 'NATGateway', 'EBS', 'KMS', 'Backup'],
    common_pitfalls: [
      'Forgetting to size NAT gateway data transfer — egress from EC2 → internet via NAT can dwarf compute cost.',
      'Pinning to a single AZ for cost reasons and losing HA.',
    ],
    sample_terraform: `resource "aws_instance" "api" {
  ami           = data.aws_ami.al2023.id
  instance_type = "m5.large"
  subnet_id     = aws_subnet.private_a.id
  vpc_security_group_ids = [aws_security_group.api.id]
  iam_instance_profile   = aws_iam_instance_profile.ssm.name
  tags = { Name = "api-\${var.env}" }
}`,
  },
  RDS: {
    short_name: 'Amazon RDS',
    purpose: 'Managed relational databases (PostgreSQL, MySQL, MariaDB, Oracle, SQL Server, Aurora). AWS handles backups, patching, and failover.',
    when_to_use: [
      'OLTP workloads with strong consistency requirements',
      'Anything currently running on PostgreSQL or MySQL on-prem',
      'Reporting databases with read replicas',
    ],
    how_to_implement: [
      'Always enable **Multi-AZ** for production — automatic synchronous standby with failover in 60–120s.',
      'Provision in **private** DB subnets only, no public IP.',
      'Encrypt at rest with a customer-managed KMS key (default AWS-managed key is fine for early stages).',
      'Enable performance insights and slow-query log to CloudWatch.',
    ],
    pairs_well_with: ['EC2', 'KMS', 'Backup', 'ElastiCache'],
    common_pitfalls: [
      'Storage scales but the IOPS profile (gp3 baseline) may bottleneck heavy writes — check CloudWatch metrics before assuming you need a bigger instance.',
      'Multi-AZ doubles cost; do not enable it on dev/staging.',
    ],
    sample_terraform: `resource "aws_db_instance" "main" {
  identifier           = "app-\${var.env}"
  engine               = "postgres"
  engine_version       = "16.3"
  instance_class       = "db.m5.large"
  allocated_storage    = 200
  storage_encrypted    = true
  kms_key_id           = aws_kms_key.db.arn
  multi_az             = true
  db_subnet_group_name = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  backup_retention_period = 30
  deletion_protection  = true
}`,
  },
  DynamoDB: {
    short_name: 'Amazon DynamoDB',
    purpose: 'Serverless, key-value + document NoSQL store with single-digit-ms latency at any scale.',
    when_to_use: [
      'High-throughput session, profile, or feature-flag stores',
      'Mobile/IoT backends with unpredictable spiky traffic',
      'Workloads where you can model access patterns up-front',
    ],
    how_to_implement: [
      'Default to **on-demand** capacity for unpredictable workloads, switch to **provisioned + auto-scaling** once traffic stabilises.',
      'Enable **point-in-time recovery (PITR)** for all production tables.',
      'Use **single-table design** with composite keys to minimise tables and cross-table joins.',
      'Stream changes to Lambda for downstream pipelines (DynamoDB Streams).',
    ],
    pairs_well_with: ['Lambda', 'KMS', 'CloudFront'],
    common_pitfalls: [
      'Accidental table scans in code can blow the bill instantly.',
      'Cross-region replication doubles cost and breaks data residency assumptions.',
    ],
    sample_terraform: `resource "aws_dynamodb_table" "sessions" {
  name           = "sessions-\${var.env}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "user_id"
  attribute { name = "user_id" type = "S" }
  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true kms_key_arn = aws_kms_key.ddb.arn }
}`,
  },
  S3: {
    short_name: 'Amazon S3',
    purpose: 'Object storage for any volume of unstructured data: app uploads, backups, static sites, data lakes.',
    when_to_use: [
      'User-uploaded media, app assets, build artefacts',
      'Backup and archive (with Glacier transitions)',
      'Static frontend hosting behind CloudFront',
    ],
    how_to_implement: [
      'Block all public access at the bucket level — serve files via CloudFront with OAC instead.',
      'Enable **versioning** + **MFA delete** on critical buckets.',
      'Default-encrypt with **SSE-KMS** (your CMK).',
      'Lifecycle rules: hot → IA after 30 days → Glacier after 90 days for cost control.',
    ],
    pairs_well_with: ['CloudFront', 'KMS', 'Backup', 'Lambda'],
    common_pitfalls: [
      'Public bucket misconfiguration is the most common AWS data leak — always use Block Public Access.',
      'Cross-region requests can violate data residency.',
    ],
    sample_terraform: `resource "aws_s3_bucket" "assets" { bucket = "app-assets-\${var.env}" }
resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration { status = "Enabled" }
}`,
  },
  EBS: {
    short_name: 'Amazon EBS',
    purpose: 'Persistent block storage volumes for EC2 instances. Like a network-attached SSD that survives instance restarts.',
    when_to_use: [
      'Boot volumes for EC2',
      'Application data that needs low-latency I/O',
      'Self-managed databases on EC2 (use io2 Block Express)',
    ],
    how_to_implement: [
      'Default to **gp3** — same performance as gp2 at ~20% lower cost.',
      'Encrypt at rest with KMS by default at the account level.',
      'Snapshot daily via AWS Backup; lifecycle to delete after 30 days.',
    ],
    pairs_well_with: ['EC2', 'KMS', 'Backup'],
    sample_terraform: `resource "aws_ebs_volume" "data" {
  availability_zone = aws_instance.api.availability_zone
  size              = 100
  type              = "gp3"
  encrypted         = true
  kms_key_id        = aws_kms_key.ebs.arn
}`,
  },
  ALB: {
    short_name: 'Application Load Balancer',
    purpose: 'Layer-7 HTTP/HTTPS load balancer with path-based routing, native WAF integration, and TLS termination.',
    when_to_use: [
      'In front of EC2/ECS/EKS HTTP services',
      'Anywhere you want WAF and ACM-managed TLS in one place',
      'Multi-tenant routing (host/path → target group)',
    ],
    how_to_implement: [
      'Public ALB in public subnets, targets in private subnets.',
      'Attach an **ACM certificate** for TLS, redirect HTTP → HTTPS.',
      'Bind a **WAFv2 web ACL** at the ALB (or CloudFront, not both).',
      'Health check the actual app endpoint (e.g. `/healthz`), not just `/`.',
    ],
    pairs_well_with: ['EC2', 'EKS', 'WAF', 'Route53'],
    sample_terraform: `resource "aws_lb" "main" {
  name               = "app-\${var.env}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  enable_deletion_protection = true
}`,
  },
  NATGateway: {
    short_name: 'NAT Gateway',
    purpose: 'Lets resources in private subnets reach the internet for software updates, package downloads, and outbound API calls — without being publicly addressable.',
    when_to_use: [
      'Any architecture with private subnets that need outbound internet',
      'Lambdas in a VPC that call third-party APIs',
    ],
    how_to_implement: [
      'Deploy **one NAT Gateway per AZ** for production HA.',
      'Use **VPC endpoints** for AWS services (S3, DynamoDB, KMS) to bypass NAT and save on data transfer.',
      'Tag with cost-allocation tags — NAT data transfer is often a stealth budget killer.',
    ],
    pairs_well_with: ['EC2', 'EKS', 'Lambda'],
    sample_terraform: `resource "aws_nat_gateway" "main" {
  for_each = toset(["a", "b"])
  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.public[each.key].id
}`,
  },
  CloudFront: {
    short_name: 'Amazon CloudFront',
    purpose: 'Global CDN that caches static assets and API responses at 600+ edge locations worldwide.',
    when_to_use: [
      'Any static site or SPA',
      'API edge cache for high-read-low-write endpoints',
      'TLS termination for global users (cheaper than per-region ALBs)',
    ],
    how_to_implement: [
      'Origin Access Control (OAC) → S3 buckets, blocking direct S3 access.',
      'Use **CloudFront Functions** for cheap edge logic (~10x cheaper than Lambda@Edge).',
      'Attach a **WAFv2 web ACL** to block common attacks at the edge.',
      'Enable real-time logs to S3 for security incident reviews.',
    ],
    pairs_well_with: ['S3', 'ALB', 'WAF', 'Shield', 'Route53'],
    sample_terraform: `resource "aws_cloudfront_distribution" "site" {
  enabled = true
  default_cache_behavior {
    target_origin_id       = "s3-assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
  }
  origin {
    domain_name = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id   = "s3-assets"
  }
  viewer_certificate { cloudfront_default_certificate = true }
  restrictions { geo_restriction { restriction_type = "none" } }
}`,
  },
  Route53: {
    short_name: 'Amazon Route 53',
    purpose: 'Authoritative DNS plus health checks and traffic-flow routing.',
    when_to_use: [
      'Your apex domain and subdomains',
      'Multi-region failover via health-checked records',
      'Alias records to ALB / CloudFront / API Gateway',
    ],
    how_to_implement: [
      'Use **alias records** to AWS resources (zero additional cost vs. CNAME).',
      'Health-checked **failover** records for multi-region disaster recovery.',
      'Enable **DNSSEC** for the apex zone in production.',
    ],
    pairs_well_with: ['CloudFront', 'ALB'],
  },
  Lambda: {
    short_name: 'AWS Lambda',
    purpose: 'Run code in response to events without managing servers. Pay per invocation × duration × memory.',
    when_to_use: [
      'Event-driven glue (S3 → process → DynamoDB)',
      'Cron jobs (via EventBridge)',
      'Webhook receivers and async background jobs',
    ],
    how_to_implement: [
      'Keep packages small — cold-start scales with deployment size.',
      'Use **provisioned concurrency** for latency-sensitive paths.',
      'Set **dead-letter queues** (SQS) for async invocations.',
      'Inside a VPC only when you must — adds cold-start time and NAT cost.',
    ],
    pairs_well_with: ['DynamoDB', 'S3', 'KMS'],
  },
  ElastiCache: {
    short_name: 'Amazon ElastiCache',
    purpose: 'Managed Redis or Memcached. Sub-millisecond cache for sessions, rate limits, leaderboards, queues.',
    when_to_use: [
      'Read-heavy DB workloads (cache-aside pattern)',
      'Session storage for stateless API tiers',
      'Distributed rate limiting / token buckets',
    ],
    how_to_implement: [
      'Production: **Redis with Multi-AZ + automatic failover**.',
      'Encryption in transit + at rest with KMS.',
      'Right-size memory; use the `r5` family for memory-bound workloads.',
    ],
    pairs_well_with: ['EC2', 'EKS', 'RDS'],
  },
  EKS: {
    short_name: 'Amazon EKS',
    purpose: 'Managed Kubernetes control plane. AWS runs the API server and etcd; you manage worker nodes (or use Fargate).',
    when_to_use: [
      'Existing Kubernetes ecosystems (charts, operators)',
      'Multi-tenant container platforms',
      'Microservices that need fine-grained networking (Istio, Cilium)',
    ],
    how_to_implement: [
      '**EKS Auto Mode** if you want to avoid managing node groups entirely.',
      'IRSA (IAM Roles for Service Accounts) for least-privilege pod IAM.',
      'AWS Load Balancer Controller to provision ALBs per Ingress.',
    ],
    pairs_well_with: ['ALB', 'EC2', 'KMS', 'NATGateway'],
  },
  WAF: {
    short_name: 'AWS WAF',
    purpose: 'Layer-7 firewall protecting CloudFront / ALB / API Gateway from common web exploits.',
    when_to_use: [
      'Anywhere user input reaches your services',
      'PCI / SOC 2 / fintech compliance baselines',
      'Bot mitigation and rate-based rules',
    ],
    how_to_implement: [
      'Start with the **Core rule set + Known bad inputs** managed rule groups.',
      'Add a **rate-based rule** at 2000 req / 5 min per IP.',
      'Log to S3 → Athena for ad-hoc analysis.',
    ],
    pairs_well_with: ['CloudFront', 'ALB'],
  },
  Shield: {
    short_name: 'AWS Shield',
    purpose: 'DDoS protection. Standard is free and on by default; Advanced ($3K/month) adds 24/7 SOC, cost protection, and L7 mitigation.',
    when_to_use: [
      'Public-facing apps that have been targeted before',
      'High-revenue endpoints where downtime is catastrophic',
    ],
    how_to_implement: [
      'Shield Standard is automatic — nothing to do.',
      'Shield Advanced: enrol resources, add Route 53 alarms, engage AWS DDoS Response Team contact.',
    ],
  },
  KMS: {
    short_name: 'AWS KMS',
    purpose: 'Customer-managed encryption keys for everything: RDS, S3, EBS, Secrets Manager, app-level envelope encryption.',
    when_to_use: [
      'Always — every workload should encrypt at rest with KMS keys',
      'PDPA / GDPR / HIPAA / PCI compliance',
    ],
    how_to_implement: [
      'One **CMK per data domain** (db, app-secrets, files), not one per resource.',
      'Enable **automatic key rotation** (free, annual).',
      'Restrict via key policy + IAM — both must allow the principal.',
    ],
    pairs_well_with: ['RDS', 'S3', 'EBS', 'DynamoDB', 'ElastiCache'],
  },
  Backup: {
    short_name: 'AWS Backup',
    purpose: 'Centralised, policy-based backup orchestration across EBS, RDS, DynamoDB, EFS, FSx, Storage Gateway.',
    when_to_use: [
      'Anywhere you need a single audit pane for backups',
      'Cross-account / cross-region backup vaults',
    ],
    how_to_implement: [
      'Tag-based selection: backup any resource with `Backup=true`.',
      'Two-vault pattern: in-region warm + cross-region cold (immutable).',
      'Test **restore** quarterly — a backup that has never been restored is not a backup.',
    ],
    pairs_well_with: ['EBS', 'RDS', 'DynamoDB', 'KMS'],
  },
  DataTransferOut: {
    short_name: 'Data Transfer Out',
    purpose: 'Egress out of AWS to the public internet. Often the surprise on the bill.',
    when_to_use: [
      'It is not optional — it appears anywhere users download data from your services.',
    ],
    how_to_implement: [
      'Front everything user-facing with **CloudFront** — egress from CF is much cheaper than from regions.',
      'Use **VPC Gateway Endpoints** for S3/DynamoDB to avoid NAT egress charges.',
      'Watch the AWS Cost Explorer "data transfer" filter weekly.',
    ],
    pairs_well_with: ['CloudFront'],
  },
};

function getServiceDoc(name) {
  return SERVICE_DOCS[name] || null;
}

module.exports = { SERVICE_DOCS, getServiceDoc };
