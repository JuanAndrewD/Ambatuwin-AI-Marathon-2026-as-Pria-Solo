// The Cloud Infrastructure Architect — web server.
// Serves the Vite-built React client from /client/dist (or the legacy /public
// fallback) and exposes the project + chat + design REST API.

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');

const { listRegions } = require('./lib/catalog');
const { design, chatTurn, draftBriefFromHistory, refineBriefFromText, quickSpec, findReferencedDocs, ALL_SERVICES } = require('./lib/architect');
const projects = require('./lib/projects');
const { getCatalogPublic } = require('./lib/catalog-api');
const { getServiceDoc, SERVICE_DOCS } = require('./lib/service-docs');
const { rateLimit } = require('./lib/rate-limit');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// Per-IP rate limits
const chatRateLimit   = rateLimit({ name: 'chat',   windowMs: 60_000, max: 30 });
const designRateLimit = rateLimit({ name: 'design', windowMs: 60_000, max: 6  });
const uploadRateLimit = rateLimit({ name: 'upload', windowMs: 60_000, max: 12 });

// ---- Static: prefer the React build, fall back to the legacy public site ----
const clientDist = path.join(__dirname, 'client', 'dist');
const legacyPublic = path.join(__dirname, 'public');
const staticDir = fs.existsSync(path.join(clientDist, 'index.html'))
  ? clientDist
  : (fs.existsSync(path.join(legacyPublic, 'index.html')) ? legacyPublic : clientDist);
app.use(express.static(staticDir));

// ---- Catalog ---------------------------------------------------------------

app.get('/api/regions', (_req, res) => {
  res.json({ regions: listRegions() });
});

app.get('/api/catalog', (_req, res) => {
  res.json(getCatalogPublic());
});

app.get('/api/services', (_req, res) => {
  res.json({ services: ALL_SERVICES });
});

// Per-service deep documentation. Used by the /services/:name route + the
// resources panel "Learn more" affordance.
app.get('/api/services/:name', (req, res) => {
  const name = req.params.name;
  const doc = getServiceDoc(name);
  if (!doc) return res.status(404).json({ error: 'service not found' });
  const cat = getCatalogPublic();
  const summary = cat.services.find(s => s.name === name);

  // Pull a per-region pricing preview straight from the deterministic catalog.
  const { CATALOG } = require('./lib/catalog');
  const svc = CATALOG.services[name];
  const pricing = buildServicePricingPreview(name, svc);

  res.json({
    name,
    summary: summary || null,
    doc,
    pricing,
    pricing_model: 'on-demand list (USD), 730 h/month',
  });
});

function buildServicePricingPreview(name, svc) {
  if (!svc) return null;
  const HOURS = require('./lib/catalog').HOURS_PER_MONTH;
  const regions = svc.available_in.includes('GLOBAL') ? ['GLOBAL'] : svc.available_in;
  const out = [];
  for (const r of regions) {
    let price, suffix, label;
    switch (name) {
      case 'EC2': {
        const inst = svc.instance_types?.['t3.medium'];
        if (!inst) continue;
        price = inst.price_per_hour[r] * HOURS;
        suffix = ' / mo';
        label = 't3.medium @ 730 h';
        break;
      }
      case 'RDS': {
        const inst = svc.instance_types?.['db.m5.large'];
        if (!inst) continue;
        price = inst.price_per_hour[r] * HOURS;
        suffix = ' / mo';
        label = 'db.m5.large single-AZ @ 730 h';
        break;
      }
      case 'ElastiCache': {
        const inst = svc.instance_types?.['cache.r5.large'];
        if (!inst) continue;
        price = inst.price_per_hour[r] * HOURS;
        suffix = ' / mo';
        label = 'cache.r5.large @ 730 h';
        break;
      }
      case 'DynamoDB': {
        price = svc.on_demand.write_per_million[r];
        suffix = ' / 1M writes';
        label = 'On-demand writes';
        break;
      }
      case 'S3': {
        price = svc.standard_per_gb_month[r];
        suffix = ' / GB-mo';
        label = 'Standard storage class';
        break;
      }
      case 'EBS': {
        price = svc.gp3_per_gb_month[r];
        suffix = ' / GB-mo';
        label = 'gp3 volumes';
        break;
      }
      case 'ALB': {
        price = svc.fixed_per_hour[r] * HOURS;
        suffix = ' / mo';
        label = 'Fixed cost only (LCU not included)';
        break;
      }
      case 'NATGateway': {
        price = svc.fixed_per_hour[r] * HOURS;
        suffix = ' / mo';
        label = 'Fixed cost; data transfer extra';
        break;
      }
      case 'CloudFront': {
        price = svc.data_per_gb_apac;
        suffix = ' / GB';
        label = 'APAC edge egress';
        break;
      }
      case 'Route53': {
        price = svc.hosted_zone_per_month;
        suffix = ' / zone-mo';
        label = 'Hosted zone fee';
        break;
      }
      case 'Lambda': {
        price = svc.request_per_million[r];
        suffix = ' / 1M req';
        label = 'Request charge only';
        break;
      }
      case 'EKS': {
        price = svc.control_plane_per_hour * HOURS;
        suffix = ' / mo';
        label = 'Control plane only';
        break;
      }
      case 'WAF': {
        price = svc.web_acl_per_month;
        suffix = ' / Web ACL';
        label = 'Plus per-rule and per-request fees';
        break;
      }
      case 'KMS': {
        price = svc.key_per_month;
        suffix = ' / key-mo';
        label = 'Customer-managed key';
        break;
      }
      case 'Backup': {
        price = svc.warm_per_gb_month;
        suffix = ' / GB-mo';
        label = 'Warm tier';
        break;
      }
      case 'DataTransferOut': {
        price = svc.first_10tb_per_gb[r];
        suffix = ' / GB';
        label = 'First 10 TB tier';
        break;
      }
      case 'Shield': {
        price = svc.standard_per_month;
        suffix = ' (standard)';
        label = 'Advanced is $3,000 / mo';
        break;
      }
      default: continue;
    }
    if (price == null) continue;
    out.push({ region: r, price, suffix, label });
  }
  return out;
}

