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
  return state.projects.map(p => ({
    id: p.id,
    name: p.name,
    region: p.region,
    created_at: p.created_at,
    updated_at: p.updated_at,
    has_plan: !!p.last_plan,
    chat_count: (p.chat || []).length,
    enabled_count: (p.enabled_services || []).length,
  }));
}

function getProject(id) {
  const state = load();
  return state.projects.find(p => p.id === id) || null;
}

function createProject({ name, region = 'ap-southeast-5', brief = '', enabled_services }) {
  const state = load();
  const project = {
    id: newId(),
    name: name || 'Untitled architecture',
    region,
    brief,
    enabled_services: enabled_services && enabled_services.length
      ? enabled_services
      : ['EC2','RDS','S3','ALB','CloudFront','Route53','KMS','WAF','NATGateway','Backup','DataTransferOut'],
    chat: [],
    last_plan: null,
    created_at: nowISO(),
    updated_at: nowISO(),
  };
  state.projects.unshift(project);
  save(state);
  return project;
}

function updateProject(id, patch) {
  const state = load();
  const idx = state.projects.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const allowed = ['name','region','brief','enabled_services','last_plan'];
  for (const k of allowed) if (k in patch) state.projects[idx][k] = patch[k];
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
};
