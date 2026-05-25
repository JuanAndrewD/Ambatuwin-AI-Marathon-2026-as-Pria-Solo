// Kiro-style Quick Spec dialog. Takes a single prompt + the project's current
// resources/docs context, returns a markdown spec with three sections
// (Requirements, Design, Tasks) saved as a new document.
import React, { useEffect, useRef, useState } from 'react';
import { Zap, X, Sparkles, Loader2 } from 'lucide-react';

const SUGGESTIONS = [
  'A serverless image-processing pipeline with S3 triggers and Lambda',
  'A multi-tenant SaaS API on EKS with PostgreSQL and Redis',
  'A real-time analytics dashboard for 100k events/sec',
  'A static marketing site behind CloudFront with WAF and Route 53',
];

export default function QuickSpecModal({ onCancel, onSubmit, busy, project, documents = [] }) {
  const [value, setValue] = useState('');
  const taRef = useRef(null);
  useEffect(() => { taRef.current?.focus(); }, []);

  function submit(e) {
    e?.preventDefault?.();
    if (!value.trim() || busy) return;
    onSubmit(value.trim());
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal qs-modal" onClick={e => e.stopPropagation()}>
        <button className="qs-close" onClick={onCancel} title="Close" disabled={busy}>
          <X size={14} />
        </button>
        <div className="qs-header">
          <span className="qs-icon"><Zap size={18} /></span>
          <div>
            <h3>Quick Spec</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Generate a Kiro-style spec — Requirements, Design, Tasks — in one shot. Saved as a new document.
            </p>
          </div>
        </div>

        <form onSubmit={submit}>
          <textarea
            ref={taRef}
            className="textarea"
            rows={6}
            placeholder="Describe what you want to spec out. e.g. 'A real-time order tracking service for 50k merchants with cross-region failover, must sustain 5k req/sec at p99 < 200ms, GDPR + PDPA-MY.'"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit(); }}
            disabled={busy}
          />

          <div className="qs-context">
            <div className="qs-ctx-row">
              <span className="qs-ctx-label">Region</span>
              <span className="kbd">{project?.region}</span>
            </div>
            <div className="qs-ctx-row">
              <span className="qs-ctx-label">Allowed services</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                {(project?.enabled_services || []).length} enabled · constrained vocabulary
              </span>
            </div>
            <div className="qs-ctx-row">
              <span className="qs-ctx-label">In-context docs</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                {documents.filter(d => d.included_in_context).length} of {documents.length} · referenced via #docname
              </span>
            </div>
          </div>

          <div className="qs-suggest">
            {SUGGESTIONS.map(s => (
              <button key={s} type="button" className="qs-suggest-chip" onClick={() => setValue(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>

          <div className="actions">
            <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="btn primary" disabled={!value.trim() || busy}>
              {busy ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
              {busy ? 'Generating spec…' : 'Generate spec'}
            </button>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 10, fontFamily: 'var(--font-mono)' }}>
            <span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> to submit
          </div>
        </form>
      </div>
    </div>
  );
}
