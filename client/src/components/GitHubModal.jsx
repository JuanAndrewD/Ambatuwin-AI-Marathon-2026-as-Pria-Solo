import React, { useEffect, useState } from 'react';
import { Github, FolderGit2, GitBranch, RefreshCw, Lock, Check, ExternalLink, Plus, UploadCloud } from 'lucide-react';
import { api } from '../lib/api';

// Connect / create a GitHub repository and sync the active project's markdown
// deliverables into it. The connected-repo mapping lives on the user's row, so
// it persists across sessions and projects.
export default function GitHubModal({ user, project, onClose, onUserChange }) {
  const [tab, setTab] = useState(user?.repo ? 'sync' : 'existing'); // existing | create | sync
  const [repos, setRepos] = useState(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // existing-repo form
  const [selected, setSelected] = useState('');
  const [branch, setBranch] = useState('');

  // create-repo form
  const [newName, setNewName] = useState('');
  const [newPrivate, setNewPrivate] = useState(true);
  const [newDesc, setNewDesc] = useState('');

  // sync form
  const [syncPath, setSyncPath] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [syncResult, setSyncResult] = useState(null);

  const repo = user?.repo || null;

  useEffect(() => {
    if (tab === 'existing' && repos === null) loadRepos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadRepos() {
    setLoadingRepos(true); setError(null);
    try {
      const { repos } = await api.listRepos();
      setRepos(repos);
    } catch (e) { setError(e.message); }
    finally { setLoadingRepos(false); }
  }

  async function connectExisting() {
    if (!selected) { setError('Pick a repository first.'); return; }
    const r = repos.find(x => x.full_name === selected);
    if (!r) return;
    setBusy(true); setError(null);
    try {
      const { user: updated } = await api.connectRepo({
        mode: 'existing', owner: r.owner, name: r.name, branch: branch || r.default_branch,
      });
      onUserChange?.(updated);
      setNotice(`Connected to ${updated.repo.full_name}`);
      setTab('sync');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function connectCreate() {
    if (!newName.trim()) { setError('Repository name is required.'); return; }
    setBusy(true); setError(null);
    try {
      const { user: updated } = await api.connectRepo({
        mode: 'create', name: newName.trim(), private: newPrivate, description: newDesc,
      });
      onUserChange?.(updated);
      setNotice(`Created and connected ${updated.repo.full_name}`);
      setTab('sync');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true); setError(null);
    try {
      const { user: updated } = await api.disconnectRepo();
      onUserChange?.(updated);
      setNotice('Repository disconnected.');
      setTab('existing');
      setSyncResult(null);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function runSync() {
    if (!project) { setError('Open a project first.'); return; }
    setBusy(true); setError(null); setSyncResult(null);
    try {
      const { result, files } = await api.syncProjectToGitHub(project.id, {
        path: syncPath || undefined,
        message: syncMessage || undefined,
        branch: branch || undefined,
      });
      setSyncResult({ ...result, files });
      setNotice(`Pushed ${result.committed} file(s) to ${repo.owner}/${repo.name}@${result.branch}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gh-modal" onClick={e => e.stopPropagation()}>
        <h3><Github size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} /> GitHub</h3>
        <p className="muted">
          Connect a repository to your account, then push this project's markdown
          deliverables straight from the app — no zip, no local git.
        </p>

        {repo && (
          <div className="gh-current">
            <FolderGit2 size={14} />
            <span>Connected: <strong>{repo.full_name}</strong></span>
            <span className="gh-branch"><GitBranch size={12} /> {repo.branch}</span>
            {repo.private && <span className="gh-priv"><Lock size={11} /> private</span>}
            <a className="gh-open" href={repo.html_url} target="_blank" rel="noreferrer" title="Open on GitHub">
              <ExternalLink size={13} />
            </a>
          </div>
        )}

        <div className="gh-tabs">
          <button className={`gh-tab ${tab === 'existing' ? 'active' : ''}`} onClick={() => setTab('existing')}>Existing repo</button>
          <button className={`gh-tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>Create repo</button>
          <button className={`gh-tab ${tab === 'sync' ? 'active' : ''}`} onClick={() => setTab('sync')} disabled={!repo}>Sync</button>
        </div>

        <div className="gh-body">
          {tab === 'existing' && (
            <div className="gh-section">
              <div className="gh-row-head">
                <label className="gh-label">Your repositories</label>
                <button className="btn tiny ghost" onClick={loadRepos} disabled={loadingRepos}>
                  <RefreshCw size={11} /> {loadingRepos ? 'Loading…' : 'Refresh'}
                </button>
              </div>
              {loadingRepos && <div className="muted" style={{ fontSize: 12 }}>Fetching repositories…</div>}
              {repos && repos.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No repositories found. Create one instead.</div>}
              {repos && repos.length > 0 && (
                <select className="select" value={selected} onChange={e => setSelected(e.target.value)}>
                  <option value="">— select a repository —</option>
                  {repos.map(r => (
                    <option key={r.full_name} value={r.full_name}>
                      {r.full_name}{r.private ? ' (private)' : ''} · {r.default_branch}
                    </option>
                  ))}
                </select>
              )}
              <label className="gh-label" style={{ marginTop: 10 }}>Branch (optional)</label>
              <input className="input" placeholder="defaults to the repo's default branch" value={branch} onChange={e => setBranch(e.target.value)} />
              <div className="gh-actions">
                <button className="btn primary" onClick={connectExisting} disabled={busy || !selected}>
                  <Check size={14} /> Connect
                </button>
              </div>
            </div>
          )}

          {tab === 'create' && (
            <div className="gh-section">
              <label className="gh-label">New repository name</label>
              <input className="input" placeholder="e.g. cloud-architecture-deliverables" value={newName} onChange={e => setNewName(e.target.value)} />
              <label className="gh-label" style={{ marginTop: 10 }}>Description (optional)</label>
              <input className="input" placeholder="Architecture deliverables" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
              <label className="gh-check" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={newPrivate} onChange={e => setNewPrivate(e.target.checked)} />
                <Lock size={12} /> Private repository
              </label>
              <div className="gh-actions">
                <button className="btn primary" onClick={connectCreate} disabled={busy || !newName.trim()}>
                  <Plus size={14} /> Create &amp; connect
                </button>
              </div>
            </div>
          )}

          {tab === 'sync' && (
            <div className="gh-section">
              {!repo ? (
                <div className="muted" style={{ fontSize: 12 }}>Connect a repository first.</div>
              ) : !project ? (
                <div className="muted" style={{ fontSize: 12 }}>Open a project to sync its documents.</div>
              ) : (
                <>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    Pushes every document in <strong>{project.name}</strong>
                    {project.last_plan ? ' plus the generated deployment plan' : ''} as
                    markdown files via the Git Trees API.
                  </div>
                  <label className="gh-label">Target folder in repo (optional)</label>
                  <input className="input" placeholder={defaultDir(project.name)} value={syncPath} onChange={e => setSyncPath(e.target.value)} />
                  <label className="gh-label" style={{ marginTop: 10 }}>Commit message (optional)</label>
                  <input className="input" placeholder={`Sync "${project.name}" from Cloud Infrastructure Architect`} value={syncMessage} onChange={e => setSyncMessage(e.target.value)} />
                  <label className="gh-label" style={{ marginTop: 10 }}>Branch (optional)</label>
                  <input className="input" placeholder={repo.branch} value={branch} onChange={e => setBranch(e.target.value)} />
                  <div className="gh-actions">
                    <button className="btn primary" onClick={runSync} disabled={busy}>
                      <UploadCloud size={14} /> {busy ? 'Pushing…' : 'Push to GitHub'}
                    </button>
                  </div>

                  {syncResult && (
                    <div className="gh-result">
                      <div className="gh-result-head">
                        <Check size={14} /> Pushed {syncResult.committed} file(s) ·
                        <a href={syncResult.html_url} target="_blank" rel="noreferrer"> view on GitHub <ExternalLink size={11} /></a>
                      </div>
                      <ul>
                        {syncResult.files.map(f => <li key={f}>{f}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {error && <div className="gh-error">{error}</div>}
        {notice && !error && <div className="gh-notice"><Check size={13} /> {notice}</div>}

        <div className="modal actions" style={{ marginTop: 16 }}>
          {repo && <button className="btn ghost" onClick={disconnect} disabled={busy}>Disconnect</button>}
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function defaultDir(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
}
