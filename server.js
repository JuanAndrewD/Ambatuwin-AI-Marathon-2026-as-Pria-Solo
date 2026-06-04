// The Cloud Infrastructure Architect — web server.
// Serves the Vite-built React client from /client/dist (or the legacy /public
// fallback) and exposes the project + chat + design REST API.
//
// State is persisted in PostgreSQL (lib/db.js). Users authenticate with GitHub
// (lib/routes-auth.js) and every project is scoped to the signed-in user's
// database row, so accounts, sessions, and projects are fully isolated.

// `override: true` makes the local .env authoritative over any stale variables
// already exported in the shell (e.g. a leftover DATABASE_URL from a previous
// test session). On hosting platforms like Render there is no .env file, so
// this is a no-op there and the platform-injected env vars remain in effect.
require('dotenv').config({ override: true });

const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const db = require('./lib/db');
const { listRegions } = require('./lib/catalog');
const { design, chatTurn, draftBriefFromHistory, refineBriefFromText, quickSpec, findReferencedDocs, ALL_SERVICES } = require('./lib/architect');
const projects = require('./lib/projects');
const users = require('./lib/users');
const ghApi = require('./lib/github-api');
const { getCatalogPublic } = require('./lib/catalog-api');
const { getServiceDoc, SERVICE_DOCS } = require('./lib/service-docs');
const { rateLimit } = require('./lib/rate-limit');
const authRoutes = require('./lib/routes-auth');
const { router: githubRoutes, requireUserWithToken } = require('./lib/routes-github');

const app = express();
app.set('trust proxy', 1);
// Raised from 1mb: chat attachments now carry text extracted from large PDFs,
// DOCX and PPTX documents on the client, which can be several MB of text.
app.use(express.json({ limit: '16mb' }));

// ---- Session (PostgreSQL-backed cookie sessions) ---------------------------
const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production'
  || !!process.env.RENDER || !!process.env.RENDER_EXTERNAL_URL;

