// File-based project storage. Each project tracks its own brief, region,
// enabled-services subset (the "Resources" panel), chat history, and the
// last generated plan. Persisted to data/projects.json so a server restart
// keeps the user's work.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECTS_PATH = path.join(__dirname, '..', 'data', 'projects.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf8'));
  } catch {
    return { projects: [] };
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(PROJECTS_PATH), { recursive: true });
  fs.writeFileSync(PROJECTS_PATH, JSON.stringify(state, null, 2));
}

function newId() {
  return 'p_' + crypto.randomBytes(6).toString('hex');
}

function nowISO() { return new Date().toISOString(); }

function listProjects() {
  const state = load();
  // shallow list (no chat history) for the sidebar
  return state.projects.map(p => {
    ensureDocumentsArray(p);
    return {
      id: p.id,
      name: p.name,
      region: p.region,
      created_at: p.created_at,
      updated_at: p.updated_at,
      has_plan: !!p.last_plan,
      chat_count: (p.chat || []).length,
      enabled_count: (p.enabled_services || []).length,
      doc_count: (p.documents || []).length,
    };
  });
}

function getProject(id) {
  const state = load();
  const p = state.projects.find(p => p.id === id);
  if (!p) return null;
  return ensureDocumentsArray(p);
}

function createProject({ name, region = 'ap-southeast-5', brief = '', enabled_services }) {
  const state = load();
  const briefDoc = newDocument({
    type: 'brief',
    name: 'Requirements brief',
    content: brief || '',
    included_in_context: true,
    pinned: true,
  });
  // New projects default to *every* service in the catalog enabled.
  // The user can deselect any they don't want from the Resources panel.
  // We pull from the architect's ALL_SERVICES list so this stays in sync
  // when the catalog grows.
  const { ALL_SERVICES } = require('./architect');
  const project = {
    id: newId(),
    name: name || 'Untitled architecture',
    region,
    brief, // kept in sync with the brief document for backwards-compat
    enabled_services: Array.isArray(enabled_services) && enabled_services.length
      ? enabled_services
      : [...ALL_SERVICES],
    chat: [],
    documents: [briefDoc],
    last_plan: null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  state.projects.unshift(project);
  save(state);
  return project;
}

function newDocument({ type = 'note', name = 'Untitled.md', content = '', included_in_context = false, pinned = false } = {}) {
  return {
    id: 'd_' + crypto.randomBytes(5).toString('hex'),
    type,
    name,
    content,
    included_in_context,
    pinned,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
}

function ensureDocumentsArray(project) {
  if (!Array.isArray(project.documents)) project.documents = [];
  // Backfill: if the project predates documents, materialise the brief.
  if (!project.documents.find(d => d.type === 'brief')) {
    project.documents.unshift(newDocument({
      type: 'brief',
      name: 'Requirements brief',
      content: project.brief || '',
      included_in_context: true,
      pinned: true,
    }));
  }
  return project;
}

function listDocuments(projectId) {
  const p = getProject(projectId);
  if (!p) return null;
  ensureDocumentsArray(p);
  // shallow list (sizes only) for the sidebar
  return p.documents.map(d => ({
    id: d.id,
    type: d.type,
    name: d.name,
    bytes: Buffer.byteLength(d.content || '', 'utf8'),
    included_in_context: !!d.included_in_context,
    pinned: !!d.pinned,
    created_at: d.created_at,
    updated_at: d.updated_at,
  }));
}

function getDocument(projectId, docId) {
  const p = getProject(projectId);
  if (!p) return null;
  ensureDocumentsArray(p);
  return p.documents.find(d => d.id === docId) || null;
}

function createDocument(projectId, payload) {
  const state = load();
  const idx = state.projects.findIndex(p => p.id === projectId);
  if (idx === -1) return null;
  ensureDocumentsArray(state.projects[idx]);
  const doc = newDocument({
    type: payload.type || 'note',
    name: payload.name || 'Untitled.md',
    content: payload.content || '',
    included_in_context: payload.included_in_context ?? false,
  });
  state.projects[idx].documents.push(doc);
  state.projects[idx].updated_at = nowISO();
  save(state);
  return doc;
}

function updateDocument(projectId, docId, patch) {
  const state = load();
  const idx = state.projects.findIndex(p => p.id === projectId);
  if (idx === -1) return null;
  ensureDocumentsArray(state.projects[idx]);
  const dIdx = state.projects[idx].documents.findIndex(d => d.id === docId);
  if (dIdx === -1) return null;
  const doc = state.projects[idx].documents[dIdx];
  // Brief doc always stays as type 'brief' and pinned.
  const allowed = doc.type === 'brief'
    ? ['name', 'content', 'included_in_context']
    : ['name', 'content', 'included_in_context', 'type'];
  for (const k of allowed) if (k in patch) doc[k] = patch[k];
  doc.updated_at = nowISO();
  // Keep project.brief mirror in sync.
  if (doc.type === 'brief' && 'content' in patch) {
    state.projects[idx].brief = doc.content || '';
  }
  state.projects[idx].updated_at = nowISO();
  save(state);
  return doc;
}

function deleteDocument(projectId, docId) {
  const state = load();
  const idx = state.projects.findIndex(p => p.id === projectId);
  if (idx === -1) return false;
  ensureDocumentsArray(state.projects[idx]);
  const dIdx = state.projects[idx].documents.findIndex(d => d.id === docId);
  if (dIdx === -1) return false;
  if (state.projects[idx].documents[dIdx].type === 'brief') return false; // brief is undeletable
  state.projects[idx].documents.splice(dIdx, 1);
  state.projects[idx].updated_at = nowISO();
  save(state);
  return true;
}

function updateProject(id, patch) {
  const state = load();
  const idx = state.projects.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const allowed = ['name','region','brief','enabled_services','last_plan'];
  for (const k of allowed) if (k in patch) state.projects[idx][k] = patch[k];
  // Keep brief document in sync when the legacy brief field is updated.
  if ('brief' in patch) {
    ensureDocumentsArray(state.projects[idx]);
    const brief = state.projects[idx].documents.find(d => d.type === 'brief');
    if (brief) {
      brief.content = patch.brief || '';
      brief.updated_at = nowISO();
    }
  }
  state.projects[idx].updated_at = nowISO();
  save(state);
  return state.projects[idx];
}

function appendChat(id, message) {
  const state = load();
  const idx = state.projects.findIndex(p => p.id === id);
  if (idx === -1) return null;
  if (!Array.isArray(state.projects[idx].chat)) state.projects[idx].chat = [];
  const entry = { ...message, ts: nowISO() };
  state.projects[idx].chat.push(entry);
  state.projects[idx].updated_at = nowISO();
  save(state);
  return entry;
}

function clearChat(id) {
  const state = load();
  const idx = state.projects.findIndex(p => p.id === id);
  if (idx === -1) return null;
  state.projects[idx].chat = [];
  state.projects[idx].updated_at = nowISO();
  save(state);
  return state.projects[idx];
}

function deleteProject(id) {
  const state = load();
  const before = state.projects.length;
  state.projects = state.projects.filter(p => p.id !== id);
  save(state);
  return before !== state.projects.length;
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  appendChat,
  clearChat,
  deleteProject,
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
};
