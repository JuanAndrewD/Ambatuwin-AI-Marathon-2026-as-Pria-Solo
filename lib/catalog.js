// Deterministic AWS catalog helpers.
// Pricing and region availability are computed from data/aws-catalog.json,
// never from the LLM, so the bill cannot be hallucinated.

const fs = require('fs');
const path = require('path');

const CATALOG = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'aws-catalog.json'), 'utf8')
);

const HOURS_PER_MONTH = CATALOG._meta.hours_per_month;

function listRegions() {
  return Object.entries(CATALOG.regions).map(([code, r]) => ({
    code,
    name: r.name,
    country: r.country,
    data_residency: r.data_residency,
  }));
}

function getRegion(regionCode) {
  return CATALOG.regions[regionCode] || null;
}

function isServiceAvailableInRegion(serviceName, regionCode) {
  const svc = CATALOG.services[serviceName];
  if (!svc) return false;
  return svc.available_in.includes(regionCode) || svc.available_in.includes('GLOBAL');
}

function suggestRegionFallback(regionCode, serviceName) {
  // If the service is not available in regionCode, pick the closest region (lowest avg latency_to)
  const region = CATALOG.regions[regionCode];
  if (!region) return null;
  const candidates = Object.entries(CATALOG.regions)
    .filter(([code]) => code !== regionCode && isServiceAvailableInRegion(serviceName, code));
  if (candidates.length === 0) return null;
  // Use the country of the original region to find a region that serves that country well
  const country = countryShortFor(region.country);
  candidates.sort((a, b) => {
    const la = a[1].latency_to[country] ?? 9999;
    const lb = b[1].latency_to[country] ?? 9999;
    return la - lb;
  });
  return candidates[0][0];
}

function countryShortFor(country) {
  const map = {
    'Malaysia': 'MY', 'Singapore': 'SG', 'Indonesia': 'ID', 'Thailand': 'TH',
    'Japan': 'JP', 'India': 'IN', 'United States': 'US', 'Ireland': 'EU',
    'Philippines': 'PH', 'Vietnam': 'VN', 'Australia': 'AU',
  };
  return map[country] || 'US';
}

// ---- Pricing helpers --------------------------------------------------------

function priceEC2(instanceType, regionCode, count = 1, hoursPerMonth = HOURS_PER_MONTH) {
  const inst = CATALOG.services.EC2.instance_types[instanceType];
  if (!inst) return { ok: false, error: `Unknown EC2 instance type: ${instanceType}` };
  const hourly = inst.price_per_hour[regionCode];
  if (hourly == null) return { ok: false, error: `EC2 ${instanceType} not priced in ${regionCode}` };
  return {
    ok: true,
    monthly: round2(hourly * hoursPerMonth * count),
    detail: `${count} × ${instanceType} @ $${hourly}/h × ${hoursPerMonth}h`,
    specs: `${inst.vcpu} vCPU, ${inst.ram_gb} GB RAM`,
  };
}

function priceRDS(instanceType, regionCode, opts = {}) {
  const { storageGB = 100, multiAZ = false, count = 1 } = opts;
  const svc = CATALOG.services.RDS;
  const inst = svc.instance_types[instanceType];
  if (!inst) return { ok: false, error: `Unknown RDS instance type: ${instanceType}` };
  const hourly = inst.price_per_hour[regionCode];
  if (hourly == null) return { ok: false, error: `RDS ${instanceType} not priced in ${regionCode}` };
  const azMult = multiAZ ? svc.multi_az_multiplier : 1;
  const computeMonthly = hourly * HOURS_PER_MONTH * count * azMult;
  const storageMonthly = svc.storage_per_gb_month[regionCode] * storageGB * count * azMult;
  return {
    ok: true,
    monthly: round2(computeMonthly + storageMonthly),
    detail: `${count} × ${instanceType}${multiAZ ? ' Multi-AZ' : ''} + ${storageGB} GB gp3 storage`,
    specs: `${inst.vcpu} vCPU, ${inst.ram_gb} GB RAM`,
  };
}

function priceDynamoDB(regionCode, opts = {}) {
  const { writesPerMonth = 1_000_000, readsPerMonth = 5_000_000, storageGB = 25 } = opts;
  const od = CATALOG.services.DynamoDB.on_demand;
  const monthly =
    (writesPerMonth / 1_000_000) * od.write_per_million[regionCode] +
    (readsPerMonth / 1_000_000) * od.read_per_million[regionCode] +
    storageGB * od.storage_per_gb_month[regionCode];
  return {
    ok: true,
    monthly: round2(monthly),
    detail: `${(writesPerMonth/1e6).toFixed(1)}M writes + ${(readsPerMonth/1e6).toFixed(1)}M reads + ${storageGB} GB storage (on-demand)`,
  };
}

