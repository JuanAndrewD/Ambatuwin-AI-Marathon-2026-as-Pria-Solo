// The Cloud Infrastructure Architect — web server.
// Serves the Vite-built React client from /client/dist (or the legacy /public
// fallback) and exposes the project + chat + design REST API.

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');

const { listRegions } = require('./lib/catalog');
const { design, chatTurn, ALL_SERVICES } = require('./lib/architect');
const projects = require('./lib/projects');
const { getCatalogPublic } = require('./lib/catalog-api');

const app = express();
app.use(express.json({ limit: '512kb' }));

// ---- Static: prefer the React build, fall back to the legacy public site ----
const clientDist = path.join(__dirname, 'client', 'dist');
const legacyPublic = path.join(__dirname, 'public');
const staticDir = fs.existsSync(path.join(clientDist, 'index.html')) ? clientDist : legacyPublic;
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

// ---- Chat (streamed-feel: single response, but persisted) ------------------

app.post('/api/projects/:id/chat', async (req, res) => {
  const project = projects.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'project not found' });
  const { message } = req.body || {};
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required' });

  const userEntry = projects.appendChat(project.id, { role: 'user', content: String(message) });

  try {
    const { content, model } = await chatTurn({
      project,
      history: project.chat || [],
      userMessage: String(message),
      catalogPublic: getCatalogPublic(),
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

app.post('/api/projects/:id/design', async (req, res) => {
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
