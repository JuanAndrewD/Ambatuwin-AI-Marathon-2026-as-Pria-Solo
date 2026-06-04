// Chutes LLM client. Chutes exposes an OpenAI-compatible /v1/chat/completions
// endpoint at https://llm.chutes.ai/v1/chat/completions.

require('dotenv').config();

const CHUTES_URL = 'https://llm.chutes.ai/v1/chat/completions';
const CHUTES_KEY = process.env.Chutes_api_key || process.env.CHUTES_API_KEY;

// Default to a strong open-weight model available on Chutes. Override via env.
// Available at time of writing on Chutes: zai-org/GLM-5-TEE, GLM-5.1-TEE,
// moonshotai/Kimi-K2.6-TEE, deepseek-ai/DeepSeek-V3.2-TEE,
// google/gemma-4-31B-turbo-TEE, Qwen/Qwen3.6-27B-TEE.
// Latency probe favoured Gemma-4 (~2s) and GLM-5.1 (~4s) for direct JSON.
// We default to GLM-5.1 for a better tradeoff between speed and architectural
// reasoning ability; override with CHUTES_MODEL=... in .env.
const DEFAULT_MODEL = process.env.CHUTES_MODEL || 'zai-org/GLM-5.1-TEE';

if (!CHUTES_KEY) {
  console.warn('[chutes] No Chutes_api_key found in .env — /api/design will fail.');
}

async function chat(messages, { model = DEFAULT_MODEL, temperature = 0.2, maxTokens = 4096, jsonMode = false } = {}) {
  if (!CHUTES_KEY) throw new Error('Chutes_api_key is not set in .env');

  // We STREAM the completion (stream: true) for one critical reason: large
  // architecture designs can take 10+ minutes to generate. With a non-streamed
  // request the HTTP response headers don't arrive until the whole generation
  // is finished, which trips Node/undici's headersTimeout (~5 min) and any
  // total-duration AbortController — aborting a request that was working fine.
  // Streaming returns headers immediately and delivers tokens continuously, so
  // we can instead gate on INACTIVITY (no token for a while) rather than total
  // elapsed time.
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  };

  // Retry transient failures: 429 (provider at capacity), 5xx, and network
  // errors before the stream starts. Exponential backoff with jitter.
  const MAX_ATTEMPTS = 4;
  // Abort only if the stream produces NO data for this long. This is the gap
  // between tokens, not the total time — a 15-minute generation is fine as
  // long as tokens keep trickling in.
  const STREAM_INACTIVITY_MS = 180_000; // 3 minutes of silence
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    let inactivityTimer = null;
    const armInactivity = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => controller.abort(), STREAM_INACTIVITY_MS);
    };

    try {
      armInactivity(); // also covers time-to-first-byte
      const res = await fetch(CHUTES_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CHUTES_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`Chutes API ${res.status}: ${text.slice(0, 500)}`);
        err.status = res.status;
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
          lastErr = err;
          if (inactivityTimer) clearTimeout(inactivityTimer);
          await sleep(backoffMs(attempt, res.headers.get('retry-after')));
          continue;
        }
        throw err;
      }

      const { content, finishReason } = await consumeStream(res, armInactivity);
      if (!content) {
        throw new Error(`Chutes returned an empty message. finish_reason=${finishReason}`);
      }
      return { content, raw: { finish_reason: finishReason } };
    } catch (err) {
      const transient = err.name === 'AbortError'
        || err.code === 'UND_ERR_HEADERS_TIMEOUT'
        || err.code === 'UND_ERR_BODY_TIMEOUT'
        || /fetch failed|socket|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(err.message || '');
      if (transient && attempt < MAX_ATTEMPTS) {
        lastErr = err;
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
  }

  throw lastErr || new Error('Chutes request failed after retries');
}

// Read an OpenAI-compatible Server-Sent-Events stream, accumulating the text.
// `onActivity` is called on every chunk so the caller can reset its inactivity
// timeout. Reasoning models may stream `reasoning_content` / `reasoning`
// instead of (or before) `content`; we keep both and prefer real content.
async function consumeStream(res, onActivity) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let reasoning = '';
  let finishReason = null;

  const handlePayload = (payload) => {
    if (payload === '[DONE]') return true;
    let json;
    try { json = JSON.parse(payload); } catch { return false; }
    const choice = json?.choices?.[0];
    if (!choice) return false;
    const delta = choice.delta || choice.message || {};
    if (typeof delta.content === 'string') content += delta.content;
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content;
    if (typeof delta.reasoning === 'string') reasoning += delta.reasoning;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    return false;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by newlines; each data line starts with "data:".
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line || line.startsWith(':')) continue; // blank / comment keep-alive
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (handlePayload(payload)) { buffer = ''; break; }
      }
    }
  }
  // Flush any trailing buffered line.
  const tail = buffer.trim();
  if (tail.startsWith('data:')) handlePayload(tail.slice(5).trim());

  return { content: content || reasoning, finishReason };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Exponential backoff with jitter. Honours a server-provided Retry-After
// header (seconds) when present.
function backoffMs(attempt, retryAfter) {
  const ra = Number(retryAfter);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 30_000);
  const base = Math.min(1000 * 2 ** (attempt - 1), 16_000); // 1s, 2s, 4s, 8s…
  return base + Math.floor(Math.random() * 500);
}

// Robust JSON extractor: handles ```json fences, stray prose, and reasoning
// models that prepend whitespace or comments before the actual JSON.
function extractJSON(text) {
  if (!text) throw new Error('Empty LLM response');
  // 1. Try to extract from a ```json ... ``` fenced block first.
  const fenced = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  let candidate = fenced ? fenced[1] : text;
  // 2. Strip leading/trailing prose. Find the first { and the matching } by
  //    scanning brackets so we don't accidentally cut at a nested closer.
  const first = candidate.indexOf('{');
  if (first === -1) throw new Error(`No JSON object in LLM response. First 200 chars: ${text.slice(0, 200)}`);
  let depth = 0, end = -1, inString = false, escape = false;
  for (let i = first; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error(`Unbalanced JSON braces. First 200 chars: ${text.slice(0, 200)}`);
  const raw = candidate.slice(first, end + 1);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`JSON parse failed (${err.message}). Extracted: ${raw.slice(0, 300)}`);
  }
}

module.exports = { chat, extractJSON, DEFAULT_MODEL };
