import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, BookText, Settings2, Activity, PencilLine } from 'lucide-react';
import { api } from './lib/api';
import ChatPane from './components/ChatPane';
import StudioPane from './components/StudioPane';
import ResourcesPane from './components/ResourcesPane';
import './styles/app.css';

const LEFT_TABS = [
  { id: 'projects', label: 'Projects' },
  { id: 'resources', label: 'Resources' },
];

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeProject, setActiveProject] = useState(null);
  const [leftTab, setLeftTab] = useState('projects');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState('');
  const [error, setError] = useState(null);

  // ---- Bootstrap ----------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const [cat, list] = await Promise.all([api.catalog(), api.listProjects()]);
        setCatalog(cat);
        setProjects(list.projects);
        if (list.projects.length > 0) {
          setActiveId(list.projects[0].id);
        }
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);

  // Hydrate active project on selection change
  useEffect(() => {
    if (!activeId) { setActiveProject(null); return; }
    let cancelled = false;
    api.getProject(activeId).then(({ project }) => {
      if (!cancelled) setActiveProject(project);
    }).catch(e => setError(e.message));
    return () => { cancelled = true; };
  }, [activeId]);

  async function refreshProjectsList() {
    try {
      const { projects } = await api.listProjects();
      setProjects(projects);
    } catch (e) { setError(e.message); }
  }

  async function refreshActive() {
    if (!activeId) return;
    try {
      const { project } = await api.getProject(activeId);
      setActiveProject(project);
    } catch (e) { setError(e.message); }
  }

  // ---- Project actions ----------------------------------------------------
  async function handleCreate({ name, region }) {
    try {
      const { project } = await api.createProject({ name, region });
      await refreshProjectsList();
      setActiveId(project.id);
      setLeftTab('projects');
    } catch (e) { setError(e.message); }
  }

  async function handleDelete(id) {
    try {
      await api.deleteProject(id);
      if (activeId === id) {
        setActiveId(null);
        setActiveProject(null);
      }
      await refreshProjectsList();
    } catch (e) { setError(e.message); }
  }

  async function patchProject(patch) {
    if (!activeId) return;
    try {
      const { project } = await api.updateProject(activeId, patch);
      setActiveProject(project);
      await refreshProjectsList();
    } catch (e) { setError(e.message); }
  }

  async function handleClearChat() {
    if (!activeId) return;
    if (!confirm('Clear chat history for this project?')) return;
    try {
      const { project } = await api.clearChat(activeId);
      setActiveProject(project);
    } catch (e) { setError(e.message); }
  }

  async function handleSendMessage(message) {
    if (!activeId) return;
    // optimistic append
    const optimistic = { role: 'user', content: message, ts: new Date().toISOString() };
    setActiveProject(p => p ? { ...p, chat: [...(p.chat || []), optimistic] } : p);
    setIsThinking(true);
    try {
      await api.chat(activeId, message);
      await refreshActive();
      await refreshProjectsList();
    } catch (e) {
      setError(e.message);
      // surface as an assistant error message
      setActiveProject(p => p ? { ...p, chat: [...(p.chat || []), { role: 'assistant', content: `⚠️ ${e.message}`, error: true }] } : p);
    } finally {
      setIsThinking(false);
    }
  }

  // ---- Resources ----------------------------------------------------------
  function toggleService(name) {
    if (!activeProject) return;
    const current = new Set(activeProject.enabled_services || []);
    if (current.has(name)) current.delete(name); else current.add(name);
    patchProject({ enabled_services: Array.from(current) });
  }

  function selectAll() {
    if (!catalog) return;
    patchProject({ enabled_services: catalog.services.map(s => s.name) });
  }
  function selectNone() {
    patchProject({ enabled_services: [] });
  }

  // ---- Studio actions -----------------------------------------------------
  async function generateStudio(kind) {
    if (!activeId || !activeProject) return;
    setIsGenerating(true);
    try {
      if (kind === 'full-plan') {
        if (!activeProject.brief?.trim()) {
          // ask the user for a brief in chat
          await handleSendMessage('Please draft a high-level requirements brief based on our project name and what we have discussed so far, then I will use it to generate the deployment plan.');
          return;
        }
        await api.designForProject(activeId, { brief: activeProject.brief });
        await refreshActive();
        await refreshProjectsList();
      } else if (kind === 'diagram') {
        await handleSendMessage('Show me the architecture diagram for this project as a Mermaid flowchart, grouped by edge / app / data / ops tiers.');
      } else if (kind === 'bill') {
        await handleSendMessage('Give me a clean itemized monthly bill for the current architecture in markdown table form, including a budget delta if a budget was set.');
      } else if (kind === 'compliance') {
        await handleSendMessage('Audit the compliance posture of this architecture (data residency, encryption, network isolation, IAM). Use the catalog data and call out anything that fails.');
      } else if (kind === 'terraform') {
        await handleSendMessage('Generate a Terraform skeleton (HCL, fenced) for the components in the current plan. Do not include secrets, and keep it idiomatic.');
      } else if (kind === 'proposal') {
        await handleSendMessage('Write a 1-page sales proposal for the client based on this architecture: executive summary, what we are delivering, monthly cost, compliance posture, and next steps. Tone: confident sales engineer.');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setIsGenerating(false);
    }
  }

  function showPlanInChat() {
    if (!activeProject?.last_plan?.markdown) return;
    setActiveProject(p => p ? { ...p, chat: [...(p.chat || []), { role: 'assistant', content: p.last_plan.markdown, ts: new Date().toISOString() }] } : p);
  }

  // ---- Project name editing in the topbar ---------------------------------
  function startEditName() {
    if (!activeProject) return;
    setTempName(activeProject.name);
    setEditingName(true);
  }
  async function commitEditName() {
    if (tempName && tempName !== activeProject.name) await patchProject({ name: tempName });
    setEditingName(false);
  }

  const regions = catalog?.regions || [];

  // ---- Render -------------------------------------------------------------
  return (
    <div className={`app-shell ${leftCollapsed ? 'collapsed-left' : ''} ${rightCollapsed ? 'collapsed-right' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="mark"><Cloud size={15} color="#fff" /></span>
          <span>Cloud Infrastructure Architect</span>
          {activeProject && (
            <>
              <span className="muted" style={{ margin: '0 8px' }}>/</span>
              {editingName ? (
                <input
                  autoFocus
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onBlur={commitEditName}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitEditName(); if (e.key === 'Escape') setEditingName(false); }}
                />
              ) : (
                <span className="project-name" onClick={startEditName} title="Rename project">
                  {activeProject.name}
                  <PencilLine size={12} style={{ opacity: 0.5 }} />
                </span>
              )}
            </>
          )}
        </div>
        <div className="actions">
          <span className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={12} /> Live pricing · Chutes LLM
          </span>
        </div>
      </header>

      {/* Left: Projects + Resources tabs */}
      <aside className={`pane left ${leftCollapsed ? 'collapsed' : ''}`} style={{ gridRow: 2 }}>
        <div className="pane-header">
          {!leftCollapsed && (
            <div style={{ display: 'flex', gap: 4 }}>
              {LEFT_TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setLeftTab(t.id)}
                  className="btn tiny"
                  style={{
                    background: leftTab === t.id ? 'var(--bg-3)' : 'transparent',
                    borderColor: leftTab === t.id ? 'var(--line-strong)' : 'transparent',
                    color: leftTab === t.id ? 'var(--text)' : 'var(--text-dim)',
                  }}
                >
                  {t.id === 'projects' ? <BookText size={11} /> : <Settings2 size={11} />} {t.label}
                </button>
              ))}
            </div>
          )}
          <button className="collapse-btn" onClick={() => setLeftCollapsed(v => !v)} title="Collapse">
            ‹
          </button>
        </div>
        {!leftCollapsed && (
          <div className="pane-body">
            {leftTab === 'projects' ? (
              <ProjectsContent
                projects={projects}
                activeId={activeId}
                onSelect={setActiveId}
                onCreate={handleCreate}
                onDelete={handleDelete}
              />
            ) : (
              catalog ? (
                <ResourcesPane
                  catalog={catalog}
                  project={activeProject}
                  onToggleService={toggleService}
                  onSelectAll={selectAll}
                  onSelectNone={selectNone}
                />
              ) : <div className="muted">Loading catalog…</div>
            )}
          </div>
        )}
      </aside>

      {/* Center: Chat */}
      <ChatPane
        project={activeProject}
        regions={regions}
        isThinking={isThinking}
        onSend={handleSendMessage}
        onClearChat={handleClearChat}
        onUpdateProject={patchProject}
      />

      {/* Right: Studio */}
      <StudioPane
        project={activeProject}
        plan={activeProject?.last_plan}
        isGenerating={isGenerating}
        onGenerate={generateStudio}
        collapsed={rightCollapsed}
        onToggleCollapse={() => setRightCollapsed(v => !v)}
        onShowPlan={showPlanInChat}
      />

      {error && (
        <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-3)', border: '1px solid var(--red)', color: 'var(--red)', padding: '8px 14px', borderRadius: 8, fontSize: 13, zIndex: 50 }}>
          {error}
          <button className="btn tiny ghost" style={{ marginLeft: 12 }} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

// Inline component (uses ProjectsPane's body without the outer pane chrome)
function ProjectsContent({ projects, activeId, onSelect, onCreate, onDelete }) {
  const [showNew, setShowNew] = React.useState(false);
  const [name, setName] = React.useState('');
  const [region, setRegion] = React.useState('ap-southeast-5');

  function submit(e) {
    e?.preventDefault?.();
    if (!name.trim()) return;
    onCreate({ name: name.trim(), region });
    setName(''); setShowNew(false);
  }

  return (
    <>
      <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setShowNew(true)}>
        + New project
      </button>

      <div style={{ height: 16 }} />
      <div className="side-section">Recent</div>
      <div className="projects-list">
        {projects.length === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: '12px 8px', textAlign: 'center' }}>
            No projects yet. Create one to get started.
          </div>
        )}
        {projects.map(p => (
          <div
            key={p.id}
            className={`project-row ${activeId === p.id ? 'active' : ''}`}
            onClick={() => onSelect(p.id)}
          >
            <div className="pdot" />
            <div className="meta">
              <div className="pname">{p.name}</div>
              <div className="psub">{p.region} · {p.chat_count} msgs · {p.has_plan ? 'plan ready' : 'no plan'}</div>
            </div>
            <button className="pdel" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${p.name}"?`)) onDelete(p.id); }} title="Delete">
              ×
            </button>
          </div>
        ))}
      </div>

      {showNew && (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Create a new project</h3>
            <p className="muted">Each project keeps its own brief, region, allowed services, and chat history.</p>
            <form className="row" onSubmit={submit}>
              <div>
                <label className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project name</label>
                <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Fintech savings app — KL launch" />
              </div>
              <div>
                <label className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Default AWS region</label>
                <select className="select" value={region} onChange={e => setRegion(e.target.value)}>
                  <option value="ap-southeast-5">ap-southeast-5 — Malaysia</option>
                  <option value="ap-southeast-1">ap-southeast-1 — Singapore</option>
                  <option value="ap-southeast-3">ap-southeast-3 — Jakarta</option>
                  <option value="ap-southeast-7">ap-southeast-7 — Thailand</option>
                  <option value="ap-northeast-1">ap-northeast-1 — Tokyo</option>
                  <option value="ap-south-1">ap-south-1 — Mumbai</option>
                  <option value="us-east-1">us-east-1 — N. Virginia</option>
                  <option value="eu-west-1">eu-west-1 — Ireland</option>
                </select>
              </div>
              <div className="actions">
                <button type="button" className="btn ghost" onClick={() => setShowNew(false)}>Cancel</button>
                <button type="submit" className="btn primary">Create project</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
