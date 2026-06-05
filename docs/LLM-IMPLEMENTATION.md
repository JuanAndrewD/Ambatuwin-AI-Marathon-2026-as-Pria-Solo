# LLM Implementation, Pipeline & Models

_Technical reference for the Cloud Infrastructure Architect's AI layer._  
_Source files: `lib/chutes.js`, `lib/architect.js`._

---

## Table of contents

1. [Overview](#overview)
2. [Provider: Chutes](#provider-chutes)
3. [LLM client (`lib/chutes.js`)](#llm-client-libchutesjs)
   - [Streaming transport](#streaming-transport)
   - [Inactivity timeout & retry](#inactivity-timeout--retry)
   - [SSE stream parsing](#sse-stream-parsing)
   - [JSON extraction](#json-extraction)
4. [Orchestrator (`lib/architect.js`)](#orchestrator-libarchitectjs)
5. [Pipeline 1 — Design (plan generation)](#pipeline-1--design-plan-generation)
   - [Combined prompt: DESIGN_SYSTEM](#combined-prompt-design_system)
   - [Deterministic guardrails](#deterministic-guardrails)
   - [Output: the deployment plan](#output-the-deployment-plan)
6. [Pipeline 2 — Conversational chat](#pipeline-2--conversational-chat)
   - [System prompt composition](#system-prompt-composition)
   - [Memory tiers](#memory-tiers)
   - [Attachment inlining](#attachment-inlining)
   - [Document reference resolution](#document-reference-resolution)
7. [Pipeline 3 — Draft Brief from chat](#pipeline-3--draft-brief-from-chat)
8. [Pipeline 4 — Refine Brief from editor](#pipeline-4--refine-brief-from-editor)
9. [Pipeline 5 — Quick Spec](#pipeline-5--quick-spec)
10. [Models](#models)
    - [Default model](#default-model)
    - [Supported models](#supported-models)
    - [Switching models](#switching-models)
11. [Prompt engineering decisions](#prompt-engineering-decisions)
12. [Failure modes & mitigations](#failure-modes--mitigations)
13. [Configuration reference](#configuration-reference)

---

## Overview

The system uses a **single LLM provider** (Chutes), **no agent framework**, **no tool calling**, and **no vector database**. Each backend operation is a focused single-pass (or single-stream) call with a tightly-scoped system prompt and a strictly-typed JSON or markdown response.

The LLM is responsible for two things only:

1. **Understanding natural language** — parsing a free-form requirements brief or conversation turn into structured data.
2. **Generating prose** — writing the architecture rationale, deployment plan narrative, compliance commentary, and recommendations.

Everything that must be **reproducible** — pricing, regional service availability, compliance verdicts — is handled entirely by deterministic Node.js code reading `data/aws-catalog.json`. The LLM never sees a price and never makes arithmetic claims.

```
User input (brief / chat / notes)
         │
         ▼
   lib/chutes.js          ←── Chutes API (streamed SSE)
   chat(messages, opts)        https://llm.chutes.ai/v1/chat/completions
         │
         ▼
   lib/architect.js
   ┌─ design()            ─── structured JSON (profile + architecture)
   ├─ chatTurn()          ─── markdown (with optional Mermaid)
   ├─ draftBriefFromHistory() ─ structured markdown brief
   ├─ refineBriefFromText()  ─ structured markdown brief
   └─ quickSpec()         ─── three-section markdown spec
         │
         ▼  (design only)
   Deterministic guardrails (lib/catalog.js)
   validateAndPrice() + checkCompliance()
         │
         ▼
   Markdown deployment plan / chat turn / document
```

---

## Provider: Chutes

[Chutes](https://chutes.ai) hosts open-weight models behind an
**OpenAI-compatible** `/v1/chat/completions` endpoint:

```
POST https://llm.chutes.ai/v1/chat/completions
Authorization: Bearer <Chutes_api_key>
Content-Type: application/json
```

The request/response shape is identical to OpenAI's chat completions API, so
the same client code works with any Chutes model by changing the `model` field.
Chutes wraps each model in a **TEE (Trusted Execution Environment)** for
privacy attestation.

The API key is read from `process.env.Chutes_api_key` (or the fallback
`CHUTES_API_KEY`). A warning is printed at boot if neither is set.

---

## LLM client (`lib/chutes.js`)

All LLM calls in the system funnel through a single `chat(messages, opts)`
function. This gives one place to own retries, timeouts, content extraction,
and streaming.

### Streaming transport

All requests use `stream: true`. This is non-negotiable for a practical reason:
plan generation can take **10 or more minutes** on busy shared infrastructure.
With a non-streamed request (`stream: false`) the HTTP response headers don't
arrive until the entire generation finishes, which trips Node/undici's internal
`headersTimeout` (~5 min) and any `AbortController` deadline.

Streaming solves this: **headers arrive immediately** and tokens flow
continuously. The client can gate on inactivity rather than total elapsed time,
so a 15-minute generation is treated no differently than a 15-second one.

### Inactivity timeout & retry

```
STREAM_INACTIVITY_MS = 180_000  (3 minutes of silence → abort)
MAX_ATTEMPTS         = 4
```

An `AbortController` is armed when the request starts. Every time a chunk
arrives from the stream, `armInactivity()` resets the timer to 3 minutes from
now. The request is only aborted if **no data arrives for 3 consecutive
minutes** — not after a fixed total duration.

On failure, the retry policy distinguishes:

| Condition | Action |
|---|---|
| HTTP 429 | Retry with backoff; honour `Retry-After` header if present |
| HTTP 5xx | Retry with backoff |
| `AbortError` / undici timeout codes | Retry with backoff (transient) |
| Network error (ECONNRESET, ETIMEDOUT, EAI_AGAIN) | Retry with backoff |
| HTTP 4xx (except 429) | Fail immediately — retrying won't help |
| Exhausted all 4 attempts | Throw the last error |

Backoff timing: `min(1000 × 2^(attempt−1), 16000) + jitter(0–500ms)` →
approximately 1 s, 2 s, 4 s, 8 s between attempts.

### SSE stream parsing

Chutes returns a standard **Server-Sent Events** stream. The parser in
`consumeStream()` handles:

- Events **split across TCP chunks** — a partial `data:` line is held in a
  rolling buffer until a newline arrives.
- **Keep-alive comments** (`:` lines) — silently ignored.
- **`[DONE]`** sentinel — terminates parsing and flushes the buffer.
- **Reasoning models** (e.g. GLM TEE, Kimi K2) — these emit `reasoning_content`
  or `reasoning` fields instead of (or before) `content`. The parser
  accumulates both and returns `content || reasoning`, so reasoning-model output
  is transparent to the rest of the system.
- **Multibyte UTF-8** — `TextDecoder` is used with `{ stream: true }` so
  characters that span chunk boundaries are decoded correctly.

### JSON extraction

After any pipeline that expects JSON output, `extractJSON(text)` strips the
model's prose wrapper before parsing:

1. Looks for a ` ```json ... ``` ` fenced block and extracts its content.
2. If no fence, finds the first `{` in the text.
3. Scans forward counting bracket depth (respecting strings and escape
   sequences) to find the matching `}`.
4. `JSON.parse`s the extracted substring.

This tolerates preamble prose ("Here is the JSON you requested:"), trailing
commentary, and the reasoning chain that some models prepend before the
actual answer.

---

## Orchestrator (`lib/architect.js`)

The orchestrator owns all prompt templates, pipeline logic, and the
deterministic post-processing layer. It is the only file that calls
`chutes.chat()`.

Five public functions are exported:

| Function | Pipeline | Output |
|---|---|---|
| `design()` | Combined profile + architecture (1 LLM call) | JSON → validated, priced, markdown |
| `chatTurn()` | Conversational architect | Markdown (Mermaid optional) |
| `draftBriefFromHistory()` | Synthesise brief from chat | Structured markdown |
| `refineBriefFromText()` | Rewrite editor notes → brief | Structured markdown |
| `quickSpec()` | Requirements → Design → Tasks | Three-section markdown |

---

## Pipeline 1 — Design (plan generation)

**Triggered by:** Studio → Generate plan  
**Route:** `POST /api/projects/:id/design`  
**LLM calls:** 1  
**Temperature:** 0.2  
**Max tokens:** 16 384

### Why a single combined call

Originally the pipeline made two sequential calls: one for the workload
profile (temperature 0.1, 4 096 tokens) and a second for the architecture
(temperature 0.2, 16 384 tokens). This was changed to a **single combined
call** for two reasons:

1. **Latency** — one fewer round trip to Chutes cuts the generation time nearly
   in half, ignoring queue waits.
2. **Queue waits** — on shared LLM infrastructure a second call means a second
   position in the provider's queue. Removing it is the biggest practical
   time-saving on a busy cluster.

All downstream guardrails are unchanged.

### Combined prompt: DESIGN_SYSTEM

`DESIGN_SYSTEM` is composed at call time by concatenating `PROFILE_SYSTEM` and
`ARCH_SYSTEM` with a bridging instruction:

```
[PROFILE_SYSTEM — extract workload profile as JSON]

THEN, using that same profile, design a production-grade architecture.

[ARCH_SYSTEM — design architecture as JSON]

OUTPUT FORMAT — reply with a SINGLE JSON object only:
{
  "profile": { ...workload profile schema... },
  "architecture": { ...architecture schema... }
}
```

**PROFILE_SYSTEM** instructs the model to extract:

| Field | Type | Notes |
|---|---|---|
| `summary` | string | One-sentence executive summary |
| `workload_type` | enum | `web\|api\|mobile-backend\|data-pipeline\|ml\|ecommerce\|saas\|streaming\|iot\|enterprise-app\|other` |
| `expected_users` | integer | Total expected user base |
| `concurrent_users_peak` | integer | Peak simultaneous users |
| `primary_country` | enum | `MY\|SG\|ID\|TH\|PH\|VN\|JP\|IN\|US\|EU\|other` |
| `high_availability_required` | boolean | |
| `auto_failover_required` | boolean | |
| `compliance` | string[] | From a strict enum (see below) |
| `estimated_storage_gb` | integer | |
| `estimated_egress_gb_per_month` | integer | |
| `estimated_db_size_gb` | integer | |
| `budget_usd_per_month` | integer\|null | |
| `notes` | string | Free-form extras |

Compliance inference is also specified in the prompt so the model infers
frameworks from geography even when the brief doesn't name them explicitly
(e.g., mentioning "Malaysian users" implies `PDPA-MY`).

**ARCH_SYSTEM** instructs the model to produce:

| Field | Type | Notes |
|---|---|---|
| `architecture_name` | string | Short name |
| `tier_breakdown` | string[] | `edge\|app\|data\|ops` |
| `components[]` | object[] | See schema below |
| `diagram_edges[]` | object[] | `{ from, to, label }` |
| `high_availability_strategy` | string | 1–2 sentences |
| `scaling_strategy` | string | 1–2 sentences |
| `security_posture` | string | 1–2 sentences |
| `assumptions` | string[] | Bullet list |

Each component:

```json
{
  "id": "kebab-case-id",
  "service": "<one of the allowed services, exact spelling>",
  "role": "what this component does in the system",
  "tier": "edge|app|data|ops",
  "config": { /* service-typed config keys */ },
  "rationale": "1-2 sentences why this component, this size"
}
```

The prompt enumerates the exact `config` keys for all 31 supported services so
the model fills them correctly without guessing. The model is also given the
target region and the project's enabled service list as hard constraints.

Hard rules injected into the prompt:
- Always include at least one edge component (CloudFront, ALB, or Route53).
- If `high_availability_required`: RDS `multi_az=true`, EC2/ALB `count≥2`, NATGateway `count≥2`.
- Prefer RDS or DynamoDB for stateful workloads over storing on EC2.
- If any data-residency compliance framework is required, no multi-region replication outside listed countries.
- Match instance sizes to actual user counts (cost-conscious).

### Deterministic guardrails

After the LLM responds, `validateAndPrice()` runs entirely in Node.js with no
further LLM calls:

1. **Service allowlist** — any component using a service not in the project's
   enabled set is silently dropped and logged as an issue.
2. **Regional availability** — if a service isn't natively available in the
   target region, `suggestRegionFallback()` picks the closest valid region by
   latency table. The substitution is recorded as a validation issue in the
   output.
3. **Per-component pricing** — each component is priced by a typed function
   (`priceEC2`, `priceRDS`, `priceFargate`, etc.) reading
   `data/aws-catalog.json`. The LLM never sees a price.
4. **Compliance check** — `checkCompliance()` cross-references the requested
   frameworks against the region's `data_residency` attestation array.

Running the same brief through twice always produces the same total to the cent.

### Output: the deployment plan

`buildMarkdown()` assembles a structured `.md` document from the validated
results:

| Section | Content |
|---|---|
| 1. Executive Summary | `profile.summary`, original brief (quoted) |
| 2. Workload Profile | Extracted profile fields as a table |
| 3. Architecture Diagram | Mermaid `flowchart LR` generated by `buildMermaid()`, colour-coded by tier |
| 4. Component Inventory | All priced components with config, specs, effective region |
| 5. Itemized Monthly Bill | Per-service line items, total, budget delta if applicable |
| 6. Data Residency & Compliance Check | Pass/fail per framework |
| 7. Resilience & Scaling | HA strategy, scaling strategy, security posture |
| 8. Validation Notes | Any service substitutions or drops |
| 9. Assumptions | From `arch.assumptions` |
| 10. Recommended Next Steps | Fixed five-step checklist |

The plan is then **persisted as an assistant chat message** (`meta.kind: 'plan-document'`), displayed in chat with a "Deployment plan" label and an accent border, and the UI scrolls to its top automatically.

---

## Pipeline 2 — Conversational chat

**Triggered by:** Chat input → Send  
**Route:** `POST /api/projects/:id/chat`  
**LLM calls:** 1  
**Temperature:** 0.4  
**Max tokens:** 4 096

### System prompt composition

`CHAT_SYSTEM` is built fresh on every turn by composing four blocks in order:

```
[Core persona + behaviour rules]
[In-context project documents]
[Last generated plan summary]
[Catalog snapshot: regions + services + compliance frameworks]
```

### Memory tiers

| Tier | What it is | How it's included |
|---|---|---|
| **Project metadata** | Name, region, enabled services, whether a plan exists | Hardcoded into `CHAT_SYSTEM` |
| **In-context documents** | Docs the user toggled "in context" + `#docname` references | Injected into system prompt, capped at 8 000 chars per doc |
| **Last plan summary** | Architecture name, component table with prices, compliance verdict, region | Injected as a compact text block from `summarisePlan()` |
| **Catalog snapshot** | All regions (with attestations), all allowed services, compliance frameworks | Appended to system prompt as compact JSON |
| **Conversation history** | Last 20 messages (10 user/assistant exchanges) | Prepended to the `messages` array |
| **Current turn** | User message + inlined attachment blocks | Final `user` message |

The history window is bounded at 20 messages to stay under the model's context
limit even after long sessions.

### Attachment inlining

Attachments (PDF/DOCX/PPTX/text extracted in-browser) are concatenated into the
user turn as labelled fenced blocks:

```
<<< FILE: report.pdf (45231 bytes) >>>
[extracted text content, capped at 120 000 chars per file]
<<< END FILE: report.pdf >>>
```

Caps: 120 KB per file, 360 KB total (~90 K tokens). Attachment contents are
**not persisted** — they live in the request body for one LLM call, then discarded.

### Document reference resolution

`findReferencedDocs()` parses `#token` patterns in the user message (Kiro-style
`#File` references) and resolves them to project documents by case-insensitive
name matching with `.md` stripped and spaces converted to dashes. Matched docs
are injected into the system prompt alongside any docs already marked "in context".

---

## Pipeline 3 — Draft Brief from chat

**Triggered by:** Docs → Draft brief from chat  
**Route:** `POST /api/projects/:id/draft-brief`  
**LLM calls:** 1  
**Temperature:** 0.2  
**Max tokens:** 4 096

`BRIEF_SYSTEM` instructs the model to act as a senior Solutions Architect
synthesising a Requirements Brief from a conversation transcript. The output
has fixed sections:

- Overview
- Workload Profile
- Functional Requirements
- Non-Functional Requirements
- Constraints
- Open Questions

The last 40 turns of chat history are passed as the transcript. The model is
instructed not to invent constraints the client never mentioned, and to write
`_(none specified)_` rather than hallucinate content for empty sections.

---

## Pipeline 4 — Refine Brief from editor

**Triggered by:** Document editor → AI refine (brief documents only)  
**Route:** `POST /api/projects/:id/refine-brief`  
**LLM calls:** 1  
**Temperature:** 0.2  
**Max tokens:** 4 096

Uses the same `BRIEF_SYSTEM` prompt as Draft Brief, but instead of a chat
transcript the user message contains the raw editor text (however rough or
bullet-listed). The model structures it into the standard brief format.
Instruction: _preserve every concrete detail — numbers, regions, frameworks,
budgets — that the user wrote. Do NOT invent any constraints not present in the
source._

---

## Pipeline 5 — Quick Spec

**Triggered by:** Quick Spec button  
**Route:** `POST /api/projects/:id/quick-spec`  
**LLM calls:** 1  
**Temperature:** 0.3  
**Max tokens:** 6 000

`QUICK_SPEC_SYSTEM` instructs the model to produce a **Kiro-style Quick Spec**:
a single markdown document with exactly three numbered sections:

| Section | Content |
|---|---|
| 1. Requirements | Numbered functional requirements + non-functional sub-section with concrete numbers |
| 2. Design | Architecture prose + Mermaid flowchart, grouped by tier (edge/app/data/ops), cites target region, explains tradeoffs |
| 3. Tasks | Numbered checklist of independently actionable implementation steps; includes security, monitoring, and cost-control tasks |

The system prompt is augmented at call time with the project name, region (with
country and native attestations), allowed service list, and a compact catalog
reference (service names, categories, regional availability). In-context project
documents are appended if present.

Hard rules: only use services from the project's allowed list; call out any
service not natively available in the target region.

The result is saved as a new `type: 'plan'` document in the project.

---

## Models

### Default model

```
zai-org/GLM-5.1-TEE
```

GLM-5.1-TEE was chosen after latency probing across the available Chutes
catalogue. It produces **clean fenced JSON** consistently, has a large context
window (handles the full `DESIGN_SYSTEM` prompt + 16 384 output tokens without
truncation), and runs at roughly 4 seconds for short calls. The TEE suffix
indicates it runs inside a Trusted Execution Environment.

### Supported models

All of these have been verified to work with the architect's prompts:

| Model ID | Provider | Notes |
|---|---|---|
| `zai-org/GLM-5.1-TEE` | ZAI | **Default.** Best balance of speed and JSON fidelity. ~4 s for short calls. |
| `zai-org/GLM-5-TEE` | ZAI | Slightly faster, slightly less structured. |
| `moonshotai/Kimi-K2.6-TEE` | Moonshot AI | Very capable; can prepend whitespace before JSON — handled by `extractJSON`. |
| `deepseek-ai/DeepSeek-V3.2-TEE` | DeepSeek | Strong reasoning; can be slow under load. |
| `google/gemma-4-31B-turbo-TEE` | Google | Fastest direct-JSON output (~2 s). Less strong on complex architectural reasoning. |
| `Qwen/Qwen3-235B-A22B-Thinking-2507` | Alibaba | Emits a long internal reasoning chain before content. Handled by `reasoning_content` fallback. Slow but very capable for complex designs. |

All models are accessed through the same Chutes endpoint and the same
`chat()` client — switching models requires only changing `CHUTES_MODEL` in
`.env`.

### Reasoning models

Models that emit `reasoning_content` or `reasoning` fields (Qwen Thinking,
some GLM variants) are handled transparently. The `consumeStream()` parser
accumulates both `content` and `reasoning` fields and returns
`content || reasoning` — so the rest of the system receives the final answer
regardless of which field the model used.

### Switching models

Set `CHUTES_MODEL` in `.env`:

```
CHUTES_MODEL=moonshotai/Kimi-K2.6-TEE
```

To list all models available to your key:

```bash
node -e "require('dotenv').config(); fetch('https://llm.chutes.ai/v1/models', { headers: { Authorization: 'Bearer ' + process.env.Chutes_api_key } }).then(r => r.json()).then(j => console.log(j.data.map(m => m.id).join('\n')))"
```

---

## Prompt engineering decisions

**Why no tool calling / function calling?**  
The agent's task is narrow: fill structured slots in an architecture proposal,
then generate prose. Tool-call orchestration adds latency (multiple round trips)
and a failure surface for almost no behavioural gain on this specific task. A
focused single-pass prompt with a constrained vocabulary gives reproducible JSON
we can validate deterministically.

**Why no vector DB / RAG?**  
The knowledge corpus is small and versioned: `data/aws-catalog.json` is
~100 KB. Appending the relevant subset (service names, regions, compliance
frameworks) directly in the system prompt is cheaper, faster, and more
transparent than embedding + retrieval. The model always sees the same catalog
snapshot, so outputs are reproducible.

**Why different temperatures per pipeline?**

| Pipeline | Temperature | Reason |
|---|---|---|
| Design | 0.2 | Needs consistent, parseable JSON — low temperature reduces hallucination of service names or config keys |
| Chat | 0.4 | Needs natural conversational prose — slightly higher temperature avoids robotic repetition |
| Brief / Refine | 0.2 | Needs structured, factual extraction — low temperature prevents invention |
| Quick Spec | 0.3 | Balanced — needs both structure (Requirements, Tasks) and coherent prose (Design) |

**Why is the plan inlined into chat rather than shown separately?**  
The plan markdown is the single most important deliverable. Showing it inline in
chat with a persistent message (tagged `meta.kind: 'plan-document'`) means it
survives the 4-second polling refresh, can be referenced in follow-up turns,
and the architect can answer questions like "why did you choose Fargate over
EC2?" in context. The "View plan in chat" button re-posts a fresh copy and
scrolls to its top so it's always a click away even in a long conversation.

**Compliance inference in the prompt**  
The `PROFILE_SYSTEM` prompt includes explicit inference rules that map
geographical signals (city names, country mentions) to compliance frameworks.
This is necessary because clients almost never say "we need PDPA-MY" out loud
— they say "our users are in KL". The inference rules make that explicit for
the model so the compliance check is meaningful.

---

## Failure modes & mitigations

| Failure | Symptom | Mitigation |
|---|---|---|
| Provider at capacity (429) | `Chutes API 429: Infrastructure is at maximum capacity` | Retry up to 4 times with exponential backoff (1 s, 2 s, 4 s, 8 s) |
| Stream inactivity | Request hangs silently | Abort after 3 minutes of no tokens; retry |
| Network error (ECONNRESET, etc.) | `fetch failed` | Treat as transient; retry |
| Empty content, reasoning model | `Chutes returned an empty message` | `consumeStream` falls back to `reasoning_content` → `reasoning` |
| Malformed JSON from model | `JSON parse failed` or `Unbalanced JSON braces` | `extractJSON` strips fences, preamble, and scans bracket depth — only fails if truly unparseable |
| Model emits JSON with unknown service | Component dropped silently | `validateAndPrice` whitelist check; logged as a validation issue in the plan |
| Service unavailable in target region | Incorrect pricing | `validateAndPrice` detects and falls back to nearest available region; recorded as a substitution note |
| Empty LLM response after retries | `Chutes request failed after retries` | Surfaced to the client as an error toast; the conversation history is preserved for retry |

---

## Configuration reference

| Variable | Default | Effect |
|---|---|---|
| `Chutes_api_key` | _(required)_ | Bearer token for `Authorization: Bearer …` |
| `CHUTES_API_KEY` | _(fallback)_ | Alternative env name for the key |
| `CHUTES_MODEL` | `zai-org/GLM-5.1-TEE` | Model ID passed in every request body |

Both variables are read in `lib/chutes.js` at module load time. A startup
warning is printed (not a crash) if neither is set; the first actual LLM call
will throw `Chutes_api_key is not set in .env`.

The **HTTP server and dev-proxy timeouts** are raised to 20 minutes
(`server.requestTimeout = 0`, `headersTimeout = 20 min`, Vite proxy
`timeout/proxyTimeout = 20 min`) to allow long-running design generations to
complete without being severed at the transport layer.

---

_Source: `lib/chutes.js`, `lib/architect.js` — Cloud Infrastructure Architect._
