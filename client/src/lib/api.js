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

  chat: (id, message) => request('POST', `/api/projects/${id}/chat`, { message }),
  designForProject: (id, opts = {}) => request('POST', `/api/projects/${id}/design`, opts),
};
