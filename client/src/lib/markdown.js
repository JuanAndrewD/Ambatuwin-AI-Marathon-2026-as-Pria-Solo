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
    div.textContent = normaliseMermaid(block.textContent);
    block.parentElement.replaceWith(div);
  });
  try {
    // Render any unprocessed mermaid divs in this subtree.
    const fresh = rootEl.querySelectorAll('.mermaid:not([data-processed="true"])');
    if (fresh.length > 0) {
      await mermaid.run({ nodes: Array.from(fresh) });
    }
  } catch (err) {
    console.warn('mermaid render error:', err);
  }
}

// Some LLMs emit Mermaid as a single line. The parser then treats the entire
// thing as one statement and fails silently. We split it back into the
// canonical multi-line shape Mermaid expects.
//
// Rules:
//   - The source is already fenced; we only see its inner text here.
//   - We split on tokens that always start a new statement: `subgraph`, `end`,
//     a node-id followed by a node shape `[`, `(`, `{`, `((`, etc., and edge
//     operators `-->`, `-.->`, `==>`, `--`, `-.`, etc.
//   - We preserve any pre-existing newlines.
export function normaliseMermaid(src) {
  if (!src) return src;
  let text = String(src).replace(/\r\n?/g, '\n').trim();

  // If it already has multiple lines, trust it.
  const lineCount = text.split('\n').filter(l => l.trim()).length;
  if (lineCount >= 3) return text;

  // Try to detect a flowchart/graph header.
  const headerMatch = text.match(/^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey)\b\s*([A-Z]{1,2})?\s*/i);
  if (!headerMatch) return text;
  if (!/^(flowchart|graph)$/i.test(headerMatch[1])) return text; // only safe to rewrite flowcharts/graphs

  const header = headerMatch[0].trim();
  const body = text.slice(headerMatch[0].length);

  // Tokenise into atoms with a master regex. Order matters — longer operators
  // first so `-.->` doesn't get split as `--`,`-`,`>`.
  const ATOM = new RegExp([
    /\bsubgraph\b/.source,                          // keyword: subgraph
    /\bend\b/.source,                               // keyword: end
    // node with shape, e.g. EC2_1[EC2 App Tier], DB[(Multi-AZ)], U((Users))
    // Shape brackets may contain spaces.
    /[A-Za-z_][A-Za-z0-9_]*(?:\(\([^)]*\)\)|\[\([^\]]*\)\]|\[\[[^\]]*\]\]|\{\{[^}]*\}\}|\[\/[^\]]*\/\]|\[\\[^\]]*\\\]|\[[^\]]*\]|\([^)]*\)|\{[^}]*\})/.source,
    // edge operators (longest first)
    /<==>|<-->|<-\.->|-\.->|==>|-->|<--|---|--|==|<\.\.>|\.\.>|~~~/.source,
    // edge label: |…|
    /\|[^|]*\|/.source,
    // bare identifier
    /[A-Za-z_][A-Za-z0-9_]*/.source,
    // anything else (single char) — preserved verbatim
    /[^\s]/.source,
  ].join('|'), 'g');

  const tokens = [];
  let m;
  while ((m = ATOM.exec(body)) !== null) tokens.push(m[0]);

  const isKeyword = (t) => /^(subgraph|end)$/i.test(t);
  const isEdgeOp  = (t) => /^(<==>|<-->|<-\.->|-\.->|==>|-->|<--|---|--|==|<\.\.>|\.\.>|~~~)$/.test(t);
  const isLabel   = (t) => /^\|[^|]*\|$/.test(t);
  const isNode    = (t) => /^[A-Za-z_][A-Za-z0-9_]*(?:\(\(.*\)\)|\[\(.*\)\]|\[\[.*\]\]|\{\{.*\}\}|\[\/.*\/\]|\[\\.*\\\]|\[.*\]|\(.*\)|\{.*\})?$/.test(t);

  const out = [header];
  let depth = 0;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    if (/^subgraph$/i.test(t)) {
      // Consume the title (next 1 token, possibly with bracket label) and emit.
      let line = 'subgraph';
      if (i + 1 < tokens.length && !isKeyword(tokens[i + 1])) {
        line += ' ' + tokens[i + 1];
        i++;
      }
      out.push('  '.repeat(depth) + line);
      depth++;
      i++;
      continue;
    }
    if (/^end$/i.test(t)) {
      depth = Math.max(0, depth - 1);
      out.push('  '.repeat(depth) + 'end');
      i++;
      continue;
    }

    if (isNode(t)) {
      // Greedily consume an edge chain: NODE (OP LABEL? NODE)+
      const parts = [t];
      i++;
      while (i < tokens.length && isEdgeOp(tokens[i])) {
        parts.push(tokens[i]); i++;
        if (i < tokens.length && isLabel(tokens[i])) { parts.push(tokens[i]); i++; }
        if (i < tokens.length && isNode(tokens[i])) { parts.push(tokens[i]); i++; }
        else break;
      }
      out.push('  '.repeat(depth) + parts.join(' '));
      continue;
    }

    // Anything else (style directives, classDef, etc.) — emit as-is.
    out.push('  '.repeat(depth) + t);
    i++;
  }

  return out.join('\n');
}
