// Thin fetch wrapper for the Express API.
// Vite dev server proxies /api → http://localhost:3000 (see vite.config.js).
//
// `credentials: 'include'` is required so the cia.sid session cookie travels
// with every request (and through the Vite proxy in dev).

async function request(method, url, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    let err;
    try { err = (await res.json()).error; } catch { err = res.statusText; }
    const e = new Error(err || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  // 204 / empty body guard.
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// Send a raw binary body (File/Blob) — used for original-file uploads. We let
// the browser set Content-Type from the Blob so the server records the MIME.
async function requestRaw(method, url, blob) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    credentials: 'include',
    body: blob,
  });
  if (!res.ok) {
    let err;
    try { err = (await res.json()).error; } catch { err = res.statusText; }
    const e = new Error(err || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export const api = {
  catalog: () => request('GET', '/api/catalog'),
  regions: () => request('GET', '/api/regions'),

  // ---- Auth ----
  me: () => request('GET', '/api/auth/me'),
  logout: () => request('POST', '/api/auth/logout'),
  loginUrl: (returnTo = '#/app') => `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`,

  // ---- GitHub repo (repo is attached to a project) ----
  listRepos: () => request('GET', '/api/github/repos'),
  connectProjectRepo: (pid, payload) => request('POST', `/api/projects/${pid}/github/connect`, payload),
  disconnectProjectRepo: (pid) => request('DELETE', `/api/projects/${pid}/github/repo`),
  syncProjectToGitHub: (pid, opts = {}) => request('POST', `/api/projects/${pid}/github/sync`, opts),

  listProjects: () => request('GET', '/api/projects'),
  getProject:   (id) => request('GET', `/api/projects/${id}`),
  createProject: (payload) => request('POST', '/api/projects', payload),
  updateProject: (id, patch) => request('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id) => request('DELETE', `/api/projects/${id}`),
  clearChat: (id) => request('POST', `/api/projects/${id}/clear-chat`),

  chat: (id, message, attachments) => request('POST', `/api/projects/${id}/chat`, { message, attachments }),
  designForProject: (id, opts = {}) => request('POST', `/api/projects/${id}/design`, opts),
  planToChat: (id) => request('POST', `/api/projects/${id}/plan-to-chat`),

  listDocuments:    (pid) => request('GET',    `/api/projects/${pid}/documents`),
  getDocument:      (pid, did) => request('GET',    `/api/projects/${pid}/documents/${did}`),
  createDocument:   (pid, payload) => request('POST',   `/api/projects/${pid}/documents`, payload),
  updateDocument:   (pid, did, patch) => request('PATCH',  `/api/projects/${pid}/documents/${did}`, patch),
  deleteDocument:   (pid, did) => request('DELETE', `/api/projects/${pid}/documents/${did}`),
  // Upload the original bytes of an unstructured/binary document. `file` is a
  // browser File/Blob; sent raw so large files don't bloat a JSON body.
  uploadDocumentRaw: (pid, did, file) => requestRaw('PUT', `/api/projects/${pid}/documents/${did}/raw`, file),
  // URL to preview/download the stored original (e.g. for an <iframe> or link).
  documentRawUrl:   (pid, did, download = false) => `/api/projects/${pid}/documents/${did}/raw${download ? '?download=1' : ''}`,

  draftBrief:       (pid) => request('POST', `/api/projects/${pid}/draft-brief`),
  refineBrief:      (pid, source) => request('POST', `/api/projects/${pid}/refine-brief`, { source }),
  quickSpec:        (pid, prompt) => request('POST', `/api/projects/${pid}/quick-spec`, { prompt }),
  // Convenience: keep the project's brief field + the brief document content
  // in sync. Used when seeding a placeholder brief before the very first plan.
  updateDocumentBriefMirror: (pid, content) => request('PATCH', `/api/projects/${pid}`, { brief: content }),
};
