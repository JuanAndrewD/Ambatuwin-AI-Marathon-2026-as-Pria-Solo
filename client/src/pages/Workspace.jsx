import React, { useEffect, useRef, useState } from 'react';
import { Cloud, BookText, Settings2, Activity, PencilLine, Home, Library, FileArchive, FolderOpen, Zap, Github, LogOut } from 'lucide-react';
import JSZip from 'jszip';
import { api } from '../lib/api';
import { useNavigate } from '../lib/router';
import { useAuth } from '../lib/auth';
import ChatPane from '../components/ChatPane';
import StudioPane from '../components/StudioPane';
import ResourcesPane from '../components/ResourcesPane';
import DocumentsPane from '../components/DocumentsPane';
import DocumentEditor from '../components/DocumentEditor';
import ResizeHandle from '../components/ResizeHandle';
import QuickSpecModal from '../components/QuickSpecModal';
import SignInScreen from '../components/SignInScreen';
import GitHubModal from '../components/GitHubModal';
import {
  extractFile, isAllowed, isBinaryFormat, docTypeFor,
  MAX_FILE_BYTES, MAX_FILES,
} from '../lib/extract';
import '../styles/app.css';

const LEFT_TABS = [
  { id: 'projects',  label: 'Projects',  Icon: BookText },
  { id: 'documents', label: 'Docs',      Icon: FolderOpen },
  { id: 'resources', label: 'Resources', Icon: Settings2 },
];

const AUTOSAVE_MS = 1200;
const PANE_KEY = 'cia.pane-widths.v1';

