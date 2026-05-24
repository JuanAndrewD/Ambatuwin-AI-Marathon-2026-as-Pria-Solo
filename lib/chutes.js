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

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  // Note: We deliberately do NOT set response_format here. Not every model on
  // Chutes supports it, and we already do robust JSON extraction client-side.

  const res = await fetch(CHUTES_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CHUTES_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chutes API ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  // Reasoning models (e.g. Qwen Thinking, GLM TEE) may return content=null and
  // put the actual answer in `reasoning_content` or `reasoning`. Try all.
  const content = msg.content || msg.reasoning_content || msg.reasoning || '';
  if (!content) {
    throw new Error(`Chutes returned an empty message. finish_reason=${data?.choices?.[0]?.finish_reason}`);
  }
  return { content, raw: data };
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