function priceS3(regionCode, opts = {}) {
  const { storageGB = 100, putRequestsPerMonth = 10_000, getRequestsPerMonth = 100_000 } = opts;
  const svc = CATALOG.services.S3;
  const monthly =
    storageGB * svc.standard_per_gb_month[regionCode] +
    (putRequestsPerMonth / 1000) * svc.request_per_1k_put[regionCode] +
    (getRequestsPerMonth / 1000) * svc.request_per_1k_get[regionCode];
  return {
    ok: true,
    monthly: round2(monthly),
    detail: `${storageGB} GB Standard + ${(putRequestsPerMonth/1000).toFixed(1)}K PUT + ${(getRequestsPerMonth/1000).toFixed(1)}K GET`,
  };
}

function priceEBS(regionCode, opts = {}) {
  const { sizeGB = 100, count = 1 } = opts;
  const ratePerGB = CATALOG.services.EBS.gp3_per_gb_month[regionCode];
  return {
    ok: true,
    monthly: round2(sizeGB * ratePerGB * count),
    detail: `${count} × ${sizeGB} GB gp3 EBS volume`,
  };
}

function priceALB(regionCode, opts = {}) {
  const { lcuAvg = 5, count = 1 } = opts;
  const svc = CATALOG.services.ALB;
  const monthly = (svc.fixed_per_hour[regionCode] + svc.lcu_per_hour[regionCode] * lcuAvg) * HOURS_PER_MONTH * count;
  return {
    ok: true,
    monthly: round2(monthly),
    detail: `${count} × Application Load Balancer with ~${lcuAvg} LCU avg`,
  };
}

function priceNATGateway(regionCode, opts = {}) {
  const { count = 1, gbPerMonth = 100 } = opts;
  const svc = CATALOG.services.NATGateway;
  const monthly = (svc.fixed_per_hour[regionCode] * HOURS_PER_MONTH + svc.data_per_gb[regionCode] * gbPerMonth) * count;
  return {
    ok: true,
    monthly: round2(monthly),
    detail: `${count} × NAT Gateway + ${gbPerMonth} GB/mo data`,
  };
}

function priceCloudFront(opts = {}) {
  const { gbPerMonth = 500, requestsPerMonth = 1_000_000, edgeRegion = 'apac' } = opts;
  const svc = CATALOG.services.CloudFront;
  const dataRate = edgeRegion === 'us' ? svc.data_per_gb_us : edgeRegion === 'eu' ? svc.data_per_gb_eu : svc.data_per_gb_apac;
  const monthly = gbPerMonth * dataRate + (requestsPerMonth / 10_000) * svc.request_per_10k;
  return {
    ok: true,
    monthly: round2(monthly),
    detail: `${gbPerMonth} GB egress + ${(requestsPerMonth/1e6).toFixed(2)}M requests (${edgeRegion.toUpperCase()} edge)`,
  };
}

function priceRoute53(opts = {}) {
  const { hostedZones = 1, queriesPerMonth = 1_000_000 } = opts;
  const svc = CATALOG.services.Route53;
  const monthly = hostedZones * svc.hosted_zone_per_month + (queriesPerMonth / 1_000_000) * svc.queries_per_million_first_billion;
  return {
    ok: true,
    monthly: round2(monthly),
    detail: `${hostedZones} hosted zone(s) + ${(queriesPerMonth/1e6).toFixed(1)}M queries`,
  };
}

function priceLambda(regionCode, opts = {}) {
  const { requestsPerMonth = 1_000_000, avgDurationMs = 200, memoryMB = 512 } = opts;
  const svc = CATALOG.services.Lambda;
  const gbSeconds = requestsPerMonth * (avgDurationMs / 1000) * (memoryMB / 1024);
  const monthly =
    (requestsPerMonth / 1_000_000) * svc.request_per_million[regionCode] +
    gbSeconds * svc.gb_second[regionCode];
  return {
    ok: true,
    monthly: round2(monthly),
    detail: `${(requestsPerMonth/1e6).toFixed(2)}M req × ${avgDurationMs}ms × ${memoryMB} MB`,
  };
}