export default function Workspace() {
  const nav = useNavigate();
  const auth = useAuth();
  const [showGitHub, setShowGitHub] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [catalog, setCatalog] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeProject, setActiveProject] = useState(null);
  const [leftTab, setLeftTab] = useState('projects');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDraftingBrief, setIsDraftingBrief] = useState(false);
  const [scrollToPlanNonce, setScrollToPlanNonce] = useState(0);
  const [showQuickSpec, setShowQuickSpec] = useState(false);
  const [quickSpecBusy, setQuickSpecBusy] = useState(false);
  const [refineBusy, setRefineBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState('');
  const [error, setError] = useState(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [paneWidths, setPaneWidths] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PANE_KEY) || ''); } catch {}
    return { left: 280, right: 360 };
  });

  function setLeftWidth(w) {
    setPaneWidths(p => {
      const next = { ...p, left: w };
      try { localStorage.setItem(PANE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  function setRightWidth(w) {
    setPaneWidths(p => {
      const next = { ...p, right: w };
      try { localStorage.setItem(PANE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  // Document editing state
  const [activeDocId, setActiveDocId] = useState(null);
  const [openDoc, setOpenDoc] = useState(null);     // hydrated copy of the active doc
  const [docDirty, setDocDirty] = useState(false);
  const [savingState, setSavingState] = useState('idle'); // idle | dirty | saving | saved | error
  const [docImporting, setDocImporting] = useState(false);
  const [docImportError, setDocImportError] = useState(null);
  const autosaveRef = useRef(null);

  useEffect(() => {
    // Catalog is public; load it regardless of auth state.
    api.catalog().then(setCatalog).catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    // Projects are user-scoped — only fetch once a session exists.
    if (!auth.user) { setProjects([]); setActiveId(null); return; }
    (async () => {
      try {
        const list = await api.listProjects();
        setProjects(list.projects);
        if (list.projects.length > 0) setActiveId(prev => prev || list.projects[0].id);
      } catch (e) { setError(e.message); }
    })();
  }, [auth.user]);

  useEffect(() => {
    if (!activeId) { setActiveProject(null); return; }
    let cancelled = false;
    api.getProject(activeId).then(({ project }) => {
      if (!cancelled) setActiveProject(project);
    }).catch(e => setError(e.message));
    setActiveDocId(null); setOpenDoc(null); setDocDirty(false); setSavingState('idle');
    return () => { cancelled = true; };
  }, [activeId]);

  // When a document is selected, hydrate it.
  useEffect(() => {
    if (!activeId || !activeDocId) { setOpenDoc(null); return; }
    api.getDocument(activeId, activeDocId)
      .then(({ document }) => { setOpenDoc(document); setDocDirty(false); setSavingState('saved'); })
      .catch(e => setError(e.message));
  }, [activeId, activeDocId]);

  async function refreshProjectsList() {
    try { const { projects } = await api.listProjects(); setProjects(projects); }
    catch (e) { setError(e.message); }
  }
  async function refreshActive() {
    if (!activeId) return;
    try { const { project } = await api.getProject(activeId); setActiveProject(prev => mergeActiveProject(prev, project)); }
    catch (e) { setError(e.message); }
  }

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
      if (activeId === id) { setActiveId(null); setActiveProject(null); }
      await refreshProjectsList();
    } catch (e) { setError(e.message); }
  }
  async function patchProject(patch) {
    if (!activeId) return;
    try {
      const { project } = await api.updateProject(activeId, patch);
      setActiveProject(prev => mergeActiveProject(prev, project));
      await refreshProjectsList();
    } catch (e) { setError(e.message); }
  }
  async function handleClearChat() {
    if (!activeId) return;
    if (!confirm('Clear chat history for this project?')) return;
    try { const { project } = await api.clearChat(activeId); setActiveProject(project); }
    catch (e) { setError(e.message); }
  }
  async function handleSendMessage(message, attachments = []) {
    if (!activeId) return;
    const optimistic = {
      role: 'user',
      content: message,
      ts: new Date().toISOString(),
      attachments: attachments.map(a => ({ name: a.name, bytes: a.bytes })),
    };
    setActiveProject(p => p ? { ...p, chat: [...(p.chat || []), optimistic] } : p);
    setIsThinking(true);
    try {
      await api.chat(activeId, message, attachments);
      await refreshActive();
      await refreshProjectsList();
    } catch (e) {
      setError(e.message);
      setActiveProject(p => p ? { ...p, chat: [...(p.chat || []), { role: 'assistant', content: `⚠️ ${e.message}`, error: true }] } : p);
    } finally {
      setIsThinking(false);
    }
  }

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
  function selectNone() { patchProject({ enabled_services: [] }); }

  // ---- Document handlers --------------------------------------------------

  function openDocument(docId) {
    // Switch the centre column to the editor view.
    setActiveDocId(docId);
    setLeftTab('documents');
  }
  function closeDocument() {
    if (docDirty) saveOpenDoc(); // best-effort flush
    setActiveDocId(null);
    setOpenDoc(null);
    setSavingState('idle');
  }

  async function createDoc(payload) {
    try {
      const { document } = await api.createDocument(activeId, payload);
      await refreshActive();
      openDocument(document.id);
    } catch (e) { setError(e.message); }
  }

  // Import files dropped on / chosen in the Docs tab. Structured text becomes
  // an editable document; unstructured formats (PDF/DOCX/PPTX) become a
  // preview-only document whose extracted text feeds the architect and whose
  // original bytes are uploaded for download + GitHub sync.
  async function importDocFiles(fileList) {
    if (!activeId) return;
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setDocImportError(null);
    setDocImporting(true);
    const errors = [];
    let lastId = null;
    try {
      for (const f of incoming) {
        if (!isAllowed(f.name)) { errors.push(`"${f.name}" — unsupported type`); continue; }
        if (f.size > MAX_FILE_BYTES) { errors.push(`"${f.name}" exceeds 50 MB`); continue; }
        try {
          const extracted = await extractFile(f); // { name, bytes, content, binary, mime }
          const binary = isBinaryFormat(f.name);
          // Cap the extracted text we persist into the (polled) project row so
          // a huge document doesn't bloat every refresh. The original bytes are
          // preserved in full via the blob upload below.
          const MAX_TEXT = 1_000_000; // ~1 MB of extracted text
          let content = extracted.content;
          if (content.length > MAX_TEXT) {
            content = content.slice(0, MAX_TEXT) + '\n\n[truncated — open the original file to read the rest]';
          }
          const { document } = await api.createDocument(activeId, {
            name: extracted.name,
            type: docTypeFor(f.name),
            content,
            included_in_context: false,
            binary,
            mime: extracted.mime,
            orig_bytes: extracted.bytes,
          });
          if (binary) {
            // Store the original bytes so we can preview + push them to GitHub.
            await api.uploadDocumentRaw(activeId, document.id, f);
          }
          lastId = document.id;
        } catch (err) {
          errors.push(`"${f.name}": ${err.message}`);
        }
      }
      await refreshActive();
      if (lastId) openDocument(lastId);
    } finally {
      setDocImporting(false);
      if (errors.length) setDocImportError(errors.join(' · '));
    }
  }

  async function deleteDoc(docId) {
    try {
      await api.deleteDocument(activeId, docId);
      if (activeDocId === docId) { setActiveDocId(null); setOpenDoc(null); }
      await refreshActive();
    } catch (e) { setError(e.message); }
  }

  async function toggleDocContext(docId, value) {
    try {
      await api.updateDocument(activeId, docId, { included_in_context: value });
      await refreshActive();
      if (openDoc?.id === docId) setOpenDoc(d => ({ ...d, included_in_context: value }));
    } catch (e) { setError(e.message); }
  }

  function changeOpenDoc(patch) {
    // Base the next value on the ref (the latest committed edit), not on the
    // closure-captured `openDoc`, so rapid edits/pastes never read a stale
    // snapshot. Keep the ref + dirty flag in lockstep SYNCHRONOUSLY so the
    // debounced save below always sees the most recent content.
    const base = openDocSlot.current || openDoc;
    if (!base) return;
    const next = { ...base, ...patch };
    openDocSlot.current = next;
    docDirtySlot.current = true;
    setOpenDoc(next);
    setDocDirty(true);
    setSavingState('dirty');

    // debounced auto-save
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(() => { saveOpenDoc(); }, AUTOSAVE_MS);
  }

  async function saveOpenDoc() {
    if (!activeId) return;
    // Read the LATEST document from the ref rather than the stale closure.
    // This is the fix for edits (especially pastes) being dropped: the
    // debounced timer used to fire a saveOpenDoc that closed over an
    // out-of-date `openDoc`, so the final edit was never persisted.
    const current = openDocSlot.current;
    if (!current) return;
    if (autosaveRef.current) { clearTimeout(autosaveRef.current); autosaveRef.current = null; }
    const snapshot = { name: current.name, content: current.content };
    setSavingState('saving');
    try {
      const { document } = await api.updateDocument(activeId, current.id, snapshot);
      // Reconcile carefully: keep the user's local edits if they kept typing
      // during the round-trip. Only adopt server metadata that doesn't
      // conflict with active typing. This was the cause of the duplicated-
      // character bug ("# # heading" instead of "# heading"). We compare
      // against the ref (latest), not the closure-captured value.
      const latest = openDocSlot.current || current;
      const stillAhead = latest.content !== snapshot.content || latest.name !== snapshot.name;
      const merged = {
        ...latest,
        id: document.id,
        type: document.type,
        pinned: document.pinned,
        included_in_context: document.included_in_context,
        updated_at: document.updated_at,
        content: stillAhead ? latest.content : document.content,
        name: stillAhead ? latest.name : document.name,
      };
      openDocSlot.current = merged;
      setOpenDoc(d => (d ? merged : document));
      if (stillAhead) {
        docDirtySlot.current = true;
        setDocDirty(true);
        setSavingState('dirty');
        if (autosaveRef.current) clearTimeout(autosaveRef.current);
        autosaveRef.current = setTimeout(() => { saveOpenDoc(); }, AUTOSAVE_MS);
      } else {
        docDirtySlot.current = false;
        setDocDirty(false);
        setSavingState('saved');
      }
      // Refresh sidebar metadata without clobbering the open editor.
      const { project } = await api.getProject(activeId);
      setActiveProject(prev => mergeActiveProject(prev, project));
    } catch (e) {
      setError(e.message);
      setSavingState('error');
    }
  }

  // Keep a ref pointer to the latest openDoc so non-render code can read it.
  const openDocSlot = useRef(null);
  useEffect(() => { openDocSlot.current = openDoc; }, [openDoc]);

  // When refreshing the active project (after chat / studio actions, polling,
  // tab focus, etc.), do NOT clobber an open document if the user has unsaved
  // edits in flight. If the editor is clean (saved or idle), adopt the server
  // copy so external changes (Quick Spec, Refine, second-tab edit) flow in.
  function mergeActiveProject(prev, fresh) {
    if (!fresh) return prev;
    if (!prev || !openDocSlot.current) return fresh;
    const slot = openDocSlot.current;
    const localIsDirty = docDirtySlot.current; // ref so we read latest, not closure-captured
    if (!localIsDirty) {
      // Editor is clean — let server content win, and reflect it in the open
      // editor view too (so the freshly refined / spec'd content appears).
      const updated = (fresh.documents || []).find(d => d.id === slot.id);
      if (updated) {
        // Update the openDoc state so the editor visibly refreshes.
        setOpenDoc(prevDoc => prevDoc ? { ...prevDoc, ...updated } : prevDoc);
      }
      return fresh;
    }
    // Editor is dirty — keep the user's in-flight content and name.
    return {
      ...fresh,
      documents: (fresh.documents || []).map(d =>
        d.id === slot.id
          ? { ...d, content: slot.content, name: slot.name }
          : d
      ),
    };
  }

  // Track the latest dirty flag in a ref so mergeActiveProject reads the
  // current value (it runs from intervals / async callbacks where closures
  // would otherwise see a stale value).
  const docDirtySlot = useRef(false);
  useEffect(() => { docDirtySlot.current = docDirty; }, [docDirty]);

  // Splice a fresh doc payload into the active project's local documents
  // array (used by all three "create/modify a doc on the server" actions so
  // the sidebar updates instantly, without waiting for the next poll).
  async function manualRefresh() {
    if (!activeId) return;
    setIsSyncing(true);
    try {
      const [proj, list] = await Promise.all([api.getProject(activeId), api.listProjects()]);
      setActiveProject(prev => mergeActiveProject(prev, proj.project));
      setProjects(list.projects);
      setLastSyncedAt(new Date().toISOString());
    } catch (e) { setError(e.message); }
    finally { setIsSyncing(false); }
  }

  function spliceDocLocally(serverDoc) {
    if (!serverDoc) return;
    setActiveProject(prev => {
      if (!prev) return prev;
      const docs = prev.documents || [];
      const idx = docs.findIndex(d => d.id === serverDoc.id);
      const nextDocs = idx >= 0
        ? docs.map((d, i) => (i === idx ? { ...d, ...serverDoc } : d))
        : [...docs, serverDoc];
      return { ...prev, documents: nextDocs };
    });
  }

  async function refineBriefFromEditor() {
    if (!activeId || !openDoc) return;
    if (!openDoc.content?.trim()) { setError('Editor is empty — write a few notes first.'); return; }
    setRefineBusy(true);
    try {
      const { document } = await api.refineBrief(activeId, openDoc.content);
      // Adopt the refined content into the open editor view.
      setOpenDoc(d => d ? { ...d, content: document.content, updated_at: document.updated_at } : document);
      // Update the openDocSlot ref synchronously so the merge helper used by
      // the polling loop sees the refined content (not the pre-refine notes).
      openDocSlot.current = { ...(openDocSlot.current || {}), ...document };
      setSavingState('saved');
      setDocDirty(false);
      // Splice the server doc into the project so the sidebar reflects the
      // new size + updated_at right away — no need to wait for the next poll.
      spliceDocLocally(document);
    } catch (e) { setError(e.message); }
    finally { setRefineBusy(false); }
  }

  async function runQuickSpec(prompt) {
    if (!activeId || !prompt?.trim()) return;
    setQuickSpecBusy(true);
    try {
      const { document } = await api.quickSpec(activeId, prompt);
      // Optimistic insert so the new spec appears instantly in the Docs list.
      spliceDocLocally(document);
      await refreshProjectsList();
      setShowQuickSpec(false);
      openDocument(document.id);
      setLeftTab('documents');
    } catch (e) { setError(e.message); }
    finally { setQuickSpecBusy(false); }
  }

  async function draftBriefFromHistory() {
    if (!activeId) return;
    setIsDraftingBrief(true);
    try {
      const { document } = await api.draftBrief(activeId);
      // Optimistic insert/update — the brief doc id is stable per project, so
      // this just refreshes its content + updated_at in place.
      spliceDocLocally(document);
      openDocument(document.id);
    } catch (e) { setError(e.message); }
    finally { setIsDraftingBrief(false); }
  }

  function insertDocIntoChat() {
    if (!openDoc) return;
    const message = `I'm sharing the contents of **${openDoc.name}** with you. Use it as authoritative context for the rest of this conversation:\n\n---\n\n${openDoc.content}`;
    closeDocument();
    handleSendMessage(message);
  }

  // Save before leaving the page if the editor is dirty.
  useEffect(() => {
    function beforeUnload(e) {
      if (docDirty) { e.preventDefault(); e.returnValue = ''; }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [docDirty]);

  // Workspace clamps the viewport (3-pane grid). Other routes scroll naturally.
  useEffect(() => {
    document.body.classList.add('workspace-mounted');
    return () => document.body.classList.remove('workspace-mounted');
  }, []);

  // Surface an OAuth error passed back via the callback redirect.
  useEffect(() => {
    const m = (window.location.hash || '').match(/auth_error=([^&]+)/);
    if (m) {
      const msg = 'GitHub sign-in failed: ' + decodeURIComponent(m[1]);
      setError(msg);
      setAuthError(msg); // also shown on the sign-in screen (rendered before the toast)
      // Strip the param so it doesn't persist on refresh.
      window.history.replaceState(null, '', window.location.pathname + '#/app');
    }
  }, []);

  // ---- Auto-sync ----------------------------------------------------------
  // Poll the active project every 4s so docs created server-side (Quick Spec,
  // Draft Brief, AI refine) appear without manual refresh. Also refresh on
  // tab focus and visibility change for instant catch-up after switching tabs.
  useEffect(() => {
    if (!activeId) return;
    let alive = true;

    async function quietRefresh() {
      try {
        setIsSyncing(true);
        const [proj, list] = await Promise.all([api.getProject(activeId), api.listProjects()]);
        if (!alive) return;
        setActiveProject(prev => mergeActiveProject(prev, proj.project));
        setProjects(list.projects);
        setLastSyncedAt(new Date().toISOString());
      } catch {
        // Silent — polling shouldn't surface transient network errors.
      } finally {
        if (alive) setIsSyncing(false);
      }
    }

    const POLL_MS = 4000;
    const interval = setInterval(quietRefresh, POLL_MS);
    function onFocus()       { quietRefresh(); }
    function onVisibility()  { if (!document.hidden) quietRefresh(); }
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeId]);

  // ---- Studio handlers ----------------------------------------------------

  async function generateStudio(kind) {
    if (!activeId || !activeProject) return;
    setIsGenerating(true);
    try {
      if (kind === 'full-plan') {
        // The brief is the source of truth for the design pipeline. If it's
        // empty, synthesise one from the chat history (or seed it from the
        // project name) so the click reliably produces a plan instead of
        // bouncing back into "please draft a brief first".
        let briefText = (activeProject.brief || '').trim();

        if (!briefText) {
          if ((activeProject.chat || []).length === 0) {
            // No conversation yet either — seed a minimal placeholder brief
            // so the design pipeline can at least make a starting proposal.
            briefText = `# ${activeProject.name}\n\nInitial deployment in ${activeProject.region}. Workload details to be refined; the architect should propose a sensible default architecture and call out assumptions.`;
            await api.updateDocumentBriefMirror(activeId, briefText);
          } else {
            // We have chat history — draft a real brief from it.
            try {
              const { document } = await api.draftBrief(activeId);
              spliceDocLocally(document);
              briefText = document.content;
            } catch (e) {
              setError('Could not draft a brief from chat: ' + e.message);
              return;
            }
          }
        }

        // Now run the deterministic design pipeline.
        const { result } = await api.designForProject(activeId, { brief: briefText });
        // Adopt the new plan into local state immediately so the Studio
        // KPIs and "View plan in chat" become available without waiting
        // for the next poll.
        setActiveProject(prev => prev ? { ...prev, brief: briefText, last_plan: result } : prev);
        // The server persisted the full plan as a chat message. Pull it in and
        // scroll to its top so the complete plan shows in chat by default.
        await refreshActive();
        await refreshProjectsList();
        setScrollToPlanNonce(n => n + 1);
      } else if (kind === 'diagram') {
        await handleSendMessage('Show me the architecture diagram for this project as a Mermaid flowchart, grouped by edge / app / data / ops tiers. IMPORTANT: emit each Mermaid statement on its own line inside a fenced ```mermaid block — never put the whole graph on a single line.');
      } else if (kind === 'bill') {
        if (!activeProject.last_plan) {
          setError('No plan yet — click "Generate plan" first, then ask for the itemized bill.');
          return;
        }
        await handleSendMessage('Give me a clean itemized monthly bill for the current architecture in markdown table form, including a budget delta if a budget was set.');
      } else if (kind === 'compliance') {
        if (!activeProject.last_plan) {
          setError('No plan yet — click "Generate plan" first, then run the compliance audit.');
          return;
        }
        await handleSendMessage('Audit the compliance posture of the generated plan (data residency, encryption, network isolation, IAM). Use the catalog data and call out anything that fails. Reference the components by their `id` from the last plan.');
      } else if (kind === 'terraform') {
        if (!activeProject.last_plan) {
          setError('No plan yet — click "Generate plan" first, then ask for the Terraform skeleton.');
          return;
        }
        await handleSendMessage('Generate a Terraform skeleton (HCL, fenced) for the components in the current plan. Do not include secrets, and keep it idiomatic.');
      } else if (kind === 'proposal') {
        if (!activeProject.last_plan) {
          setError('No plan yet — click "Generate plan" first, then ask for the sales proposal.');
          return;
        }
        await handleSendMessage('Write a 1-page sales proposal for the client based on this architecture: executive summary, what we are delivering, monthly cost, compliance posture, and next steps. Tone: confident sales engineer.');
      }
    } catch (e) {
      // The design endpoint usually fails because the LLM took too long or
      // returned malformed JSON. Surface the message instead of swallowing.
      setError(e.message || 'Plan generation failed');
    }
    finally { setIsGenerating(false); }
  }

  async function showPlanInChat() {
    if (!activeId || !activeProject?.last_plan?.markdown) return;
    try {
      // Persist the plan as a fresh assistant turn server-side so it survives
      // the polling refresh, then refresh and trigger a scroll to its top.
      await api.planToChat(activeId);
      await refreshActive();
      setScrollToPlanNonce(n => n + 1);
    } catch (e) {
      setError(e.message);
    }
  }

  async function exportProject() {
    if (!activeProject) return;
    try {
      const zip = new JSZip();
      const folder = zip.folder(slug(activeProject.name));
      folder.file('README.md', `# ${activeProject.name}\n\nRegion: \`${activeProject.region}\`\nGenerated: ${new Date().toISOString()}\n\nThis bundle was exported from the Cloud Infrastructure Architect.`);

      // Drop every project document.
      for (const d of (activeProject.documents || [])) {
        const safe = d.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        folder.file(`documents/${safe}`, d.content || '');
      }

      if (activeProject.last_plan?.markdown) folder.file('plan.md', activeProject.last_plan.markdown);

      const chat = activeProject.chat || [];
      const tf = mostRecentMatching(chat, /```hcl|```terraform|terraform/i);
      if (tf) folder.file('extracted/terraform.md', tf);
      const proposal = mostRecentMatching(chat, /(executive summary|sales proposal|proposal)/i);
      if (proposal) folder.file('extracted/proposal.md', proposal);

      folder.file('chat.md',
        '# Chat transcript\n\n' +
        chat.map(m => `### ${m.role.toUpperCase()} · ${m.ts || ''}\n\n${m.content}\n`).join('\n---\n\n')
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `${slug(activeProject.name)}-${ts}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
  }

  function startEditName() {
    if (!activeProject) return;
    setTempName(activeProject.name); setEditingName(true);
  }
  async function commitEditName() {
    if (tempName && tempName !== activeProject.name) await patchProject({ name: tempName });
    setEditingName(false);
  }

  const regions = catalog?.regions || [];
  const documents = activeProject?.documents
    ? activeProject.documents.map(d => ({
        id: d.id, type: d.type, name: d.name,
        bytes: d.binary ? (d.orig_bytes || 0) : new Blob([d.content || '']).size,
        included_in_context: !!d.included_in_context,
        pinned: !!d.pinned,
        binary: !!d.binary,
        mime: d.mime || '',
        updated_at: d.updated_at,
      }))
    : [];

  // ---- Auth gate ----------------------------------------------------------
  // Until a session exists, the whole workspace is replaced by the sign-in
  // screen. We still let the body class apply so the background matches.
  if (auth.loading) {
    return (
      <div className="signin-screen">
        <div className="signin-card"><p className="muted">Loading…</p></div>
      </div>
    );
  }
  if (!auth.user) {
    return (
      <SignInScreen
        onLogin={() => auth.login('#/app')}
        configured={auth.configured}
        mode={auth.mode}
        error={authError || auth.error}
      />
    );
  }

  return (
    <div
      className={`app-shell ${leftCollapsed ? 'collapsed-left' : ''} ${rightCollapsed ? 'collapsed-right' : ''}`}
      style={{ '--left-w': leftCollapsed ? '56px' : `${paneWidths.left}px`, '--right-w': rightCollapsed ? '56px' : `${paneWidths.right}px` }}
    >      <header className="topbar">
        <div className="brand">
          <span className="mark" onClick={() => nav('/')} style={{ cursor: 'pointer' }} title="Back to landing">
            <Cloud size={15} color="#fff" />
          </span>
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
        <div className="actions" style={{ gap: 12 }}>
          <button className="btn tiny ghost" onClick={() => nav('/')} title="Landing"><Home size={11} /> Home</button>
          <button className="btn tiny ghost" onClick={() => nav('/services')} title="Service library"><Library size={11} /> Services</button>
          {activeProject && (
            <button className="btn tiny" onClick={() => setShowQuickSpec(true)} title="Quick Spec — Requirements, Design, Tasks">
              <Zap size={11} /> Quick Spec
            </button>
          )}
          {activeProject && (
            <button className="btn tiny" onClick={exportProject} title="Export project as .zip">
              <FileArchive size={11} /> Export .zip
            </button>
          )}
          <button className="btn tiny" onClick={() => setShowGitHub(true)} title="Attach a GitHub repo to this project and sync files" disabled={!activeProject}>
            <Github size={11} /> {activeProject?.repo ? 'GitHub · ' + activeProject.repo.name : 'Connect GitHub'}
          </button>
          <span className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Activity size={12} /> Chutes LLM
          </span>
          <div className="user-menu-wrap">
            <button className="user-chip" onClick={() => setShowUserMenu(v => !v)} title={auth.user.username}>
              {auth.user.avatar_url
                ? <img src={auth.user.avatar_url} alt="" className="user-avatar" />
                : <span className="user-avatar fallback">{(auth.user.username || '?')[0].toUpperCase()}</span>}
            </button>
            {showUserMenu && (
              <>
                <div className="user-menu-backdrop" onClick={() => setShowUserMenu(false)} />
                <div className="user-menu">
                  <div className="user-menu-head">
                    <div className="user-menu-name">{auth.user.name || auth.user.username}</div>
                    <div className="user-menu-login muted">@{auth.user.username}</div>
                  </div>
                  <button className="user-menu-item" onClick={() => { setShowUserMenu(false); setShowGitHub(true); }}>
                    <Github size={13} /> GitHub repo
                  </button>
                  <button className="user-menu-item" onClick={async () => { setShowUserMenu(false); await auth.logout(); }}>
                    <LogOut size={13} /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

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
                  <t.Icon size={11} /> {t.label}
                </button>
              ))}
            </div>
          )}
          <button className="collapse-btn" onClick={() => setLeftCollapsed(v => !v)} title="Collapse">‹</button>
        </div>
        {!leftCollapsed && (
          <div className="pane-body">
            {leftTab === 'projects' && (
              <ProjectsContent
                projects={projects}
                activeId={activeId}
                onSelect={setActiveId}
                onCreate={handleCreate}
                onDelete={handleDelete}
              />
            )}
            {leftTab === 'documents' && (
              activeProject ? (
                <DocumentsPane
                  documents={documents}
                  activeDocId={activeDocId}
                  onOpen={openDocument}
                  onCreate={createDoc}
                  onDelete={deleteDoc}
                  onToggleContext={toggleDocContext}
                  onDraftBrief={draftBriefFromHistory}
                  isDrafting={isDraftingBrief}
                  onRefresh={manualRefresh}
                  lastSyncedAt={lastSyncedAt}
                  isSyncing={isSyncing}
                  onImportFiles={importDocFiles}
                  isImporting={docImporting}
                  importError={docImportError}
                  onDismissImportError={() => setDocImportError(null)}
                />
              ) : <div className="muted" style={{ fontSize: 12, padding: 12 }}>Select or create a project to manage its documents.</div>
            )}
            {leftTab === 'resources' && (
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

      <ResizeHandle
        side="left"
        onResize={setLeftWidth}
        min={220}
        max={520}
        ariaLabel="Resize left sidebar"
      />

      {/* Centre column: editor when a doc is open, otherwise the chat */}
      {openDoc ? (
        <DocumentEditor
          document={openDoc}
          projectId={activeId}
          onChange={changeOpenDoc}
          onSave={saveOpenDoc}
          onClose={closeDocument}
          onToggleContext={(value) => toggleDocContext(openDoc.id, value)}
          onInsertIntoChat={insertDocIntoChat}
          onAIRefine={openDoc.type === 'brief' ? refineBriefFromEditor : null}
          aiBusy={refineBusy}
          savingState={savingState}
        />
      ) : (
        <ChatPane
          project={activeProject}
          regions={regions}
          isThinking={isThinking}
          onSend={handleSendMessage}
          onClearChat={handleClearChat}
          onUpdateProject={patchProject}
          scrollToPlanNonce={scrollToPlanNonce}
        />
      )}

      <ResizeHandle
        side="right"
        onResize={setRightWidth}
        min={260}
        max={520}
        ariaLabel="Resize Studio panel"
      />

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

      {showQuickSpec && (
        <QuickSpecModal
          onCancel={() => setShowQuickSpec(false)}
          onSubmit={runQuickSpec}
          busy={quickSpecBusy}
          project={activeProject}
          documents={documents}
        />
      )}

      {showGitHub && (
        <GitHubModal
          user={auth.user}
          project={activeProject}
          onClose={() => setShowGitHub(false)}
          onProjectChange={(p) => {
            setActiveProject(prev => mergeActiveProject(prev, p));
            refreshProjectsList();
          }}
        />
      )}
    </div>
  );
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
}

function mostRecentMatching(messages, pattern) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && pattern.test(m.content)) return m.content;
  }
  return null;
}

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
              <div className="psub">
                {p.region} · {p.chat_count} msgs · {p.has_plan ? 'plan ready' : 'no plan'}
                {p.has_repo && <> · <Github size={9} style={{ verticalAlign: '-1px' }} /> {p.repo_full_name}</>}
              </div>
            </div>
            <button className="pdel" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${p.name}"?`)) onDelete(p.id); }} title="Delete">×</button>
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
