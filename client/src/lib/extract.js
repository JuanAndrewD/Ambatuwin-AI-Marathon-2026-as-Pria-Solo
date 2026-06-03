// Document text extraction for chat attachments.
//
// The chat pipeline (chat → spec → GitHub) only ever works with *text*. So the
// job here is to turn any supported document — including binary/unstructured
// formats like PDF, DOCX and PPTX, or a raw chat transcript — into a single
// UTF-8 string that we can hand to the architect verbatim.
//
// Everything runs in the browser so the backend transport stays plain JSON and
// no binary ever has to be uploaded. PDFs use pdf.js; DOCX/PPTX are just ZIP
// containers of XML, which we read with JSZip (already a client dependency).

import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

// 50 MB per file — comfortably under GitHub's 50 MB warning / 100 MB hard
// block, and large enough for sizeable transcripts and slide decks.
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 120 * 1024 * 1024; // combined across one message
export const MAX_FILES = 5;

// Plain-text-ish formats we can read directly with File.text().
const TEXT_EXT = [
  '.md', '.markdown', '.txt', '.text', '.json', '.yaml', '.yml', '.csv', '.tsv',
  '.log', '.tf', '.hcl', '.toml', '.ini', '.env.example', '.xml', '.html', '.htm',
  '.rtf',
];

// Rich/unstructured documents we extract text from.
const PDF_EXT = ['.pdf'];
const DOCX_EXT = ['.docx'];
const PPTX_EXT = ['.pptx'];

// All extensions the attach control should advertise + accept.
export const ALLOWED_EXT = [
  ...TEXT_EXT, ...PDF_EXT, ...DOCX_EXT, ...PPTX_EXT,
];

// A short, human-friendly subset for hints/placeholders.
export const HINT_EXT = ['.pdf', '.docx', '.pptx', '.md', '.txt', '.csv', '.json'];

function lower(name) { return String(name || '').toLowerCase(); }

export function isAllowed(name) {
  const l = lower(name);
  return ALLOWED_EXT.some(ext => l.endsWith(ext));
}

function kindOf(name) {
  const l = lower(name);
  if (PDF_EXT.some(e => l.endsWith(e))) return 'pdf';
  if (DOCX_EXT.some(e => l.endsWith(e))) return 'docx';
  if (PPTX_EXT.some(e => l.endsWith(e))) return 'pptx';
  return 'text';
}

// Collapse runs of blank lines/whitespace so extracted text stays compact.
function tidy(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---- PDF -------------------------------------------------------------------
async function extractPdf(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const parts = [];
  const maxPages = Math.min(pdf.numPages, 500); // safety cap on huge files
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Reconstruct lines from positioned text items.
    let line = '';
    let lastY = null;
    const lines = [];
    for (const item of content.items) {
      const str = item.str || '';
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = '';
      }
      line += str;
      if (item.hasEOL) { lines.push(line); line = ''; }
      lastY = y;
    }
    if (line) lines.push(line);
    parts.push(lines.join('\n'));
    page.cleanup();
  }
  if (pdf.numPages > maxPages) parts.push(`\n[truncated: ${pdf.numPages - maxPages} more pages not extracted]`);
  return tidy(parts.join('\n\n'));
}

// Pull the inner text of all matching XML tags, in document order.
function tagText(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'));
  }
  return out;
}

// ---- DOCX (Office Open XML, a ZIP of XML) ----------------------------------
async function extractDocx(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('not a valid .docx (missing word/document.xml)');
  let xml = await doc.async('string');
  // Mark paragraph + line breaks before we strip tags so structure survives.
  xml = xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<w:tab\b[^>]*\/?>/g, '\t');
  const runs = tagText(xml, 'w:t');
  // tagText drops text outside <w:t>; rebuild by reading <w:t> in order but
  // keep the paragraph newlines we injected by also scanning sequentially.
  const text = sequentialText(xml, 'w:t');
  return tidy(text || runs.join(''));
}

// Walk the XML once, emitting tag text and preserving any literal newlines/tabs
// that we injected for structure.
function sequentialText(xml, tag) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let out = '';
  let i = 0;
  while (i < xml.length) {
    const start = xml.indexOf(open, i);
    if (start === -1) { out += xml.slice(i).replace(/<[^>]+>/g, ''); break; }
    // Text/newlines between previous position and this tag (keep newlines/tabs).
    out += xml.slice(i, start).replace(/<[^>]+>/g, '');
    const gt = xml.indexOf('>', start);
    if (gt === -1) break;
    const end = xml.indexOf(close, gt);
    if (end === -1) { i = gt + 1; continue; }
    out += xml.slice(gt + 1, end)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
    i = end + close.length;
  }
  return out;
}

// ---- PPTX (slide deck, a ZIP of per-slide XML) -----------------------------
async function extractPptx(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);
      return na - nb;
    });
  if (!slideFiles.length) throw new Error('not a valid .pptx (no slides found)');
  const parts = [];
  let n = 1;
  for (const name of slideFiles) {
    let xml = await zip.file(name).async('string');
    xml = xml.replace(/<\/a:p>/g, '\n').replace(/<a:br\b[^>]*\/?>/g, '\n');
    const runs = tagText(xml, 'a:t');
    const body = tidy(runs.join('\n'));
    parts.push(`# Slide ${n}\n${body}`);
    n++;
  }
  return tidy(parts.join('\n\n'));
}

// ---- public API ------------------------------------------------------------
// Returns { name, bytes, content } or throws with a friendly message.
export async function extractFile(file) {
  const kind = kindOf(file.name);
  let content;
  switch (kind) {
    case 'pdf':  content = await extractPdf(file);  break;
    case 'docx': content = await extractDocx(file); break;
    case 'pptx': content = await extractPptx(file); break;
    default:     content = tidy(await file.text());
  }
  if (!content || !content.trim()) {
    throw new Error('no extractable text found (it may be scanned/image-only)');
  }
  return { name: file.name, bytes: file.size, content };
}
