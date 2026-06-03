// PostgreSQL-backed project storage, scoped per user.
//
// This module replaces the old `data/projects.json` file store. Each project
// row carries a `user_id` foreign key, so every read/write is scoped to the
// signed-in user — one account never sees another's work. Documents, chat
// history and the last generated plan live in JSONB columns, preserving the
// exact shape the rest of the app already expects.
//
// All functions are async (they hit the database). Ownership is enforced by
// passing `userId` and filtering on it in SQL, so a forged project id from
// another account simply returns null / false.

const crypto = require('crypto');
const db = require('./db');

function newId() {
  return 'p_' + crypto.randomBytes(6).toString('hex');
}

function nowISO() { return new Date().toISOString(); }

// ---- Row <-> domain object ------------------------------------------------

function rowToProject(r) {
  if (!r) return null;
  const p = {
    id: r.id,
    user_id: Number(r.user_id),
    name: r.name,
    region: r.region,
    brief: r.brief || '',
    enabled_services: r.enabled_services || [],
    chat: r.chat || [],
    documents: r.documents || [],
    last_plan: r.last_plan || null,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
  };
  return ensureDocumentsArray(p);
}

// Persist the mutable parts of a project back to its row.
async function persist(p) {
  await db.query(
    `UPDATE projects SET
       name = $2, region = $3, brief = $4,
       enabled_services = $5::jsonb, chat = $6::jsonb,
       documents = $7::jsonb, last_plan = $8::jsonb,
       updated_at = now()
     WHERE id = $1`,
    [
      p.id, p.name, p.region, p.brief || '',
      JSON.stringify(p.enabled_services || []),
      JSON.stringify(p.chat || []),
      JSON.stringify(p.documents || []),
      p.last_plan ? JSON.stringify(p.last_plan) : null,
    ]
  );
  p.updated_at = nowISO();
  return p;
}

// Load a project owned by `userId`. Returns null if it doesn't exist or the
// user doesn't own it.
async function loadOwned(userId, id) {
  const { rows } = await db.query(
    'SELECT * FROM projects WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rowToProject(rows[0]);
}

// ---- Documents helpers (unchanged shape) ----------------------------------

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

// ---- Projects --------------------------------------------------------------

async function listProjects(userId) {
  const { rows } = await db.query(
    'SELECT * FROM projects WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return rows.map(rowToProject).map(p => ({
    id: p.id,
    name: p.name,
    region: p.region,
    created_at: p.created_at,
    updated_at: p.updated_at,
    has_plan: !!p.last_plan,
    chat_count: (p.chat || []).length,
    enabled_count: (p.enabled_services || []).length,
    doc_count: (p.documents || []).length,
  }));
}

async function getProject(userId, id) {
  return loadOwned(userId, id);
}

async function createProject(userId, { name, region = 'ap-southeast-5', brief = '', enabled_services }) {
  const briefDoc = newDocument({
    type: 'brief',
    name: 'Requirements brief',
    content: brief || '',
    included_in_context: true,
    pinned: true,
  });
  const { ALL_SERVICES } = require('./architect');
  const id = newId();
  const services = Array.isArray(enabled_services) && enabled_services.length
    ? enabled_services
    : [...ALL_SERVICES];

  const { rows } = await db.query(
    `INSERT INTO projects (id, user_id, name, region, brief, enabled_services, chat, documents, last_plan)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, '[]'::jsonb, $7::jsonb, NULL)
     RETURNING *`,
    [
      id, userId, name || 'Untitled architecture', region, brief || '',
      JSON.stringify(services), JSON.stringify([briefDoc]),
    ]
  );
  return rowToProject(rows[0]);
}

async function updateProject(userId, id, patch) {
  const p = await loadOwned(userId, id);
  if (!p) return null;
  const allowed = ['name', 'region', 'brief', 'enabled_services', 'last_plan'];
  for (const k of allowed) if (k in patch) p[k] = patch[k];
  if ('brief' in patch) {
    const brief = p.documents.find(d => d.type === 'brief');
    if (brief) { brief.content = patch.brief || ''; brief.updated_at = nowISO(); }
  }
  return persist(p);
}

async function appendChat(userId, id, message) {
  const p = await loadOwned(userId, id);
  if (!p) return null;
  if (!Array.isArray(p.chat)) p.chat = [];
  const entry = { ...message, ts: nowISO() };
  p.chat.push(entry);
  await persist(p);
  return entry;
}

async function clearChat(userId, id) {
  const p = await loadOwned(userId, id);
  if (!p) return null;
  p.chat = [];
  return persist(p);
}

async function deleteProject(userId, id) {
  const { rowCount } = await db.query(
    'DELETE FROM projects WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rowCount > 0;
}

// ---- Documents -------------------------------------------------------------

async function listDocuments(userId, projectId) {
  const p = await loadOwned(userId, projectId);
  if (!p) return null;
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

async function getDocument(userId, projectId, docId) {
  const p = await loadOwned(userId, projectId);
  if (!p) return null;
  return p.documents.find(d => d.id === docId) || null;
}

async function createDocument(userId, projectId, payload) {
  const p = await loadOwned(userId, projectId);
  if (!p) return null;
  const doc = newDocument({
    type: payload.type || 'note',
    name: payload.name || 'Untitled.md',
    content: payload.content || '',
    included_in_context: payload.included_in_context ?? false,
  });
  p.documents.push(doc);
  await persist(p);
  return doc;
}

async function updateDocument(userId, projectId, docId, patch) {
  const p = await loadOwned(userId, projectId);
  if (!p) return null;
  const doc = p.documents.find(d => d.id === docId);
  if (!doc) return null;
  const allowed = doc.type === 'brief'
    ? ['name', 'content', 'included_in_context']
    : ['name', 'content', 'included_in_context', 'type'];
  for (const k of allowed) if (k in patch) doc[k] = patch[k];
  doc.updated_at = nowISO();
  if (doc.type === 'brief' && 'content' in patch) {
    p.brief = doc.content || '';
  }
  await persist(p);
  return doc;
}

async function deleteDocument(userId, projectId, docId) {
  const p = await loadOwned(userId, projectId);
  if (!p) return false;
  const idx = p.documents.findIndex(d => d.id === docId);
  if (idx === -1) return false;
  if (p.documents[idx].type === 'brief') return false; // brief is undeletable
  p.documents.splice(idx, 1);
  await persist(p);
  return true;
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
