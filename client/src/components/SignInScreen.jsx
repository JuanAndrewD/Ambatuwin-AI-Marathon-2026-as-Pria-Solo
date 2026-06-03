import React from 'react';
import { Cloud, Github, ShieldCheck, FolderGit2, AlertTriangle } from 'lucide-react';

// Full-screen gate shown in the Workspace when no user session exists.
// Kicks off the GitHub OAuth flow. If the server reports OAuth isn't
// configured, we explain what to set instead of dangling a dead button.
export default function SignInScreen({ onLogin, configured, mode, error }) {
  return (
    <div className="signin-screen">
      <div className="signin-card">
        <div className="signin-mark"><Cloud size={22} color="#fff" /></div>
        <h1>Cloud Infrastructure Architect</h1>
        <p className="muted">
          Sign in with GitHub to keep your projects, documents, and chat history
          in your own private account — and push deliverables straight to a repo.
        </p>

        <ul className="signin-points">
          <li><ShieldCheck size={15} /> Your own isolated session and projects</li>
          <li><FolderGit2 size={15} /> Connect or create a GitHub repo</li>
          <li><Github size={15} /> Sync markdown deliverables in one click</li>
        </ul>

        {configured ? (
          <button className="btn primary signin-btn" onClick={onLogin}>
            <Github size={16} /> Continue with GitHub
          </button>
        ) : (
          <div className="signin-warn">
            <AlertTriangle size={15} />
            <div>
              GitHub OAuth isn't configured on this server. Set
              <code> GITHUB_CLIENT_ID</code> / <code>GITHUB_CLIENT_SECRET</code>
              {' '}(or the <code>_LOCAL</code> pair) in <code>.env</code> and restart.
            </div>
          </div>
        )}

        {error && <div className="signin-error">{error}</div>}

        <div className="signin-mode muted">
          OAuth mode: <strong>{mode}</strong>
        </div>
      </div>
    </div>
  );
}
