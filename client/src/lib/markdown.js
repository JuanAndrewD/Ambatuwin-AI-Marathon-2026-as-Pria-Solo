// Markdown renderer with mermaid post-processing.
// We rely on the global `marked` and `mermaid` from CDN for size, but as ES
// modules via the bundler we can also import them from npm. We use npm here.

import { marked } from 'marked';
import mermaid from 'mermaid';

let mermaidInited = false;
function ensureMermaid() {
  if (mermaidInited) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      background: '#15151c',
      primaryColor: '#1c1c25',
      primaryTextColor: '#ececf0',
      primaryBorderColor: '#8b5cf6',
      lineColor: '#06b6d4',
      secondaryColor: '#10b981',
      tertiaryColor: '#d97757',
      fontFamily: 'Inter, sans-serif',
      mainBkg: '#1c1c25',
      nodeBorder: '#8b5cf6',
      clusterBkg: '#15151c',
      clusterBorder: '#3a3a4d',
    },
    flowchart: { htmlLabels: true, curve: 'basis' },
    securityLevel: 'loose',
  });
  mermaidInited = true;
}

marked.setOptions({ gfm: true, breaks: false, mangle: false, headerIds: false });

export function renderMarkdown(text) {
  if (!text) return '';
  return marked.parse(text);
}

// Find <pre><code class="language-mermaid"> nodes and replace with .mermaid divs,
// then run mermaid.run on them.
let mmdSeq = 0;
export async function postProcessMermaid(rootEl) {
  if (!rootEl) return;
  ensureMermaid();
  const blocks = rootEl.querySelectorAll('pre code.language-mermaid');
  if (blocks.length === 0) return;
  blocks.forEach((block) => {
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.id = `mmd-${Date.now()}-${++mmdSeq}`;
    div.textContent = block.textContent;
    block.parentElement.replaceWith(div);
  });
  try {
    await mermaid.run({ querySelector: `#${rootEl.id || ''} .mermaid, .mermaid:not([data-processed="true"])` });
  } catch (err) {
    console.warn('mermaid render error:', err);
  }
}