function priceElastiCache(instanceType, regionCode, count = 1) {
  const inst = CATALOG.services.ElastiCache.instance_types[instanceType];
  if (!inst) return { ok: false, error: `Unknown ElastiCache type: ${instanceType}` };
  const hourly = inst.price_per_hour[regionCode];
  if (hourly == null) return { ok: false, error: `ElastiCache ${instanceType} not priced in ${regionCode}` };
  return {
    ok: true,
    monthly: round2(hourly * HOURS_PER_MONTH * count),
    detail: `${count} × ${instanceType}`,
    specs: `${inst.ram_gb} GB RAM`,
  };
}

function priceEKS(opts = {}) {
  const { clusters = 1 } = opts;
  return {
    ok: true,
    monthly: round2(CATALOG.services.EKS.control_plane_per_hour * HOURS_PER_MONTH * clusters),
    detail: `${clusters} × EKS control plane`,
  };
}

function priceWAF(opts = {}) {
  const { rules = 5, requestsPerMonth = 1_000_000 } = opts;
  const svc = CATALOG.services.WAF;
  const monthly = svc.web_acl_per_month + rules * svc.rule_per_month + (requestsPerMonth / 1_000_000) * svc.request_per_million;
  return {
    ok: true,
    monthly: round2(monthly),
    detail: `1 Web ACL + ${rules} rules + ${(requestsPerMonth/1e6).toFixed(1)}M req`,
  };
}

function priceShield(opts = {}) {
  const { advanced = false } = opts;
  return {
    ok: true,
    monthly: advanced ? CATALOG.services.Shield.advanced_per_month : 0,
    detail: advanced ? 'Shield Advanced subscription' : 'Shield Standard (free)',
  };
}

function priceKMS(opts = {}) {
  const { keys = 1, requestsPerMonth = 50_000 } = opts;
  const svc = CATALOG.services.KMS;
  return {
    ok: true,
    monthly: round2(keys * svc.key_per_month + (requestsPerMonth / 10_000) * svc.request_per_10k),
    detail: `${keys} customer-managed key(s) + ${(requestsPerMonth/1000).toFixed(1)}K requests`,
  };
}

function priceBackup(opts = {}) {
  const { storageGB = 100 } = opts;
  return {
    ok: true,
    monthly: round2(storageGB * CATALOG.services.Backup.warm_per_gb_month),
    detail: `${storageGB} GB warm backup storage`,
  };
}

function priceDataTransferOut(regionCode, opts = {}) {
  const { gbPerMonth = 100 } = opts;
  const rate = CATALOG.services.DataTransferOut.first_10tb_per_gb[regionCode];
  return {
    ok: true,
    monthly: round2(gbPerMonth * rate),
    detail: `${gbPerMonth} GB egress`,
  };
}

// ---- Compliance check -------------------------------------------------------

function checkCompliance(regionCode, requiredFrameworks = []) {
  const region = getRegion(regionCode);
  if (!region) return { ok: false, issues: [`Unknown region ${regionCode}`] };
  const granted = new Set(region.data_residency);
  const issues = [];
  const passes = [];
  for (const fw of requiredFrameworks) {
    const meta = CATALOG.compliance_frameworks[fw];
    if (!meta) {
      issues.push(`Unknown framework requested: ${fw}`);
      continue;
    }
    const countryOk = meta.data_must_stay_in.length === 0
      || meta.data_must_stay_in.includes(countryShortFor(region.country))
      || (meta.data_must_stay_in.includes('EU') && region.country === 'Ireland');
    const grantedOk = granted.has(fw);
    if (countryOk && grantedOk) {
      passes.push(`${fw} ✅ ${meta.full_name} — region ${regionCode} resides in ${region.country}`);
    } else {
      issues.push(`${fw} ❌ ${meta.full_name} — required country/framework not met by ${regionCode} (${region.country}). Consider relocating to a region in ${meta.data_must_stay_in.join(', ') || 'an attested location'}.`);
    }
  }
  return { ok: issues.length === 0, issues, passes };
}

// ---- Utility ----------------------------------------------------------------

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  CATALOG,
  HOURS_PER_MONTH,
  listRegions,
  getRegion,
  isServiceAvailableInRegion,
  suggestRegionFallback,
  priceEC2,
  priceRDS,
  priceDynamoDB,
  priceS3,
  priceEBS,
  priceALB,
  priceNATGateway,
  priceCloudFront,
  priceRoute53,
  priceLambda,
  priceElastiCache,
  priceEKS,
  priceWAF,
  priceShield,
  priceKMS,
  priceBackup,
  priceDataTransferOut,
  checkCompliance,
  countryShortFor,
};