app.get('/api/services-overview', (_req, res) => {
  // Compact overview of every service for the landing/library grid.
  const cat = getCatalogPublic();
  const services = cat.services.map(s => ({
    ...s,
    short_name: SERVICE_DOCS[s.name]?.short_name || s.name,
    purpose: SERVICE_DOCS[s.name]?.purpose || '',
  }));
  res.json({ services });
});

// ---- Projects --------------------------------------------------------------

app.get('/api/projects', (_req, res) => {
  res.json({ projects: projects.listProjects() });
});

app.post('/api/projects', (req, res) => {
  const { name, region, brief, enabled_services } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const project = projects.createProject({ name: String(name).trim(), region, brief, enabled_services });
  res.status(201).json({ project });
});

app.get('/api/projects/:id', (req, res) => {
  const p = projects.getProject(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({ project: p });
});

app.patch('/api/projects/:id', (req, res) => {
  const p = projects.updateProject(req.params.id, req.body || {});
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({ project: p });
});

app.delete('/api/projects/:id', (req, res) => {
  const ok = projects.deleteProject(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.post('/api/projects/:id/clear-chat', (req, res) => {
  const p = projects.clearChat(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json({ project: p });
});

// ---- Documents (per-project markdown files) -------------------------------

app.get('/api/projects/:id/documents', (req, res) => {
  const docs = projects.listDocuments(req.params.id);
  if (!docs) return res.status(404).json({ error: 'project not found' });
  res.json({ documents: docs });
});

app.post('/api/projects/:id/documents', (req, res) => {
  const doc = projects.createDocument(req.params.id, req.body || {});
  if (!doc) return res.status(404).json({ error: 'project not found' });
  res.status(201).json({ document: doc });
});

app.get('/api/projects/:id/documents/:docId', (req, res) => {
  const doc = projects.getDocument(req.params.id, req.params.docId);
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json({ document: doc });
});

app.patch('/api/projects/:id/documents/:docId', (req, res) => {
  const doc = projects.updateDocument(req.params.id, req.params.docId, req.body || {});
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json({ document: doc });
});

app.delete('/api/projects/:id/documents/:docId', (req, res) => {
  const ok = projects.deleteDocument(req.params.id, req.params.docId);
  if (!ok) return res.status(400).json({ error: 'cannot delete (not found, or it is the brief which is undeletable)' });
  res.json({ ok: true });
});

// ---- Refine brief from current editor text --------------------------------

app.post('/api/projects/:id/refine-brief', designRateLimit, async (req, res) => {
  const project = projects.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const sourceText = String(req.body?.source || '').trim();
  if (!sourceText) return res.status(400).json({ error: 'source text is required' });
  try {
    const { content, model } = await refineBriefFromText({ project, sourceText });
    const briefDoc = (project.documents || []).find(d => d.type === 'brief');
    let document;
    if (briefDoc) document = projects.updateDocument(project.id, briefDoc.id, { content });
    else document = projects.createDocument(project.id, { type: 'brief', name: 'Requirements brief', content, included_in_context: true });
    projects.updateProject(project.id, { brief: content });
    res.json({ document, model });
  } catch (err) {
    console.error('[refine-brief] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Quick Spec (Kiro-style: Requirements → Design → Tasks) ---------------

app.post('/api/projects/:id/quick-spec', designRateLimit, async (req, res) => {
  const project = projects.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  try {
    const explicitContext = (project.documents || []).filter(d => d.included_in_context && d.content);
    const referenced = findReferencedDocs(prompt, project.documents || []);
    const byId = new Map();
    for (const d of [...explicitContext, ...referenced]) byId.set(d.id, d);
    const contextDocs = Array.from(byId.values());

    const { content, model } = await quickSpec({
      project, prompt, catalogPublic: getCatalogPublic(), contextDocs,
    });
    // Save the result as a new spec document.
    const safeName = `spec-${new Date().toISOString().slice(0,10)}-${Math.random().toString(36).slice(2, 6)}.md`;
    const document = projects.createDocument(project.id, {
      type: 'plan', name: safeName, content, included_in_context: false,
    });
    res.json({ document, model });
  } catch (err) {
    console.error('[quick-spec] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Draft brief from chat history ----------------------------------------

app.post('/api/projects/:id/draft-brief', designRateLimit, async (req, res) => {
  const project = projects.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  try {
    const { content, model } = await draftBriefFromHistory({
      project,
      history: project.chat || [],
    });
    // Persist into the existing brief document.
    const briefDoc = (project.documents || []).find(d => d.type === 'brief');
    let document = null;
    if (briefDoc) {
      document = projects.updateDocument(project.id, briefDoc.id, { content });
    } else {
      document = projects.createDocument(project.id, {
        type: 'brief', name: 'Requirements brief', content, included_in_context: true,
      });
    }
    // Mirror back into project.brief for legacy paths.
    projects.updateProject(project.id, { brief: content });
    res.json({ document, model });
  } catch (err) {
    console.error('[draft-brief] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Chat (rate-limited, with attachments + document context injection) ----

app.post('/api/projects/:id/chat', uploadRateLimit, async (req, res) => {
  const project = projects.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const { message, attachments } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required' });

  // Validate attachments shape and size on the server even though the client
  // also caps them. attachments: [{ name, bytes, content }]
  const safeAttachments = [];
  if (Array.isArray(attachments)) {
    if (attachments.length > 5) return res.status(400).json({ error: 'too many attachments (max 5 per message)' });
    let totalBytes = 0;
    for (const a of attachments) {
      const name = String(a?.name || 'file').slice(0, 200);
      const content = String(a?.content || '');
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > 200_000) return res.status(413).json({ error: `attachment "${name}" exceeds 200 KB` });
      totalBytes += bytes;
      if (totalBytes > 500_000) return res.status(413).json({ error: 'attachments exceed 500 KB total' });
      safeAttachments.push({ name, bytes, content });
    }
  }

  const userEntry = projects.appendChat(project.id, {
    role: 'user',
    content: String(message),
    attachments: safeAttachments.map(a => ({ name: a.name, bytes: a.bytes })), // metadata only on disk
  });

  // Documents the user has marked as "in context" — these are injected into
  // the system prompt so the architect can refer to them.
  const explicitContext = (project.documents || []).filter(d => d.included_in_context && d.content);
  // ALSO pick up any "#docname" references in the user's message (Kiro-style).
  const referenced = findReferencedDocs(String(message), project.documents || []);
  // Merge unique by id.
  const byId = new Map();
  for (const d of [...explicitContext, ...referenced]) byId.set(d.id, d);
  const contextDocs = Array.from(byId.values());

  try {
    const { content, model } = await chatTurn({
      project,
      history: project.chat || [],
      userMessage: String(message),
      catalogPublic: getCatalogPublic(),
      attachments: safeAttachments,
      contextDocs,
    });
    const assistantEntry = projects.appendChat(project.id, { role: 'assistant', content, model });
    res.json({ user: userEntry, assistant: assistantEntry });
  } catch (err) {
    console.error('[chat] error:', err);
    const assistantEntry = projects.appendChat(project.id, {
      role: 'assistant',
      content: `⚠️ I couldn't reach the LLM: ${err.message}`,
      error: true,
    });
    res.status(500).json({ user: userEntry, assistant: assistantEntry, error: err.message });
  }
});

// ---- Generate full plan (one-shot, deterministic guardrail) -----------------

app.post('/api/projects/:id/design', designRateLimit, async (req, res) => {
  const project = projects.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const brief = String(req.body?.brief || project.brief || '').trim();
  if (!brief) return res.status(400).json({ error: 'project has no brief; set one first' });

  try {
    const result = await design({
      brief,
      regionCode: project.region,
      additionalCompliance: Array.isArray(req.body?.compliance) ? req.body.compliance : [],
      allowedServices: project.enabled_services,
    });
    projects.updateProject(project.id, { brief, last_plan: result });
    // also drop a trace into the chat so the conversation reflects the action
    projects.appendChat(project.id, {
      role: 'assistant',
      content: `📐 **Generated deployment plan** — ${result.priced.items.length} components, **$${result.priced.total.toFixed(2)}/month** in \`${result.region.code}\`. Check the **Studio** panel for the full document, diagram, and itemized bill.`,
      meta: { kind: 'plan-generated', total: result.priced.total },
    });
    res.json({ result });
  } catch (err) {
    console.error('[design] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Legacy single-shot endpoint (no project)
app.post('/api/design', async (req, res) => {
  const { brief, region, compliance, services } = req.body || {};
  if (!brief || !region) return res.status(400).json({ error: 'brief and region are required' });
  try {
    const result = await design({
      brief: String(brief),
      regionCode: String(region),
      additionalCompliance: Array.isArray(compliance) ? compliance : [],
      allowedServices: Array.isArray(services) ? services : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('[design] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// SPA fallback — return index.html for any non-API path so client-side routing works.
app.get(/^(?!\/api\/).*/, (_req, res, next) => {
  const indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`☁️  Cloud Infrastructure Architect running at http://localhost:${PORT}`);
  console.log(`    Serving static from: ${staticDir}`);
});
