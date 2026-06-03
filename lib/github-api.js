// Thin GitHub REST + Git Data API client.
//
// Two responsibilities:
//   1. OAuth: exchange the ?code from the callback for an access token, and
//      read the authenticated user's profile.
//   2. Repo sync: push a set of in-memory markdown files into a target repo
//      WITHOUT zipping anything or shelling out to `git`. We use the low-level
//      Git Data ("Trees") API so the whole commit is built server-side in a
//      handful of HTTPS calls:
//
//        GET  /repos/:o/:r/git/ref/heads/:branch     → current commit sha
//        POST /repos/:o/:r/git/blobs        (xN)     → one blob per file
//        POST /repos/:o/:r/git/trees                 → assemble the tree
//        POST /repos/:o/:r/git/commits               → new commit
//        PATCH/POST .../git/refs/heads/:branch       → move the branch
//
// Node 18+ ships a global `fetch`, so there are no HTTP dependencies.

const gh = require('./github-config');

const API = 'https://api.github.com';
const UA = 'cloud-infrastructure-architect';

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': UA,
  };
}

async function ghJson(method, url, token, body) {
  const res = await fetch(url, {
    method,
    headers: { ...ghHeaders(token), 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message || res.statusText || `HTTP ${res.status}`;
    const err = new Error(`GitHub API ${method} ${url.replace(API, '')} failed: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ---- OAuth -----------------------------------------------------------------

// Build the authorize URL the browser is redirected to. `state` is a CSRF
// nonce we generate per request and verify on callback.
function authorizeUrl({ state, redirectUri, scope = 'read:user user:email repo' }) {
  const params = new URLSearchParams({
    client_id: gh.clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    allow_signup: 'true',
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

// Exchange the temporary ?code for a long-lived access token.
async function exchangeCodeForToken({ code, redirectUri }) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    body: JSON.stringify({
      client_id: gh.clientId,
      client_secret: gh.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const json = await res.json();
  if (json.error || !json.access_token) {
    throw new Error(`OAuth token exchange failed: ${json.error_description || json.error || 'no token'}`);
  }
  return json.access_token;
}

async function getAuthedUser(token) {
  const user = await ghJson('GET', `${API}/user`, token);
  // Email may be private; fetch the primary verified one if the profile hid it.
  if (!user.email) {
    try {
      const emails = await ghJson('GET', `${API}/user/emails`, token);
      const primary = emails.find(e => e.primary && e.verified) || emails[0];
      if (primary) user.email = primary.email;
    } catch { /* email scope may be absent; ignore */ }
  }
  return user;
}

// ---- Repositories ----------------------------------------------------------

async function listRepos(token, { perPage = 100 } = {}) {
  const repos = await ghJson(
    'GET',
    `${API}/user/repos?per_page=${perPage}&sort=updated&affiliation=owner,collaborator`,
    token
  );
  return repos.map(r => ({
    full_name: r.full_name,
    owner: r.owner.login,
    name: r.name,
    private: r.private,
    default_branch: r.default_branch,
    html_url: r.html_url,
    permissions: r.permissions || {},
  }));
}

async function getRepo(token, owner, name) {
  return ghJson('GET', `${API}/repos/${owner}/${name}`, token);
}

// Create a new repo under the authenticated user.
async function createRepo(token, { name, description = '', private: isPrivate = true, auto_init = true }) {
  return ghJson('POST', `${API}/user/repos`, token, {
    name, description, private: isPrivate, auto_init,
  });
}

// ---- Git Data API: push files without git or zips --------------------------

// files: [{ path, content }]  — content is a UTF-8 string.
// Returns { commit_sha, branch, html_url, committed }.
async function pushFiles(token, { owner, repo, branch, message, files }) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('no files to push');
  }

  // 1. Resolve the repo (to learn the default branch) and the target ref.
  const repoInfo = await getRepo(token, owner, repo);
  const targetBranch = branch || repoInfo.default_branch || 'main';

  // 2. Find the current tip of the branch. A freshly-created (auto_init) repo
  //    will have one commit; a brand-new empty repo will 404 here.
  let baseCommitSha = null;
  let baseTreeSha = null;
  let refExists = true;
  try {
    const ref = await ghJson('GET', `${API}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(targetBranch)}`, token);
    baseCommitSha = ref.object.sha;
    const baseCommit = await ghJson('GET', `${API}/repos/${owner}/${repo}/git/commits/${baseCommitSha}`, token);
    baseTreeSha = baseCommit.tree.sha;
  } catch (err) {
    if (err.status === 404 || err.status === 409) {
      refExists = false; // empty repo — we'll create the first commit + ref
    } else {
      throw err;
    }
  }

  // 3. Create a blob for each file.
  const blobs = [];
  for (const f of files) {
    const blob = await ghJson('POST', `${API}/repos/${owner}/${repo}/git/blobs`, token, {
      content: Buffer.from(f.content ?? '', 'utf8').toString('base64'),
      encoding: 'base64',
    });
    blobs.push({ path: f.path, sha: blob.sha });
  }

  // 4. Build a tree from the blobs (based on the existing tree when present).
  const treePayload = {
    tree: blobs.map(b => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
  };
  if (baseTreeSha) treePayload.base_tree = baseTreeSha;
  const tree = await ghJson('POST', `${API}/repos/${owner}/${repo}/git/trees`, token, treePayload);

  // 5. Create the commit pointing at the new tree.
  const commit = await ghJson('POST', `${API}/repos/${owner}/${repo}/git/commits`, token, {
    message: message || 'Sync from Cloud Infrastructure Architect',
    tree: tree.sha,
    parents: baseCommitSha ? [baseCommitSha] : [],
  });

  // 6. Move the branch ref to the new commit (or create it for an empty repo).
  if (refExists) {
    await ghJson('PATCH', `${API}/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(targetBranch)}`, token, {
      sha: commit.sha,
      force: false,
    });
  } else {
    await ghJson('POST', `${API}/repos/${owner}/${repo}/git/refs`, token, {
      ref: `refs/heads/${targetBranch}`,
      sha: commit.sha,
    });
  }

  return {
    commit_sha: commit.sha,
    branch: targetBranch,
    html_url: `${repoInfo.html_url}/tree/${targetBranch}`,
    committed: files.length,
  };
}

module.exports = {
  authorizeUrl,
  exchangeCodeForToken,
  getAuthedUser,
  listRepos,
  getRepo,
  createRepo,
  pushFiles,
};
