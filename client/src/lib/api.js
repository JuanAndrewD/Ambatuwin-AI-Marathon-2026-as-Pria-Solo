// Thin fetch wrapper for the Express API.
// Vite dev server proxies /api → http://localhost:3000 (see vite.config.js).

async function request(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    let err;
    try { err = (await res.json()).error; } catch { err = res.statusText; }
    throw new Error(err || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  catalog: () => request('GET', '/api/catalog'),
  regions: () => request('GET', '/api/regions'),

  listProjects: () => request('GET', '/api/projects'),
  getProject:   (id) => request('GET', `/api/projects/${id}`),
  createProject: (payload) => request('POST', '/api/projects', payload),
  updateProject: (id, patch) => request('PATCH', `/api/projects/${id}`, patch),
  deleteProject: (id) => request('DELETE', `/api/projects/${id}`),
  clearChat: (id) => request('POST', `/api/projects/${id}/clear-chat`),

  chat: (id, message, attachments) => request('POST', `/api/projects/${id}/chat`, { message, attachments }),
  designForProject: (id, opts = {}) => request('POST', `/api/projects/${id}/design`, opts),

  listDocuments:    (pid) => request('GET',    `/api/projects/${pid}/documents`),
  getDocument:      (pid, did) => request('GET',    `/api/projects/${pid}/documents/${did}`),
  createDocument:   (pid, payload) => request('POST',   `/api/projects/${pid}/documents`, payload),
  updateDocument:   (pid, did, patch) => request('PATCH',  `/api/projects/${pid}/documents/${did}`, patch),
  deleteDocument:   (pid, did) => request('DELETE', `/api/projects/${pid}/documents/${did}`),

  draftBrief:       (pid) => request('POST', `/api/projects/${pid}/draft-brief`),
  refineBrief:      (pid, source) => request('POST', `/api/projects/${pid}/refine-brief`, { source }),
  quickSpec:        (pid, prompt) => request('POST', `/api/projects/${pid}/quick-spec`, { prompt }),
  // Convenience: keep the project's brief field + the brief document content
  // in sync. Used when seeding a placeholder brief before the very first plan.
  updateDocumentBriefMirror: (pid, content) => request('PATCH', `/api/projects/${pid}`, { brief: content }),
};
