import React, { useState } from 'react';
import { FileText, FileCode2, FileSpreadsheet, FilePlus2, Trash2, Pin, Eye, EyeOff, Sparkles } from 'lucide-react';

const TYPE_ICON = {
  brief:    FileText,
  plan:     FileText,
  terraform: FileCode2,
  proposal: FileText,
  notes:    FileText,
  csv:      FileSpreadsheet,
  default:  FileText,
};

function ext(name) {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export default function DocumentsPane({
  documents, activeDocId,
  onOpen, onCreate, onDelete, onToggleContext,
  onDraftBrief, isDrafting,
}) {
  const [showNew, setShowNew] = useState(false);

  function newDocSubmit(name, type) {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), type, content: '' });
    setShowNew(false);
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button
          className="btn primary"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => setShowNew(true)}
        >
          <FilePlus2 size={13} /> New document
        </button>
      </div>

      <button
        className="btn tiny"
        style={{ width: '100%', justifyContent: 'center', marginBottom: 14 }}
        onClick={onDraftBrief}
        disabled={isDrafting}
        title="Synthesise a Requirements Brief from the chat history"
      >
        {isDrafting ? <span className="spin" style={{ display: 'inline-block', width: 10, height: 10, border: '2px solid var(--line)', borderTopColor: 'var(--accent)', borderRadius: '50%' }} /> : <Sparkles size={11} />}
        {isDrafting ? 'Drafting brief…' : 'Draft brief from chat'}
      </button>

      <div className="side-section">In context · {documents.filter(d => d.included_in_context).length} of {documents.length}</div>
      <div className="docs-list">
        {documents.map(d => {
          const Icon = TYPE_ICON[d.type] || TYPE_ICON.default;
          const sub = formatBytes(d.bytes) + ' · ' + (d.included_in_context ? 'in context' : 'excluded');
          const isActive = activeDocId === d.id;
          return (
            <div
              key={d.id}
              className={`doc-row ${isActive ? 'active' : ''} ${d.included_in_context ? '' : 'excluded'}`}
              onClick={() => onOpen(d.id)}
            >
              <Icon size={14} style={{ color: 'var(--text-dim)', flex: 'none' }} />
              <div className="meta">
                <div className="dname" title={d.name}>
                  {d.pinned && <Pin size={10} style={{ marginRight: 4, color: 'var(--accent)' }} />}
                  {d.name}
                </div>
                <div className="dsub">{sub}</div>
              </div>
              <button
                className="dctx"
                title={d.included_in_context ? 'Exclude from context' : 'Include in context'}
                onClick={(e) => { e.stopPropagation(); onToggleContext(d.id, !d.included_in_context); }}
              >
                {d.included_in_context ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              {!d.pinned && (
                <button
                  className="ddel"
                  title="Delete"
                  onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${d.name}"?`)) onDelete(d.id); }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>
        Documents marked "in context" are injected into every chat turn. The brief is pinned and cannot be deleted.
      </div>

      {showNew && (
        <NewDocumentModal onCancel={() => setShowNew(false)} onSubmit={newDocSubmit} />
      )}
    </>
  );
}

function NewDocumentModal({ onCancel, onSubmit }) {
  const [name, setName] = React.useState('Untitled.md');
  const [type, setType] = React.useState('notes');
  function submit(e) {
    e?.preventDefault?.();
    onSubmit(name, type);
  }
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>New document</h3>
        <p className="muted">Edit any markdown, json, yaml, or terraform fragment inline. Toggle context inclusion to share with the architect.</p>
        <form className="row" onSubmit={submit}>
          <div>
            <label className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>File name</label>
            <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</label>
            <select className="select" value={type} onChange={e => setType(e.target.value)}>
              <option value="notes">Notes</option>
              <option value="proposal">Proposal</option>
              <option value="terraform">Terraform</option>
              <option value="plan">Plan / spec</option>
            </select>
          </div>
          <div className="actions">
            <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn primary">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
