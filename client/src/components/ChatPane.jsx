import React, { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Trash2, Paperclip, X, FileText, ChevronDown } from 'lucide-react';
import { renderMarkdown, postProcessMermaid } from '../lib/markdown';
import TypingDots from './TypingDots';
import Aurora from './Aurora';

const SUGGESTIONS = [
  'Design a Multi-AZ PostgreSQL stack for 50,000 users in Malaysia',
  'Quote a containerised API tier with auto-scaling on EKS',
  'Compare ap-southeast-5 vs ap-southeast-1 for a fintech',
  'What does PDPA-MY require for our database choice?',
  'Suggest an architecture under USD $4,000 / month',
];

// Allowed text-like extensions for attachments. We deliberately reject binaries.
const ALLOWED_EXT = ['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.log', '.tf', '.hcl', '.env.example', '.toml', '.ini'];
const MAX_FILE_BYTES = 200_000;        // 200 KB per file
const MAX_TOTAL_BYTES = 500_000;       // 500 KB combined
const MAX_FILES = 5;

function isAllowed(name) {
  const lower = name.toLowerCase();
  return ALLOWED_EXT.some(ext => lower.endsWith(ext));
}

export default function ChatPane({ project, regions, isThinking, onSend, onClearChat, onUpdateProject }) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]); // [{ name, bytes, content }]
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const streamRef = useRef(null);
  const composerRef = useRef(null);
  const fileInputRef = useRef(null);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const stickToBottomRef = useRef(true);

  function scrollToBottom(smooth = true) {
    const el = streamRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function onStreamScroll() {
    const el = streamRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 80;
    stickToBottomRef.current = atBottom;
    setShowScrollFab(!atBottom && el.scrollHeight > el.clientHeight + 200);
  }

  // Auto-scroll on new messages, but only if the user hasn't scrolled away.
  useEffect(() => {
    if (stickToBottomRef.current) scrollToBottom(true);
  }, [project?.chat?.length, isThinking]);

  useEffect(() => {
    if (streamRef.current) postProcessMermaid(streamRef.current);
  }, [project?.chat]);

  function clearAttachments() { setAttachments([]); setUploadError(null); }

  async function addFiles(fileList) {
    setUploadError(null);
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const errors = [];
    const accepted = [];
    let totalBytes = attachments.reduce((s, a) => s + a.bytes, 0);
    for (const f of incoming) {
      if (attachments.length + accepted.length >= MAX_FILES) { errors.push(`max ${MAX_FILES} files; "${f.name}" skipped`); continue; }
      if (!isAllowed(f.name)) { errors.push(`"${f.name}" — only text formats allowed (${ALLOWED_EXT.slice(0,6).join(', ')}…)`); continue; }
      if (f.size > MAX_FILE_BYTES) { errors.push(`"${f.name}" exceeds 200 KB`); continue; }
      if (totalBytes + f.size > MAX_TOTAL_BYTES) { errors.push(`"${f.name}" would exceed 500 KB total`); continue; }
      try {
        const text = await f.text();
        accepted.push({ name: f.name, bytes: f.size, content: text });
        totalBytes += f.size;
      } catch (err) {
        errors.push(`"${f.name}": ${err.message}`);
      }
    }
    if (accepted.length) setAttachments((a) => [...a, ...accepted]);
    if (errors.length) setUploadError(errors.join(' · '));
  }

  function removeAttachment(idx) {
    setAttachments(a => a.filter((_, i) => i !== idx));
  }

  function submit() {
    const value = input.trim();
    if (!value || isThinking || !project) return;
    setInput('');
    onSend(value, attachments);
    setAttachments([]);
    composerRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function autoresize(e) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(240, e.target.scrollHeight) + 'px';
  }

  function onDragOver(e) {
    if (!project) return;
    e.preventDefault(); e.stopPropagation();
    setDragOver(true);
  }
  function onDragLeave(e) { e.preventDefault(); setDragOver(false); }
  function onDrop(e) {
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    if (!project) return;
    addFiles(e.dataTransfer?.files);
  }

  const messages = project?.chat || [];
  const showWelcome = !project || messages.length === 0;

  return (
    <main
      className={`chat-pane ${dragOver ? 'dragover' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="chat-stream" ref={streamRef} id="chat-stream" onScroll={onStreamScroll}>
        {showWelcome ? (
          <Welcome
            project={project}
            regions={regions}
            onSuggest={(text) => { setInput(text); composerRef.current?.focus(); }}
            onUpdateProject={onUpdateProject}
          />
        ) : (
          <>
            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} error={m.error} attachments={m.attachments} />
            ))}
            {isThinking && (
              <div className="msg assistant fade-in">
                <div className="avatar"><Sparkles size={14} /></div>
                <div className="bubble">
                  <div className="name">Cloud Architect</div>
                  <TypingDots />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="composer-wrap">
        <div className="composer">
          {attachments.length > 0 && (
            <div className="attach-row">
              {attachments.map((a, i) => (
                <span key={i} className="attach-chip">
                  <FileText size={11} />
                  {a.name}
                  <span className="attach-size">{(a.bytes / 1024).toFixed(1)} KB</span>
                  <button onClick={() => removeAttachment(i)} title="Remove"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          {uploadError && (
            <div className="upload-err">{uploadError}</div>
          )}

          <textarea
            ref={composerRef}
            placeholder={project ? `Ask the architect about "${project.name}"…  (drag files in or attach below)` : 'Create a project to start chatting'}
            value={input}
            onChange={autoresize}
            onKeyDown={onKeyDown}
            disabled={!project || isThinking}
          />
          <div className="composer-actions">
            <div className="left-actions">
              <button
                className="btn tiny ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={!project || attachments.length >= MAX_FILES}
                title={`Attach files (max ${MAX_FILES}, 200 KB each, 500 KB total)`}
              >
                <Paperclip size={11} /> Attach
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ALLOWED_EXT.join(',')}
                style={{ display: 'none' }}
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
              />
              <span className="composer-hint">
                <span className="kbd">Enter</span> to send · <span className="kbd">Shift</span>+<span className="kbd">Enter</span> for new line
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {project && messages.length > 0 && (
                <button className="btn tiny ghost" onClick={onClearChat} title="Clear chat history">
                  <Trash2 size={11} /> Clear
                </button>
              )}
              <button className="send-btn" onClick={submit} disabled={!input.trim() || !project || isThinking}>
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <button
        className={`scroll-fab ${showScrollFab ? 'visible' : ''}`}
        onClick={() => { stickToBottomRef.current = true; scrollToBottom(true); }}
        title="Jump to latest"
        aria-label="Scroll to latest message"
      >
        <ChevronDown size={16} />
      </button>

      {dragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <Paperclip size={36} />
            <div>Drop your files to attach</div>
            <small>{ALLOWED_EXT.slice(0, 8).join(' · ')} · max 200 KB each</small>
          </div>
        </div>
      )}
    </main>
  );
}

function Welcome({ project, regions, onSuggest, onUpdateProject }) {
  return (
    <div className="welcome">
      <Aurora />
      <h1>
        Architect <span className="gtext">Anything</span>
      </h1>
      <p className="lede">
        Your autonomous Technical Sales Consultant for AWS. Describe your stack — get a complete,
        validated, and quoted enterprise architecture grounded in real region data.
      </p>

      {project ? (
        <>
          <div className="suggest-row">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggest" onClick={() => onSuggest(s)}>{s}</button>
            ))}
          </div>

          <div className="pickers">
            <span className="muted" style={{ alignSelf: 'center', fontSize: 11, padding: '0 6px' }}>Region</span>
            <select
              className="select"
              value={project.region}
              onChange={(e) => onUpdateProject({ region: e.target.value })}
            >
              {regions.map(r => <option key={r.code} value={r.code}>{r.code} — {r.country}</option>)}
            </select>
          </div>
        </>
      ) : (
        <div className="muted" style={{ marginTop: 24 }}>
          ← Create a project from the left sidebar to begin.
        </div>
      )}
    </div>
  );
}

function Message({ role, content, error, attachments }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) postProcessMermaid(ref.current);
  }, [content]);

  if (role === 'user') {
    return (
      <div className="msg user fade-in">
        <div className="avatar">You</div>
        <div className="bubble">
          <div className="name">You</div>
          <div className="content"><p>{content}</p></div>
          {attachments && attachments.length > 0 && (
            <div className="attach-row" style={{ marginTop: 8 }}>
              {attachments.map((a, i) => (
                <span key={i} className="attach-chip readonly">
                  <FileText size={11} />
                  {a.name}
                  <span className="attach-size">{(a.bytes / 1024).toFixed(1)} KB</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={`msg assistant fade-in ${error ? 'error' : ''}`}>
      <div className="avatar"><Sparkles size={14} /></div>
      <div className="bubble">
        <div className="name">Cloud Architect</div>
        <div
          className="content"
          ref={ref}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      </div>
    </div>
  );
}
