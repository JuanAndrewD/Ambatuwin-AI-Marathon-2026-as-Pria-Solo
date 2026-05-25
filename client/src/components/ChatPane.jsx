import React, { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Settings2, Trash2 } from 'lucide-react';
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

export default function ChatPane({ project, regions, isThinking, onSend, onClearChat, onUpdateProject }) {
  const [input, setInput] = useState('');
  const streamRef = useRef(null);
  const composerRef = useRef(null);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [project?.chat?.length, isThinking]);

  // Re-render mermaid for any newly-rendered assistant messages
  useEffect(() => {
    if (streamRef.current) postProcessMermaid(streamRef.current);
  }, [project?.chat]);

  function submit() {
    const value = input.trim();
    if (!value || isThinking || !project) return;
    setInput('');
    onSend(value);
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

  const messages = project?.chat || [];
  const showWelcome = !project || messages.length === 0;

  return (
    <main className="chat-pane">
      <div className="chat-stream" ref={streamRef} id="chat-stream">
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
              <Message key={i} role={m.role} content={m.content} error={m.error} />
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
          <textarea
            ref={composerRef}
            placeholder={project ? `Ask the architect about "${project.name}"…` : 'Create a project to start chatting'}
            value={input}
            onChange={autoresize}
            onKeyDown={onKeyDown}
            disabled={!project || isThinking}
          />
          <div className="composer-actions">
            <div className="left-actions">
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

function Message({ role, content, error }) {
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
