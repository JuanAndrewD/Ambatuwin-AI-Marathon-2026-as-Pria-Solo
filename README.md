# ☁️ The Cloud Infrastructure Architect

> 🌐 **Live demo:** <https://ambatuwin-ai-marathon-2026-as-pria-solo.onrender.com/>
>
> Deployed on Render (free tier — first request after idle takes ~30 s to
> wake). Powered by Chutes LLM. State persists between requests on the same
> instance; full reset on redeploy.

An **Autonomous Technical Sales Consultant** website that takes a high-level
requirements brief and autonomously navigates a real AWS catalog to design a
complete, valid, and quoted enterprise deployment.

Built for the **AI Marathon 2026 — Autonomous Sales Engineer** problem
statement. The agent parses workloads in natural language, picks regions for
data residency and latency, validates regional service availability, computes
a deterministic monthly bill from a versioned local catalog, and ships a
polished `.md` deliverable with a Mermaid architecture diagram and a
PDPA / GDPR / HIPAA compliance check.

LLM inference is provided by **Chutes** (`https://llm.chutes.ai`). Pricing is
computed locally so the bill is reproducible from the same input — the LLM
never sees a price.

---

## Table of contents

1. [Tour](#tour)
2. [Stack](#stack)
3. [Architecture](#architecture)
4. [Project layout](#project-layout)
5. [Quick start](#quick-start)
6. [Build from scratch](#build-from-scratch)
7. [Development workflow](#development-workflow)
8. [Configuration (.env)](#configuration-env)
9. [Choosing a Chutes model](#choosing-a-chutes-model)
10. [REST API](#rest-api)
11. [Supported AWS regions and services](#supported-aws-regions-and-services)
12. [Compliance frameworks](#compliance-frameworks)
13. [How the deterministic bill works](#how-the-deterministic-bill-works)
14. [Smoke tests](#smoke-tests)
15. [Troubleshooting](#troubleshooting)
16. [Updating the catalog](#updating-the-catalog)

---

## Tour

| Route | What it is |
|---|---|
| `#/` | **Landing page** — Anthropic-style hero, GridMotion grid background, BorderGlow feature cards, SpotlightCard service grid, magnetic CTAs |
| `#/services` | **Service library** — every AWS service grouped by category with search |
| `#/services/:name` | **Service detail page** — purpose, when to use, sample Terraform, common pitfalls, live regional pricing |
| `#/app` | **Workspace** — three-pane (Projects / Docs / Resources · Chat · Studio) |

### Workspace highlights

- **Projects** — name, organise, and switch between architecture engagements. Each project tracks its own brief, region, allowed services, chat history, generated plans, and document set.
- **Docs** — every project has a pinned **Requirements brief** and any number of additional markdown / Terraform / notes files. Toggle the "eye" on each doc to inject it into chat context. Reference docs in chat with `#docname` (Kiro-style `#File`).
- **Resources** — every AWS service is a togglable source. The architect is locked to the enabled subset.
- **Chat** — file uploads (drag-and-drop or click), per-IP rate limiting, attachments persisted as metadata only, optimistic UI, scroll-to-bottom FAB.
- **Studio** — six one-click actions backed by Chutes: Generate plan, Architecture diagram, Itemized bill, Compliance audit, Terraform skeleton, Sales proposal. Animated KPIs (monthly bill, components, region, compliance pass rate). One-click `.zip` export.
- **Quick Spec** — Kiro-style "Requirements → Design → Tasks" generator. Saved as a new doc in the project.
- **In-browser code editor** — line-numbered gutter, Ctrl/Cmd+S, Tab/Shift+Tab indent, list continuation on Enter, three view modes (Edit / Split / Preview), debounced auto-save, AI refine button on the brief.
- **Auto-sync** — the workspace polls the active project every 4 s, refreshes on tab focus, and splices new server-created docs into local state instantly. No manual reload required.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js ≥ 18, Express |
| LLM | [Chutes](https://chutes.ai) `/v1/chat/completions` |
| Default model | `zai-org/GLM-5.1-TEE` (override with `CHUTES_MODEL`) |
| Frontend | React 18, Vite 5, lucide-react, framer-motion |
| Markdown | [marked](https://marked.js.org) |
| Diagrams | [Mermaid](https://mermaid.js.org) (dark theme, with a deterministic single-line → multi-line normaliser) |
| Pricing | Local catalog `data/aws-catalog.json` (USD on-demand list, 730 h / month) |
| Persistence | JSON file at `data/projects.json` |

---

## Architecture

The system is a three-layer agent: **LLM** for natural-language understanding
and generation, **deterministic guardrails** for everything that must be
reproducible (pricing, region availability, compliance), and **file-backed
state** for projects, documents, and conversation history. The frontend is a
single-page React app talking to an Express REST API.

### High-level diagram

```
┌──────────────────────── React SPA (Vite, hash-routed) ────────────────────────┐
│  /            ─ Landing                /app  ─ Workspace                       │
│  /services    ─ Library                /services/:name ─ Detail                │
│                                                                                 │
│  Workspace state: ProjectsPane · ChatPane · StudioPane · DocumentEditor        │
│  Polls /api/projects/:id every 4s and on tab focus → auto-sync                 │
└──────────────┬─────────────────────────────────────────────────────────────────┘
               │  /api/...   (JSON, fetch, optional attachments + #docrefs)
               ▼
┌────────────────────────────── Express server ─────────────────────────────────┐
│                                                                                 │
│   ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐         │
│   │ projects.js      │    │  rate-limit.js   │    │ catalog-api.js   │         │
│   │ (file-backed CRUD)│    │ (sliding window) │    │ (public summary) │         │
│   └────────┬─────────┘    └──────────────────┘    └─────────┬────────┘         │
│            │                                                 │                  │
│            ▼                                                 │                  │
│   ┌──────────────────────────────────────────────────────────┴────────────┐    │
│   │                       architect.js  (orchestrator)                    │    │
│   │                                                                       │    │
│   │   ┌──────────────────┐   ┌─────────────────────┐   ┌──────────────┐   │    │
│   │   │ Profile pass     │ → │ Architecture pass   │ → │ Validate &    │   │    │
│   │   │ (Chutes JSON)    │   │ (constrained LLM)   │   │ price (det.)  │   │    │
│   │   └──────────────────┘   └─────────────────────┘   └──────┬───────┘   │    │
│   │                                                            │           │    │
│   │   chatTurn() · draftBriefFromHistory() · refineBriefFromText()         │    │
│   │   quickSpec() · findReferencedDocs()                                   │    │
│   └──────────────────────────────┬───────────────────────────────────────┘    │
│                                  │                                              │
│            ┌─────────────────────┘                                              │
│            ▼                                                                    │
│   ┌──────────────────┐               ┌──────────────────┐                      │
│   │  chutes.js       │ ───── HTTPS ──┼─► llm.chutes.ai/v1/chat/completions     │
│   │  (Bearer auth,   │               │  (open-weight models, OpenAI-shape)     │
│   │  JSON extractor) │               └──────────────────┘                      │
│   └──────────────────┘                                                          │
│                                                                                 │
│   ┌──────────────────┐               ┌──────────────────┐                      │
│   │  catalog.js      │ ◄──── reads ──┤ data/aws-catalog.json (versioned,      │
│   │  (deterministic  │               │  on-demand list, 730 h/mo)             │
│   │  pricing engine) │               └──────────────────┘                      │
│   └──────────────────┘                                                          │
│                                                                                 │
│   ┌──────────────────┐               ┌──────────────────┐                      │
│   │  projects.js     │ ◄── reads/ ───┤ data/projects.json (per-user state:    │
│   │  (CRUD, append-  │     writes    │  projects, chat, docs, last_plan)      │
│   │  only chat log)  │               └──────────────────┘                      │
│   └──────────────────┘                                                          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### LLM architecture (Chutes)

Chutes hosts open-weight models behind an OpenAI-compatible
`/v1/chat/completions` endpoint. The architect uses **one provider, multiple
prompt strategies** — there is no agent framework, no tool calling, no vector
DB. Each backend operation is a single round-trip with a tightly-scoped
system prompt and a strictly-typed response.

**Why this shape?** Because the agent's job is not generic reasoning — it's
to fill structured slots in an architecture proposal. A focused single-pass
prompt with a constrained vocabulary gives reproducible JSON we can validate
deterministically. Tool-call orchestration would add latency and a failure
surface for almost no behavioural gain.

#### The five prompt strategies

| Function in `lib/architect.js` | Purpose | Output shape |
|---|---|---|
| `design()` | Two-pass plan generator: profile → architecture | Validated JSON, pipelined into pricing |
| `chatTurn()` | Conversational architect with full project context | Markdown with optional Mermaid blocks |
| `draftBriefFromHistory()` | Synthesise a Requirements Brief from chat | Structured markdown brief |
| `refineBriefFromText()` | Rewrite raw editor notes into a brief | Structured markdown brief |
| `quickSpec()` | Kiro-style Requirements → Design → Tasks | Three-section markdown spec |

#### The two-pass design pipeline

`design()` deliberately splits planning into two LLM calls so each one is
small, fast, and cheap to retry:

1. **Profile extraction** — temperature 0.1, max 4096 tokens. The LLM reads
   the brief and emits a typed JSON workload profile (workload type, expected
   users, region, compliance requirements, budget, storage estimates). This
   is the only place where free-form natural language becomes structure.
2. **Architecture proposal** — temperature 0.2, max 16 384 tokens. The LLM
   receives the profile **and** a constrained service vocabulary (only the
   services the project has enabled in the Resources panel). It emits a JSON
   list of components with `service`, `id`, `tier`, `config` (service-typed),
   `rationale`, and a `diagram_edges` array. The system prompt enumerates the
   valid `config` shape per service so the model doesn't have to guess.

Both calls go through `chutes.js` which:

- Reads `Chutes_api_key` and optional `CHUTES_MODEL` from `.env`.
- Sends an OpenAI-shape `/v1/chat/completions` request with `Authorization: Bearer …`.
- Falls back through `message.content` → `reasoning_content` → `reasoning`
  (some Chutes "Thinking" models put the answer in alternate fields).
- Runs a robust JSON extractor that strips ` ```json ` fences, prose
  preambles, and unbalanced braces by counting bracket depth, so a stray
  paragraph from the model doesn't break parsing.

#### Conversational chat memory

`chatTurn()` builds the system prompt from four memory tiers, in this order:

1. **Project metadata** — name, region, allowed services, whether a plan exists.
2. **In-context documents** — every document the user toggled "in context" PLUS
   any document referenced inline as `#docname` (Kiro-style `#File`
   resolution, capped at 8 KB per doc).
3. **Last generated plan summary** — architecture name, component table with
   prices, compliance verdict, and region. Cheap to include and keeps the
   architect grounded after the deterministic step has run.
4. **Catalog snapshot** — every region (with attestations), every allowed
   service, and the compliance frameworks JSON.

Then it appends a rolling **20-message history window** (last 10 user/assistant
exchanges) and the new user turn. The window is bounded so prompts stay under
the model's context limit even after long sessions.

The brief and any other markdown the user wrote in the editor flow through
the **same** in-context-document pipe, so the LLM treats user-authored
documents as authoritative project context, not as untrusted attachments.

### Deterministic guardrails (`lib/catalog.js`)

The LLM never sees a price. After the architecture proposal arrives,
`validateAndPrice()` walks each component:

1. **Service whitelist** — drop anything the project doesn't have enabled
   (the Resources panel toggles).
2. **Region availability** — if the proposed service isn't natively in the
   target region, call `suggestRegionFallback()` to pick the closest valid
   region by latency table; record the substitution as an issue.
3. **Per-component pricing** — call the typed pricer (`priceEC2`, `priceRDS`,
   `priceFargate`, etc.). Each pricer reads `data/aws-catalog.json` and
   computes `monthly_usd` from the configured `instance_type`, `count`,
   `storage_gb`, etc.
4. **Compliance check** — `checkCompliance()` cross-references the requested
   frameworks against the region's `data_residency` array.

The result is a `priced.items[]` array with deterministic numbers. Run the
same brief through twice and you get the same total to the cent.

### Personalised directory: file-backed persistence

There is no SQL. State lives in two JSON files under `data/`:

| File | Purpose | Owner |
|---|---|---|
| `data/aws-catalog.json` | Service catalog: regions, services, instance types, prices, compliance frameworks. **Read-only** at runtime; updated by hand when AWS publishes new pricing. | Repo author |
| `data/projects.json` | All user state: projects, documents, chat history, last generated plan. Auto-created on first project; auto-saved on every mutation. | The running app |

#### Why file-backed?

- Zero ops for a single-user demo: no database server to install, no
  credentials, no backup story.
- The whole state can be inspected and grepped with a text editor.
- The shape is JSON, so importing into PostgreSQL/SQLite later is a
  one-time migration, not an architecture rewrite.

`lib/projects.js` is the only module that touches `data/projects.json`.
Every mutation (`createProject`, `updateProject`, `appendChat`,
`createDocument`, `updateDocument`, `deleteDocument`) re-reads the file,
mutates the in-memory tree, then writes the whole thing back via
`fs.writeFileSync`. This is intentionally crude and safe for the demo's
write volume; if you need concurrent users, swap this module for a real
database — the public API stays the same.

#### Project shape

```json
{
  "projects": [
    {
      "id": "p_a1b2c3d4e5f6",
      "name": "Fintech savings app — KL launch",
      "region": "ap-southeast-5",
      "brief": "…",                    // mirror of the brief document's content
      "enabled_services": ["EC2", "RDS", "S3", "ALB", "..."],
      "chat": [
        { "role": "user", "content": "…", "ts": "2026-...",
          "attachments": [{ "name": "spec.md", "bytes": 1234 }] },
        { "role": "assistant", "content": "…", "ts": "2026-...",
          "model": "zai-org/GLM-5.1-TEE" }
      ],
      "documents": [
        {
          "id": "d_xxxxxxxx",
          "type": "brief",              // brief | plan | terraform | proposal | notes
          "name": "Requirements brief",
          "content": "# Requirements Brief\n…",
          "included_in_context": true,  // injected into every chat turn
          "pinned": true,                // brief is pinned and undeletable
          "created_at": "…",
          "updated_at": "…"
        }
      ],
      "last_plan": {                    // result of /api/projects/:id/design
        "profile": { … },
        "arch":    { … },
        "priced":  { "items": [...], "issues": [...], "total": 1418.87 },
        "compliance": { "ok": true, "passes": [...], "issues": [] },
        "region": { "code": "ap-southeast-5", "name": "...", "country": "..." },
        "markdown": "# ☁️ AWS Cloud Infrastructure Deployment Plan\n…"
      },
      "created_at": "…",
      "updated_at": "…"
    }
  ]
}
```

#### Privacy on the filesystem

- Chat **attachment contents are NOT persisted**. The user message stores
  only `{ name, bytes }` metadata; the file body lives in memory for one LLM
  call and is then discarded. This keeps the on-disk JSON free of
  potentially sensitive uploads.
- Documents the user authors in the editor **are** persisted (that's the
  whole point of the document store). Treat `data/projects.json` like a
  user's notebook.
- The `.env` file is git-ignored. The `Chutes_api_key` never leaves the
  server process.

### Frontend ↔ backend coupling

The SPA uses a thin fetch wrapper (`client/src/lib/api.js`). There's no
state-management library; React `useState` + a `mergeActiveProject` helper
handles auto-sync without clobbering the user's in-flight edits:

- **Polling** — every 4 s, the workspace re-fetches the active project.
- **Tab focus + visibility change** — instant catch-up sync.
- **Optimistic insert** — Quick Spec / Draft Brief / Refine actions splice
  the server's returned document straight into local state so the sidebar
  updates before the next poll lands.
- **Dirty-aware merge** — if the editor has unsaved keystrokes, the merge
  keeps the user's content; if the editor is clean, the merge adopts server
  content (so a refine performed on another tab flows in).

This is why the UI never asks you to refresh after generating a spec or
drafting a brief — the new file appears in the sidebar within ~4 s
(or instantly via the optimistic path).

### Request lifecycle: one chat turn

Putting it all together, here's what happens when a user types
`Show me the architecture diagram for #brief` and presses Enter:

1. **Client** — `ChatPane` calls `POST /api/projects/:id/chat` with
   `{ message, attachments: [] }`.
2. **Express middleware** — `uploadRateLimit` checks the per-IP sliding window;
   sets `X-RateLimit-*` headers; rejects with 429 if exceeded.
3. **Persistence** — `projects.appendChat(pid, { role:'user', content })`
   writes the user turn to `data/projects.json`.
4. **Context resolution** — `findReferencedDocs(message, project.documents)`
   parses `#brief`, normalises it (lowercase, strip `.md`, dashes), and
   matches the brief document. The brief is added to the system prompt
   alongside any documents the user explicitly toggled "in context".
5. **LLM call** — `architect.chatTurn()` builds the messages array and calls
   `chutes.chat(...)` with `Authorization: Bearer ${Chutes_api_key}` and the
   model id from `process.env.CHUTES_MODEL` (default `zai-org/GLM-5.1-TEE`).
6. **Response** — Chutes returns markdown that may contain a
   ` ```mermaid ` block. The server persists the assistant turn and returns
   `{ user, assistant }` to the client.
7. **Client render** — `marked` parses the markdown, then `postProcessMermaid`
   converts ` ```mermaid ` code blocks to live SVG via `mermaid.run`.
   `normaliseMermaid` first splits any single-line flowchart back into the
   canonical multi-line shape so it actually renders.
8. **Background sync** — within 4 s, the polling loop catches up the sidebar
   counts and timestamps so other panes reflect the new state.

---

## Project layout

```
.
├─ server.js                    Express server (REST API + SPA static)
├─ package.json                 Root: starts the server, builds the client
├─ .env                         Chutes_api_key (you create this)
├─ data/
│  ├─ aws-catalog.json          Deterministic services + regions + pricing
│  └─ projects.json             Persisted project state (auto-created)
├─ lib/
│  ├─ catalog.js                Pricing helpers + region availability + compliance
│  ├─ catalog-api.js            Public catalog summary for the frontend
│  ├─ service-docs.js           Per-service deep documentation
│  ├─ architect.js              LLM orchestrator: design / chat / draft / spec
│  ├─ chutes.js                 Chutes API client + JSON extraction
│  ├─ projects.js               File-backed project + document CRUD
│  └─ rate-limit.js             Sliding-window per-IP rate limiter
├─ client/
│  ├─ index.html                Vite entry
│  ├─ vite.config.js            Dev proxy: /api → :3000
│  ├─ package.json              Frontend deps and scripts
│  ├─ dist/                     Built SPA (created by `npm run build`)
│  └─ src/
│     ├─ App.jsx                Hash-based router
│     ├─ main.jsx
│     ├─ pages/
│     │  ├─ Landing.jsx
│     │  ├─ ServiceLibrary.jsx
│     │  ├─ ServiceDetail.jsx
│     │  └─ Workspace.jsx
│     ├─ components/            ChatPane, StudioPane, DocumentEditor, …
│     ├─ components/bits/       React-Bits primitives (Aurora, GridMotion, …)
│     ├─ lib/
│     │  ├─ api.js              Fetch wrapper for the REST API
│     │  ├─ markdown.js         marked + Mermaid post-processor + normaliser
│     │  └─ router.js           Tiny hash router
│     └─ styles/                Global, app, landing CSS
└─ scripts/                     Smoke tests (catalog, full-stack, context, …)
```

---

## Quick start

> Prerequisites: **Node.js ≥ 18** and **npm**. A modern browser.

```bat
:: 1. Clone and enter the repo
git clone https://github.com/<you>/<repo>.git
cd <repo>

:: 2. Create the .env file with your Chutes key
echo Chutes_api_key=cpk_xxxxxxxx_yyyyyy_zzzzzz > .env

:: 3. Install everything (root deps + client deps via the postinstall hook)
npm install

:: 4. Build the React client
npm run build

:: 5. Boot the server (serves the SPA + API on :3000)
npm start
```

Then open <http://localhost:3000>.

> ⚠️ **Run `npm start` from the project root, NOT from `client/`.** The
> client folder only has `dev`/`build`/`preview` scripts; the Express server
> lives at the root.

---

## Build from scratch

If you want to walk through every install step manually instead of relying on
the postinstall hook (useful in CI or when scripting):

```bat
:: 1. Backend dependencies
cd <repo>
npm install --omit=optional

:: 2. Frontend dependencies
cd client
npm install
cd ..

:: 3. Build the SPA (writes client/dist/)
npm run client:build

:: 4. Verify the build
dir client\dist\index.html

:: 5. Confirm the .env file
type .env
::  → must contain at minimum: Chutes_api_key=...

:: 6. Run the server
npm start
```

The `data/projects.json` file is created automatically the first time you
create a project. Nothing else needs scaffolding.

### Verifying the build worked

A clean build looks like this:

```
client/dist/
  index.html                        ~0.9 KB
  assets/index-XXXX.css             ~45  KB
  assets/index-XXXX.js              ~630 KB
  assets/<dozens of mermaid chunks>
```

If `client/dist/index.html` is missing, the server falls back to serving
nothing — re-run `npm run client:build`.

---

## Development workflow

For hot-reload during UI work, run the server and the Vite dev server in two
separate terminals:

```bat
:: Terminal 1 — Express on :3000
npm run server

:: Terminal 2 — Vite dev server on :5173 with /api proxied to :3000
npm run client
```

Open <http://localhost:5173>. Edits to anything under `client/src/` reload
immediately. Edits to `server.js` or `lib/*` require restarting Terminal 1.

When you're ready to deploy, run `npm run build` to produce `client/dist/`
and serve everything from `npm start` on port 3000.

---

## Configuration (.env)

Create `.env` in the project root:

```
Chutes_api_key=cpk_xxxxxxxxxxxxxxxxxxxxxxxx_yyyyyyyyyyyyyyyy_zzzzzzzzzzzz
CHUTES_MODEL=zai-org/GLM-5.1-TEE
PORT=3000
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `Chutes_api_key` | **yes** | — | Bearer token used in `Authorization: Bearer …` against `https://llm.chutes.ai/v1/chat/completions`. Get one at <https://chutes.ai>. |
| `CHUTES_MODEL`   | no | `zai-org/GLM-5.1-TEE` | Any Chutes-listed chat-completions model id. The full list is returned by `GET https://llm.chutes.ai/v1/models`. |
| `PORT`           | no | `3000` | Port for the Express server. |

> The variable name **must** be `Chutes_api_key` (capital C, the rest
> lowercase). The code also accepts `CHUTES_API_KEY` as a fallback.

> The `.env` file is gitignored — never commit it.

---

## Choosing a Chutes model

The default is `zai-org/GLM-5.1-TEE` because it produces clean structured JSON
quickly. Other models that have been verified to work with the architect's
prompts:

| Model id | Notes |
|---|---|
| `zai-org/GLM-5.1-TEE` | **Default.** Fast (~4 s), clean fenced output, large context. |
| `zai-org/GLM-5-TEE` | Slightly faster, slightly less structured. |
| `moonshotai/Kimi-K2.6-TEE` | Very capable; sometimes prepends whitespace before JSON. |
| `deepseek-ai/DeepSeek-V3.2-TEE` | Strong reasoning; can be slow under load. |
| `google/gemma-4-31B-turbo-TEE` | Fastest direct-JSON output (~2 s). |
| `Qwen/Qwen3-235B-A22B-Thinking-2507` | Very smart, but emits a long hidden reasoning chain — set `CHUTES_MODEL` to this and bump max-tokens if you want to use it. |

To list all models available to your key:

```bat
node -e "require('dotenv').config(); fetch('https://llm.chutes.ai/v1/models', { headers: { Authorization: 'Bearer ' + process.env.Chutes_api_key } }).then(r => r.json()).then(j => console.log(j.data.map(m => m.id).join('\n')))"
```

---

## REST API

All endpoints are served by `server.js`. The SPA reaches them via `/api/...`.

### Catalog

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/catalog` | Regions + services + compliance frameworks |
| `GET`  | `/api/services-overview` | Compact service list for landing/library grids |
| `GET`  | `/api/services/:name` | Full service doc + per-region pricing snapshot |
| `GET`  | `/api/regions` | Legacy region list |
| `GET`  | `/api/services` | Legacy service-name list |

### Projects

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/projects` | Sidebar list (no chat history) |
| `POST` | `/api/projects` | Create `{ name, region?, brief?, enabled_services? }` |
| `GET`  | `/api/projects/:id` | Full project incl. chat + documents + last plan |
| `PATCH`| `/api/projects/:id` | Update `name` / `region` / `brief` / `enabled_services` / `last_plan` |
| `DELETE`| `/api/projects/:id` | Delete project |
| `POST` | `/api/projects/:id/clear-chat` | Wipe chat history |

### Documents (per project)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/projects/:id/documents` | Sidebar metadata list |
| `POST` | `/api/projects/:id/documents` | Create `{ name, type, content?, included_in_context? }` |
| `GET`  | `/api/projects/:id/documents/:docId` | Full document body |
| `PATCH`| `/api/projects/:id/documents/:docId` | Update name / content / context flag / type |
| `DELETE`| `/api/projects/:id/documents/:docId` | Delete (the brief is undeletable) |

### Chat and generation

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/projects/:id/chat` | Conversational turn `{ message, attachments? }`; rate-limited 12/min/IP. Resolves `#docname` references and injects in-context docs into the system prompt. |
| `POST` | `/api/projects/:id/design` | Run the deterministic plan generator; rate-limited 6/min/IP |
| `POST` | `/api/projects/:id/draft-brief` | Synthesise a Requirements Brief from chat history; persists to the brief doc; rate-limited 6/min/IP |
| `POST` | `/api/projects/:id/refine-brief` | Refine raw editor text into a structured brief; rate-limited 6/min/IP |
| `POST` | `/api/projects/:id/quick-spec` | Kiro-style Requirements → Design → Tasks; saved as a new doc; rate-limited 6/min/IP |
| `POST` | `/api/design` | Legacy single-shot design (no project) |

### Rate limit headers

Every rate-limited response includes:

```
X-RateLimit-Limit: 12
X-RateLimit-Remaining: 11
X-RateLimit-Reset: 1779602345        (only on 429)
Retry-After: 28                      (only on 429)
```

---

## Supported AWS regions and services

### Regions

| Code | Region | Country | Native attestations |
|---|---|---|---|
| `ap-southeast-5` | Asia Pacific (Malaysia) | Malaysia | PDPA-MY |
| `ap-southeast-1` | Asia Pacific (Singapore) | Singapore | PDPA-SG |
| `ap-southeast-3` | Asia Pacific (Jakarta) | Indonesia | UU-PDP-ID |
| `ap-southeast-7` | Asia Pacific (Thailand) | Thailand | PDPA-TH |
| `ap-northeast-1` | Asia Pacific (Tokyo) | Japan | APPI-JP |
| `ap-south-1` | Asia Pacific (Mumbai) | India | DPDP-IN |
| `us-east-1` | US East (N. Virginia) | United States | HIPAA, SOC 2, FedRAMP-Moderate |
| `eu-west-1` | Europe (Ireland) | Ireland | GDPR |

### Services

**Compute** — EC2, Lambda, EKS, ECS, Fargate, ECR
**Database** — RDS, DynamoDB, ElastiCache, OpenSearch
**Storage** — S3, EBS, Backup
**Networking** — ALB, NAT Gateway, CloudFront, Route 53, VPC, API Gateway, DataTransferOut
**Messaging** — SQS, SNS, EventBridge
**Security** — WAF, Shield, KMS, Cognito, Secrets Manager
**Analytics** — Athena, Glue
**Monitoring** — CloudWatch

Every service has region availability data, deterministic on-demand pricing,
and a deep documentation page (`#/services/:name`) covering purpose, when to
use, how to implement, sample Terraform, common pitfalls, and a per-region
pricing snapshot.

---

## Compliance frameworks

| Code | Full name | Data must reside in |
|---|---|---|
| `PDPA-MY` | Personal Data Protection Act 2010 (Malaysia) | MY |
| `PDPA-SG` | Personal Data Protection Act 2012 (Singapore) | SG |
| `UU-PDP-ID` | Undang-Undang Pelindungan Data Pribadi (Indonesia) | ID |
| `PDPA-TH` | Personal Data Protection Act B.E. 2562 (Thailand) | TH |
| `APPI-JP` | Act on the Protection of Personal Information (Japan) | JP |
| `DPDP-IN` | Digital Personal Data Protection Act 2023 (India) | IN |
| `GDPR` | General Data Protection Regulation | EU |
| `HIPAA` | Health Insurance Portability and Accountability Act | US |
| `SOC2` | SOC 2 Type II | (any attested region) |
| `FedRAMP-Moderate` | FedRAMP Moderate Baseline | US |

---

## How the deterministic bill works

```
  Brief
    │
    ▼
  Chutes LLM        →  workload profile (JSON)
    │
    ▼
  Chutes LLM        →  architecture proposal (JSON, constrained vocabulary)
    │
    ▼
  ┌──────── DETERMINISTIC GUARDRAILS (lib/catalog.js) ────────┐
  │ • Region availability check                                │
  │ • Auto-fallback to nearest valid region                    │
  │ • Per-component pricing from data/aws-catalog.json         │
  │ • Data-residency / compliance verdict                      │
  └────────────────────────────────────────────────────────────┘
    │
    ▼
  Markdown deployment plan (executive summary, Mermaid diagram,
  component table, itemized bill, compliance audit, next steps)
```

The LLM proposes the **shape** of the architecture: which services, what sizes,
how many instances. Express then walks that JSON and bills each component
from a versioned local catalog of public AWS list prices. Run the same brief
twice → identical bill. The model never sees a price.

Pricing model: USD, on-demand list, 730 hours per month. Always check the
official AWS pricing calculator (and apply Reserved-Instance / Savings-Plan
discounts) before signing a contract.

---

## Smoke tests

`scripts/` contains automated end-to-end checks. Start the server first
(`npm start`), then in another terminal:

```bat
:: Deterministic-only — no LLM call
node scripts\smoke-catalog.js

:: SPA shell + static serving
node scripts\smoke-spa.js

:: Per-IP rate limiting + service detail endpoint
node scripts\smoke-v3.js

:: Per-project documents + brief mirror
node scripts\smoke-v4.js

:: refine-brief, quick-spec, #docname references
node scripts\smoke-v5.js

:: Mermaid normaliser unit-style check
node scripts\smoke-mermaid.js

:: End-to-end design pipeline (HITS the LLM, slow)
node scripts\smoke-llm.js

:: Full lifecycle: project + chat + design + delete
node scripts\smoke-fullstack.js

:: Architect grounding (chat history + in-context docs)
node scripts\smoke-context.js
```

---

## Troubleshooting

**Black screen at `#/app`.** Open the browser DevTools console; you'll see
the offending React error. The most common cause has been state/typo bugs
during refactors. Reload after any code edit since the SPA caches aggressively.

**`npm start` says "Missing script: start".** You're in `client/`. Run it
from the project root (`cd ..`).

**Server crashes with `EADDRINUSE :::3000`.** Another node process is
holding the port. Either kill it (`taskkill /F /IM node.exe` on Windows) or
change the port: `set PORT=3001 && npm start`.

**`Chutes API 404: model not found: ...`.** Your `CHUTES_MODEL` value isn't
listed for your key. Run the model-list snippet under
[Choosing a Chutes model](#choosing-a-chutes-model).

**Chat returns "Empty LLM response" or "Unbalanced JSON braces".** The model
exhausted its token budget while emitting hidden reasoning. Use a less
verbose model (Gemma-4 or GLM-5.1) or bump `maxTokens` in `lib/architect.js`.

**Build is slow / `mermaid-flowchart-elk` chunk is huge.** Expected — Mermaid
flowchart engines are heavy and lazy-loaded. The actual bundle the SPA boots
with is `index-XXXX.js` at ~630 KB (gzipped 188 KB).

**Mermaid diagrams render as plain text in chat.** If the LLM emits the
flowchart on a single line, the client-side normaliser
(`client/src/lib/markdown.js → normaliseMermaid`) splits it back into the
canonical multi-line shape before handing it to Mermaid. If the post-fix
output still doesn't render, paste the raw fenced block into
<https://mermaid.live> and look for the parser error.

**Documents don't appear after Quick Spec / Refine.** The workspace polls
every 4 s and refreshes on tab focus, plus splices new docs in optimistically.
If something is still stuck, click the refresh icon next to the "In context"
header in the Docs panel.

---

## Updating the catalog

Add a new AWS service in three steps:

1. **Pricing data** — add an entry under `services` in `data/aws-catalog.json`
   with `category`, `available_in`, `billing_unit`, and the per-region rates.
2. **Pricing helper** — add a `priceXxx(...)` function in `lib/catalog.js`
   and export it from the bottom of the file.
3. **Hook into architect** — add the service to the `ALL_SERVICES` array and
   the `priceComponent` switch in `lib/architect.js`. Document the config-key
   shape inside the `ARCH_SYSTEM` system prompt.
4. **Service docs** — add a rich entry in `lib/service-docs.js`
   (`purpose`, `when_to_use`, `how_to_implement`, `pairs_well_with`,
   `common_pitfalls`, `sample_terraform`).
5. **Icon + tagline** — update `SERVICE_DESCRIPTIONS` in
   `lib/catalog-api.js` so the resource panel and landing page render the
   right icon and short text.

Add a region by extending `regions` in the catalog and replicating the
per-region rate keys for every service that supports it.

---

_Built for the AI Marathon 2026 — Autonomous Sales Engineer problem
statement. Pricing model: AWS on-demand list (USD), 730 h/month. The LLM
proposes the architecture; the bill is reproducible and computed locally._
