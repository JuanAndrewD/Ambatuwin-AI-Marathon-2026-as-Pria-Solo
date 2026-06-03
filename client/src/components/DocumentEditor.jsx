import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Save, FileText, Eye, Columns, MessageSquarePlus, Pin, Download, Check, Loader2, Sparkles, Lock } from 'lucide-react';
import CodeEditor from './CodeEditor';
import { renderMarkdown, postProcessMermaid } from '../lib/markdown';
import { api } from '../lib/api';

const VIEWS = [
  { id: 'edit',    label: 'Edit',    Icon: FileText },
  { id: 'split',   label: 'Split',   Icon: Columns },
  { id: 'preview', label: 'Preview', Icon: Eye },
];

export default function DocumentEditor({
  document, projectId, onChange, onSave, onClose, onToggleContext, onInsertIntoChat, onAIRefine, aiBusy, savingState,
}) {
  const isBinary = !!document.binary;
  const [view, setView] = useState(isBinary ? 'preview' : (document.type === 'brief' ? 'split' : 'edit'));
  const previewRef = useRef(null);
  const html = useMemo(() => renderMarkdown(document.content || ''), [document.content]);

  useEffect(() => {
    if (previewRef.current) postProcessMermaid(previewRef.current);
  }, [html, view]);

  const rawUrl = (projectId && isBinary) ? api.documentRawUrl(projectId, document.id) : null;
  const isPdf = isBinary && /\.pdf$/i.test(document.name || '');

  function downloadMd() {
    // Binary docs download their stored original; text docs download content.
    if (isBinary && projectId) {
      window.open(api.documentRawUrl(projectId, document.id, true), '_blank');
      return;
    }
    const blob = new Blob([document.content || ''], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    const safe = (document.name || 'document.md').replace(/[^a-zA-Z0-9._-]/g, '-');
    a.href = url;
    a.download = safe;
    window.document.body.appendChild(a); a.click(); window.document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const wordCount = (document.content || '').trim().split(/\s+/).filter(Boolean).length;
  const charCount = (document.content || '').length;
  const lineCount = (document.content || '').split('\n').length;

  return (
    <main className="doc-editor-pane">
      <div className="doc-editor-toolbar">
        <button className="btn tiny ghost" onClick={onClose} title="Back to chat">
          <ArrowLeft size={12} /> Back to chat
        </button>
        <div className="doc-title">
          {document.pinned && <Pin size={12} style={{ color: 'var(--accent)' }} />}
          <input
            className="doc-title-input"
            value={document.name}
            onChange={(e) => onChange({ name: e.target.value })}
            disabled={document.type === 'brief'}
            title={document.type === 'brief' ? 'The brief is pinned and cannot be renamed' : 'Rename'}
          />
          <span className="doc-meta-pill">{document.type}</span>
          {isBinary && <span className="doc-meta-pill readonly-pill"><Lock size={10} /> Preview only</span>}
        </div>
        <div className="doc-toolbar-right">
          {!isBinary && <SaveBadge state={savingState} />}
          {!isBinary && (
            <div className="view-toggle">
              {VIEWS.map(v => (
                <button
                  key={v.id}
                  className={view === v.id ? 'active' : ''}
                  onClick={() => setView(v.id)}
                  title={v.label}
                >
                  <v.Icon size={12} /> {v.label}
                </button>
              ))}
            </div>
          )}
          {!isBinary && (
            <button className="btn tiny" onClick={onSave} title="Save (Ctrl+S)">
              <Save size={11} /> Save
            </button>
          )}
          <button className="btn tiny" onClick={downloadMd} title={isBinary ? 'Download original file' : 'Download as .md'}>
            <Download size={11} />
          </button>
          <button
            className="btn tiny"
            onClick={() => onToggleContext(!document.included_in_context)}
            title={document.included_in_context ? 'Exclude from chat context' : 'Include in chat context'}
          >
            <Eye size={11} /> {document.included_in_context ? 'In context' : 'Excluded'}
          </button>
          <button className="btn tiny ghost" onClick={onInsertIntoChat} title="Send the contents of this document as a chat message">
            <MessageSquarePlus size={11} /> Send to chat
          </button>
          {onAIRefine && (
            <button className="btn tiny" onClick={onAIRefine} disabled={aiBusy} title="Use the LLM to refine your editor draft into a structured Requirements Brief">
              {aiBusy ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} />}
              {aiBusy ? 'Refining…' : 'AI refine'}
            </button>
          )}
        </div>
      </div>

      {isBinary ? (
        <div className="doc-editor-body view-binary">
          {isPdf && rawUrl ? (
            <iframe className="doc-pdf-frame" src={rawUrl} title={document.name} />
          ) : (
            <div className="doc-binary-preview">
              <div className="doc-binary-note">
                <Lock size={12} /> Extracted text preview — the original file is preserved and editing is disabled.
              </div>
              <pre className="doc-extracted-text">{document.content || '(no extractable text)'}</pre>
            </div>
          )}
        </div>
      ) : (
        <div className={`doc-editor-body view-${view}`}>
          {view !== 'preview' && (
            <CodeEditor
              value={document.content || ''}
              onChange={(content) => onChange({ content })}
              onSave={onSave}
              language={fileLanguage(document.name)}
              placeholder={
                document.type === 'brief'
                  ? '# Requirements Brief\n\nDescribe the workload, expected scale, regions, compliance needs, and budget. Toggle "in context" so the architect can read it during chat.'
                  : 'Start writing markdown here…'
              }
            />
          )}
          {view !== 'edit' && (
            <div className="md-preview" ref={previewRef} dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      )}

      <div className="doc-editor-foot">
        {isBinary ? (
          <span>{(document.content || '').split('\n').length.toLocaleString()} lines extracted · original preserved for download &amp; GitHub sync</span>
        ) : (
          <span>{lineCount.toLocaleString()} lines · {wordCount.toLocaleString()} words · {charCount.toLocaleString()} chars</span>
        )}
        <span className="muted" style={{ marginLeft: 'auto' }}>
          {isBinary
            ? <>Unstructured file · preview only</>
            : <><span className="kbd">Ctrl</span>+<span className="kbd">S</span> to save · <span className="kbd">Tab</span> indent · <span className="kbd">Shift</span>+<span className="kbd">Tab</span> outdent</>}
        </span>
      </div>
    </main>
  );
}

function SaveBadge({ state }) {
  if (state === 'saving') return <span className="save-badge saving"><Loader2 size={11} className="spin" /> Saving…</span>;
  if (state === 'saved')  return <span className="save-badge saved"><Check size={11} /> Saved</span>;
  if (state === 'dirty')  return <span className="save-badge dirty">Unsaved changes</span>;
  if (state === 'error')  return <span className="save-badge err">Save failed</span>;
  return null;
}

function fileLanguage(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.tf') || lower.endsWith('.hcl')) return 'hcl';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.json')) return 'json';
  return 'markdown';
}