app.use(session({
  name: 'cia.sid',
  store: new PgSession({
    pool: db.pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'cia-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,                 // HTTPS-only cookies in production
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
}));

// Per-IP rate limits
const chatRateLimit   = rateLimit({ name: 'chat',   windowMs: 60_000, max: 30 });
const designRateLimit = rateLimit({ name: 'design', windowMs: 60_000, max: 6  });
const uploadRateLimit = rateLimit({ name: 'upload', windowMs: 60_000, max: 12 });

// Require an authenticated session for all project + document + chat routes.
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not signed in' });
  next();
}

// ---- Static: prefer the React build, fall back to the legacy public site ----
const clientDist = path.join(__dirname, 'client', 'dist');
const legacyPublic = path.join(__dirname, 'public');
const staticDir = fs.existsSync(path.join(clientDist, 'index.html'))
  ? clientDist
  : (fs.existsSync(path.join(legacyPublic, 'index.html')) ? legacyPublic : clientDist);
app.use(express.static(staticDir));

// ---- Auth + GitHub ---------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/github', githubRoutes);

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

// ---- Projects (all scoped to the signed-in user) ---------------------------

app.get('/api/projects', requireAuth, async (req, res) => {
  try {
    res.json({ projects: await projects.listProjects(req.session.userId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/projects', requireAuth, async (req, res) => {
  const { name, region, brief, enabled_services } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const project = await projects.createProject(req.session.userId, { name: String(name).trim(), region, brief, enabled_services });
    res.status(201).json({ project });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const p = await projects.getProject(req.session.userId, req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json({ project: p });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const p = await projects.updateProject(req.session.userId, req.params.id, req.body || {});
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json({ project: p });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const ok = await projects.deleteProject(req.session.userId, req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/projects/:id/clear-chat', requireAuth, async (req, res) => {
  try {
    const p = await projects.clearChat(req.session.userId, req.params.id);
    if (!p) return res.status(404).json({ error: 'not found' });
    res.json({ project: p });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Documents (per-project markdown files) -------------------------------

app.get('/api/projects/:id/documents', requireAuth, async (req, res) => {
  try {
    const docs = await projects.listDocuments(req.session.userId, req.params.id);
    if (!docs) return res.status(404).json({ error: 'project not found' });
    res.json({ documents: docs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/projects/:id/documents', requireAuth, async (req, res) => {
  try {
    const doc = await projects.createDocument(req.session.userId, req.params.id, req.body || {});
    if (!doc) return res.status(404).json({ error: 'project not found' });
    res.status(201).json({ document: doc });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/projects/:id/documents/:docId', requireAuth, async (req, res) => {
  try {
    const doc = await projects.getDocument(req.session.userId, req.params.id, req.params.docId);
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json({ document: doc });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/projects/:id/documents/:docId', requireAuth, async (req, res) => {
  try {
    const doc = await projects.updateDocument(req.session.userId, req.params.id, req.params.docId, req.body || {});
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json({ document: doc });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/projects/:id/documents/:docId', requireAuth, async (req, res) => {
  try {
    const ok = await projects.deleteDocument(req.session.userId, req.params.id, req.params.docId);
    if (!ok) return res.status(400).json({ error: 'cannot delete (not found, or it is the brief which is undeletable)' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Binary document blobs (PDF/DOCX/PPTX originals) -----------------------
// Two-step upload keeps the JSON body small: the client first POSTs the doc
// metadata + extracted text (above), then PUTs the original file bytes here.
const MAX_BLOB_BYTES = 50 * 1024 * 1024; // 50 MB — under GitHub's warn/block thresholds
const rawBlob = express.raw({ type: '*/*', limit: '52mb' });

app.put('/api/projects/:id/documents/:docId/raw', requireAuth, rawBlob, async (req, res) => {
  try {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buf.length === 0) return res.status(400).json({ error: 'empty file body' });
    if (buf.length > MAX_BLOB_BYTES) return res.status(413).json({ error: 'file exceeds 50 MB' });
    const mime = String(req.get('content-type') || 'application/octet-stream').split(';')[0];
    const ok = await projects.putDocumentBlob(req.session.userId, req.params.id, req.params.docId, { buffer: buf, mime });
    if (!ok) return res.status(404).json({ error: 'project or document not found' });
    res.json({ ok: true, bytes: buf.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/projects/:id/documents/:docId/raw', requireAuth, async (req, res) => {
  try {
    const doc = await projects.getDocument(req.session.userId, req.params.id, req.params.docId);
    if (!doc) return res.status(404).json({ error: 'not found' });
    const blob = await projects.getDocumentBlob(req.session.userId, req.params.id, req.params.docId);
    if (!blob) return res.status(404).json({ error: 'no original file stored for this document' });
    const disposition = req.query.download ? 'attachment' : 'inline';
    res.setHeader('Content-Type', blob.mime || doc.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(doc.name)}"`);
    res.setHeader('Content-Length', blob.data.length);
    res.send(blob.data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- GitHub: connect a repo to a project + push markdown -------------------
// A repo is attached to a project (max one per project, zero allowed). The
// signed-in user's OAuth token authenticates the Git API calls.

// Connect an existing repo OR create a new one, then store the mapping on the
// project row. Body: { mode:'existing', owner, name, branch? }
//                  | { mode:'create',   name, private?, description?, branch? }
app.post('/api/projects/:id/github/connect', requireAuth, requireUserWithToken, async (req, res) => {
  try {
    const project = await projects.getProject(req.session.userId, req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const { mode } = req.body || {};
    let repoInfo;
    if (mode === 'create') {
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ error: 'repository name is required' });
      repoInfo = await ghApi.createRepo(req.ghUser.access_token, {
        name,
        description: String(req.body?.description || 'Architecture deliverables — Cloud Infrastructure Architect'),
        private: req.body?.private !== false,
        auto_init: true,
      });
    } else {
      const owner = String(req.body?.owner || '').trim();
      const name = String(req.body?.name || '').trim();
      if (!owner || !name) return res.status(400).json({ error: 'owner and name are required' });
      repoInfo = await ghApi.getRepo(req.ghUser.access_token, owner, name);
    }

    const branch = String(req.body?.branch || '').trim() || repoInfo.default_branch || 'main';
    const mapping = {
      owner: repoInfo.owner.login,
      name: repoInfo.name,
      full_name: repoInfo.full_name,
      branch,
      default_branch: repoInfo.default_branch,
      html_url: repoInfo.html_url,
      private: repoInfo.private,
      connected_at: new Date().toISOString(),
    };
    const updated = await projects.setRepo(req.session.userId, project.id, mapping);
    res.json({ project: updated, repo: mapping });
  } catch (err) {
    console.error('[github connect] error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Disconnect the repo from a project (the repo itself is left untouched).
app.delete('/api/projects/:id/github/repo', requireAuth, async (req, res) => {
  try {
    const project = await projects.getProject(req.session.userId, req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });
    const updated = await projects.setRepo(req.session.userId, project.id, null);
    res.json({ project: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Push the project's markdown via the Git Trees API into its connected repo.
app.post('/api/projects/:id/github/sync', requireAuth, requireUserWithToken, async (req, res) => {
  try {
    const project = await projects.getProject(req.session.userId, req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const repo = project.repo;
    if (!repo || !repo.owner || !repo.name) {
      return res.status(400).json({ error: 'no repository connected to this project; connect one first' });
    }

    // Allow a per-sync subfolder + branch override; default to the connected
    // repo's branch and a folder named after the project.
    const branch = String(req.body?.branch || repo.branch || repo.default_branch || 'main');
    const subdir = sanitizeDir(req.body?.path != null ? String(req.body.path) : slug(project.name));

    const files = await buildProjectFiles(req.session.userId, project, subdir);
    if (files.length === 0) return res.status(400).json({ error: 'project has no documents to sync' });

    const message = String(req.body?.message || `Sync "${project.name}" from Cloud Infrastructure Architect`);
    const result = await ghApi.pushFiles(req.ghUser.access_token, {
      owner: repo.owner, repo: repo.name, branch, message, files,
    });
    res.json({ result, files: files.map(f => f.path) });
  } catch (err) {
    console.error('[github sync] error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Collect every viable file for a project into a flat file list. Text documents
// push their (editable) content; unstructured/binary documents push their
// ORIGINAL bytes fetched from document_blobs. The generated deployment plan is
// included as markdown when present. Async because binaries hit the database.
async function buildProjectFiles(userId, project, subdir) {
  const prefix = subdir ? subdir.replace(/\/+$/, '') + '/' : '';
  const files = [];
  const seen = new Set();

  function uniquePath(rawName) {
    let name = sanitizeFile(rawName || 'document');
    if (!/\.[a-z0-9]+$/i.test(name)) name += '.md'; // give extensionless files a sensible default
    let candidate = `${prefix}${name}`;
    let n = 1;
    while (seen.has(candidate.toLowerCase())) {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      candidate = `${prefix}${base}-${n++}${ext}`;
    }
    seen.add(candidate.toLowerCase());
    return candidate;
  }

  function addText(rawName, content) {
    files.push({ path: uniquePath(rawName), content: content || '' });
  }
  function addBinary(rawName, buffer) {
    files.push({ path: uniquePath(rawName), contentBase64: buffer.toString('base64') });
  }

  for (const d of (project.documents || [])) {
    if (d.binary) {
      // Push the original file bytes. Fall back to the extracted text if the
      // blob is somehow missing (e.g. an interrupted upload).
      const blob = await projects.getDocumentBlob(userId, project.id, d.id);
      if (blob && blob.data && blob.data.length) {
        addBinary(d.name, blob.data);
      } else if (d.content) {
        addText(d.name.replace(/\.[^.]+$/, '') + '.txt', d.content);
      }
    } else {
      addText(d.name, d.content);
    }
  }

  if (project.last_plan?.markdown) {
    addText('deployment-plan.md', project.last_plan.markdown);
  }

  return files;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
}
function sanitizeFile(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'document.md';
}
function sanitizeDir(s) {
  return String(s).split('/').map(seg => seg.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('/').slice(0, 120);
}

// ---- Refine brief from current editor text --------------------------------

app.post('/api/projects/:id/refine-brief', requireAuth, designRateLimit, async (req, res) => {
  const project = await projects.getProject(req.session.userId, req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const sourceText = String(req.body?.source || '').trim();
  if (!sourceText) return res.status(400).json({ error: 'source text is required' });
  try {
    const { content, model } = await refineBriefFromText({ project, sourceText });
    const briefDoc = (project.documents || []).find(d => d.type === 'brief');
    let document;
    if (briefDoc) document = await projects.updateDocument(req.session.userId, project.id, briefDoc.id, { content });
    else document = await projects.createDocument(req.session.userId, project.id, { type: 'brief', name: 'Requirements brief', content, included_in_context: true });
    await projects.updateProject(req.session.userId, project.id, { brief: content });
    res.json({ document, model });
  } catch (err) {
    console.error('[refine-brief] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Quick Spec (Kiro-style: Requirements → Design → Tasks) ---------------

app.post('/api/projects/:id/quick-spec', requireAuth, designRateLimit, async (req, res) => {
  const project = await projects.getProject(req.session.userId, req.params.id);
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
    const document = await projects.createDocument(req.session.userId, project.id, {
      type: 'plan', name: safeName, content, included_in_context: false,
    });
    res.json({ document, model });
  } catch (err) {
    console.error('[quick-spec] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Draft brief from chat history ----------------------------------------

app.post('/api/projects/:id/draft-brief', requireAuth, designRateLimit, async (req, res) => {
  const project = await projects.getProject(req.session.userId, req.params.id);
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
      document = await projects.updateDocument(req.session.userId, project.id, briefDoc.id, { content });
    } else {
      document = await projects.createDocument(req.session.userId, project.id, {
        type: 'brief', name: 'Requirements brief', content, included_in_context: true,
      });
    }
    // Mirror back into project.brief for legacy paths.
    await projects.updateProject(req.session.userId, project.id, { brief: content });
    res.json({ document, model });
  } catch (err) {
    console.error('[draft-brief] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Chat (rate-limited, with attachments + document context injection) ----

app.post('/api/projects/:id/chat', requireAuth, uploadRateLimit, async (req, res) => {
  const project = await projects.getProject(req.session.userId, req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const { message, attachments } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required' });

  // Validate attachments shape and size on the server even though the client
  // also caps them. attachments: [{ name, bytes, content }] where `content` is
  // text extracted client-side from the source document (PDF/DOCX/PPTX/text).
  // `bytes` is the original file size; we cap the *extracted text* separately.
  const safeAttachments = [];
  if (Array.isArray(attachments)) {
    if (attachments.length > 5) return res.status(400).json({ error: 'too many attachments (max 5 per message)' });
    let totalChars = 0;
    for (const a of attachments) {
      const name = String(a?.name || 'file').slice(0, 200);
      const content = String(a?.content || '');
      const textBytes = Buffer.byteLength(content, 'utf8');
      const origBytes = Number.isFinite(a?.bytes) ? Number(a.bytes) : textBytes;
      if (origBytes > 50 * 1024 * 1024) return res.status(413).json({ error: `attachment "${name}" exceeds 50 MB` });
      if (textBytes > 4 * 1024 * 1024) return res.status(413).json({ error: `extracted text from "${name}" exceeds 4 MB` });
      totalChars += textBytes;
      if (totalChars > 10 * 1024 * 1024) return res.status(413).json({ error: 'extracted attachment text exceeds 10 MB total' });
      safeAttachments.push({ name, bytes: origBytes, content });
    }
  }

  const userEntry = await projects.appendChat(req.session.userId, project.id, {
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
    const assistantEntry = await projects.appendChat(req.session.userId, project.id, { role: 'assistant', content, model });
    res.json({ user: userEntry, assistant: assistantEntry });
  } catch (err) {
    console.error('[chat] error:', err);
    const assistantEntry = await projects.appendChat(req.session.userId, project.id, {
      role: 'assistant',
      content: `⚠️ I couldn't reach the LLM: ${err.message}`,
      error: true,
    });
    res.status(500).json({ user: userEntry, assistant: assistantEntry, error: err.message });
  }
});

// ---- Generate full plan (one-shot, deterministic guardrail) -----------------

app.post('/api/projects/:id/design', requireAuth, designRateLimit, async (req, res) => {
  const project = await projects.getProject(req.session.userId, req.params.id);
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
    await projects.updateProject(req.session.userId, project.id, { brief, last_plan: result });
    // Persist the FULL plan markdown as an assistant turn so it shows in chat
    // by default and survives the client's polling refresh. Tagged so the
    // "View plan in chat" button can locate + scroll to it.
    await projects.appendChat(req.session.userId, project.id, {
      role: 'assistant',
      content: result.markdown,
      meta: { kind: 'plan-document', total: result.priced.total, components: result.priced.items.length, region: result.region.code },
    });
    res.json({ result });
  } catch (err) {
    console.error('[design] error:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// Re-post the current plan into chat (used by the Studio "View plan in chat"
// button). Persists the full plan markdown as a fresh assistant turn so it
// survives polling and the client can scroll to it. Returns the appended entry.
app.post('/api/projects/:id/plan-to-chat', requireAuth, async (req, res) => {
  try {
    const project = await projects.getProject(req.session.userId, req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });
    const markdown = project.last_plan?.markdown;
    if (!markdown) return res.status(400).json({ error: 'no plan generated yet' });
    const entry = await projects.appendChat(req.session.userId, project.id, {
      role: 'assistant',
      content: markdown,
      meta: { kind: 'plan-document', total: project.last_plan?.priced?.total, region: project.last_plan?.region?.code },
    });
    res.json({ entry });
  } catch (err) {
    console.error('[plan-to-chat] error:', err);
    res.status(500).json({ error: err.message });
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

// Only bind a port when run as the main module (e.g. `npm start` locally).
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  db.init()
    .then(() => {
      const server = app.listen(PORT, () => {
        console.log(`☁️  Cloud Infrastructure Architect running at http://localhost:${PORT}`);
        console.log(`    Serving static from: ${staticDir}`);
        console.log(`    GitHub OAuth mode: ${require('./lib/github-config').MODE}`);
      });
      // Plan generation can legitimately take 10+ minutes on shared LLM infra.
      // Node's defaults (requestTimeout 300s, headersTimeout 60s, keep-alive
      // 5s) would sever such a request mid-flight. Raise them generously so a
      // slow-but-progressing design isn't killed at the HTTP layer. 0 disables
      // the request timeout entirely; the LLM client's own inactivity timeout
      // is what guards against a truly stuck upstream.
      server.requestTimeout = 0;             // no hard cap on total request time
      server.headersTimeout = 20 * 60_000;   // 20 min to receive headers
      server.keepAliveTimeout = 20 * 60_000; // keep idle sockets alive
      server.timeout = 0;                    // no socket inactivity timeout
    })
    .catch((err) => {
      console.error('[startup] failed to initialise database:', err.message);
      process.exit(1);
    });
}

module.exports = app;
