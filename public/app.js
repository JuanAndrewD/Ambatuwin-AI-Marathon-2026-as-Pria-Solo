// The Cloud Infrastructure Architect — frontend.

const SAMPLE_BRIEF = `We are a Malaysian fintech preparing to launch a savings & investments app for ~50,000 active users primarily in Kuala Lumpur and Penang, peaking at ~6,000 concurrent at market open. We need:
- A secure PostgreSQL database with auto-failover (Multi-AZ).
- A containerised API tier behind a load balancer with auto-scaling.
- A managed Redis cache for session & rate-limit data.
- A CDN for the marketing site and the mobile app's static assets.
- Encryption at rest with customer-managed keys (KMS), WAF, and a DDoS posture.
- Daily backups retained for 30 days.
- Strict PDPA-MY data residency: no customer PII may leave Malaysia.
- Target budget: USD 4,000 / month.`;

const $ = (s) => document.querySelector(s);
const briefEl = $('#brief');
const regionEl = $('#region');
const complianceEl = $('#compliance');
const runBtn = $('#run');
const sampleBtn = $('#sample');
const downloadBtn = $('#download');
const copyBtn = $('#copy');
const statusEl = $('#status');
const outputEl = $('#output');
const kpisEl = $('#kpis');

let lastResult = null;

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    background: '#0b0e22',
    primaryColor: '#172554',
    primaryTextColor: '#e6e9ff',
    primaryBorderColor: '#a78bfa',
    lineColor: '#7dd3fc',
    secondaryColor: '#3b0764',
    tertiaryColor: '#052e16',
    fontFamily: 'Inter, sans-serif',
  },
  flowchart: { htmlLabels: true, curve: 'basis' },
  securityLevel: 'loose',
});

marked.setOptions({ gfm: true, breaks: false, mangle: false, headerIds: false });

async function loadRegions() {
  try {
    const res = await fetch('/api/regions');
    const { regions } = await res.json();
    regionEl.innerHTML = regions
      .map(r => `<option value="${r.code}">${r.code} — ${r.name}</option>`)
      .join('');
    // default to KL/Singapore for the showcase
    const preferred = regions.find(r => r.code === 'ap-southeast-5') || regions.find(r => r.code === 'ap-southeast-1');
    if (preferred) regionEl.value = preferred.code;
  } catch (err) {
    statusEl.innerHTML = `<div class="err">Failed to load regions: ${err.message}</div>`;
  }
}

function setStatus(html) { statusEl.innerHTML = html; }

function step(label, state = 'doing') {
  const icon = state === 'doing' ? '<span class="spinner"></span>'
            : state === 'ok'    ? '<span class="ok">✔</span>'
            : '<span class="err">✖</span>';
  return `<div class="step">${icon}<span>${label}</span></div>`;
}

async function runDesign() {
  const brief = briefEl.value.trim();
  if (!brief) { setStatus('<div class="err">Please paste a requirements brief first.</div>'); return; }
  const region = regionEl.value;
  const compliance = Array.from(complianceEl.selectedOptions).map(o => o.value);

  runBtn.disabled = true;
  downloadBtn.disabled = true;
  copyBtn.disabled = true;
  outputEl.innerHTML = '<div class="empty"><p>Designing your architecture…</p></div>';
  kpisEl.classList.add('hidden');

  setStatus([
    step('Extracting workload profile (LLM)…'),
    step('Designing architecture (LLM)…'),
    step('Validating region availability + computing bill (deterministic)…'),
  ].join(''));

  try {
    const res = await fetch('/api/design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief, region, compliance }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Server error ${res.status}`);
    }
    const result = await res.json();
    lastResult = result;
    renderResult(result);
    setStatus([
      step('Workload profile extracted', 'ok'),
      step('Architecture designed', 'ok'),
      step(`Bill computed: $${result.priced.total.toFixed(2)}/month — ${result.compliance.ok ? 'Compliance ✔' : 'Compliance ✖'}`, result.compliance.ok ? 'ok' : 'err'),
    ].join(''));
    downloadBtn.disabled = false;
    copyBtn.disabled = false;
  } catch (err) {
    setStatus(`<div class="err">${err.message}</div>`);
    outputEl.innerHTML = '<div class="empty"><p>Design failed. Check the status panel.</p></div>';
  } finally {
    runBtn.disabled = false;
  }
}

function renderResult(r) {
  // KPIs
  $('#kpi-bill').textContent = `$${r.priced.total.toFixed(2)}`;
  $('#kpi-region').textContent = r.region.code;
  $('#kpi-components').textContent = r.priced.items.length;
  const compliancePassCount = r.compliance.passes.length;
  const complianceFailCount = r.compliance.issues.length;
  $('#kpi-compliance').textContent = (r.profile.compliance && r.profile.compliance.length)
    ? `${compliancePassCount}/${compliancePassCount + complianceFailCount} ✓`
    : '—';
  $('#kpi-compliance').style.color = complianceFailCount ? 'var(--red)' : 'var(--green)';
  kpisEl.classList.remove('hidden');

  // Markdown → HTML
  const html = marked.parse(r.markdown);
  outputEl.innerHTML = html;

  // Convert ```mermaid``` blocks (rendered by marked as <pre><code class="language-mermaid">)
  const mermaidBlocks = outputEl.querySelectorAll('pre code.language-mermaid');
  mermaidBlocks.forEach((block, i) => {
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.id = `mmd-${Date.now()}-${i}`;
    div.textContent = block.textContent;
    block.parentElement.replaceWith(div);
  });
  if (window.mermaid) {
    mermaid.run({ querySelector: '.mermaid' }).catch(err => console.warn('mermaid render error:', err));
  }
}

function downloadMarkdown() {
  if (!lastResult) return;
  const blob = new Blob([lastResult.markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `aws-deployment-plan-${lastResult.region.code}-${ts}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function copyMarkdown() {
  if (!lastResult) return;
  try {
    await navigator.clipboard.writeText(lastResult.markdown);
    copyBtn.textContent = '✓ Copied';
    setTimeout(() => (copyBtn.textContent = '📋 Copy'), 1500);
  } catch (err) {
    alert('Copy failed: ' + err.message);
  }
}

runBtn.addEventListener('click', runDesign);
sampleBtn.addEventListener('click', () => { briefEl.value = SAMPLE_BRIEF; });
downloadBtn.addEventListener('click', downloadMarkdown);
copyBtn.addEventListener('click', copyMarkdown);

loadRegions();
