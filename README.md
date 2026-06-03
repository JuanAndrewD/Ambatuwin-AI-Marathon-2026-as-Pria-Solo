# ☁️ The Cloud Infrastructure Architect

> 🌐 **Live demo:** <https://ambatuwin-ai-marathon-2026-as-pria-solo.onrender.com/>
>
> Deployed on Render (free tier — first request after idle takes ~30 s to
> wake). Powered by Chutes LLM. Sign in with GitHub; projects persist in
> PostgreSQL across redeploys.

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

- **Accounts** — sign in with GitHub. Each user gets an isolated session and
  their own private set of projects, stored in PostgreSQL.
- **GitHub sync** — connect an existing repo or create a new one from the app,
  then push every project document (and the generated plan) straight to the
  repo as markdown via the Git Trees API — no zip, no local git.
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
| Persistence | PostgreSQL (`users` + `projects` tables) via `pg` |
| Auth | GitHub OAuth (cookie sessions, `express-session` + `connect-pg-simple`) |
| Repo sync | GitHub Git Data (Trees) API — push markdown without zip or local git |

---

## Architecture

The system is a three-layer agent: **LLM** for natural-language understanding
and generation, **deterministic guardrails** for everything that must be
reproducible (pricing, region availability, compliance), and **PostgreSQL-backed
state** for accounts, projects, documents, and conversation history. Users sign
in with **GitHub** and every project is scoped to their database row. The
frontend is a single-page React app talking to an Express REST API.

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
│   │ (PG, user-scoped)│    │ (sliding window) │    │ (public summary) │         │
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
│   │  projects.js     │ ◄── reads/ ───┤ PostgreSQL (per-user state via FK:      │
│   │  users.js · db.js│     writes    │  users, projects, chat, docs, plan)    │
│   │  (PG, user-scoped)│              └──────────────────┘                      │
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

### Accounts, sessions, and PostgreSQL persistence

State lives in **PostgreSQL**, not on disk. Two relational tables replace the
old `data/projects.json` file:

| Table | Purpose | Owner |
|---|---|---|
| `users` | One row per GitHub account that signs in: `github_id`, `username`, profile, the OAuth `access_token` (used for Git API calls), and the connected-repository mapping (`repo` JSONB). | The running app |
| `projects` | One row per architecture engagement, tied to a user via a `user_id` foreign key. `documents`, `chat`, and `last_plan` are JSONB columns so the shape matches the old JSON tree. | The running app |

The only read-only file left is `data/aws-catalog.json` (service catalog,
regions, prices, compliance frameworks — updated by hand when AWS publishes
new pricing).

#### Why PostgreSQL?

- **Real accounts.** Every project carries a `user_id`, so one GitHub account
  never sees another's work. Reads and writes are filtered by `user_id` in
  SQL, so a forged project id from another account simply returns `null`.
- **Survives redeploys.** Render's free file system is ephemeral; a managed
  Postgres instance persists across deploys on every plan tier.
- **Concurrent writers.** No more whole-file rewrites — mutations are scoped
  row updates.

`lib/db.js` owns the connection pool and idempotent schema bootstrap
(`init()`), `lib/users.js` is the user data-access layer, and `lib/projects.js`
is the user-scoped project + document CRUD. The public function signatures are
unchanged except every call now takes a leading `userId` and is `async`.

#### Authentication: GitHub OAuth + cookie sessions

1. The browser hits `GET /api/auth/github`, which generates a CSRF `state`
   nonce, stashes it in the session, and redirects to GitHub's consent screen
   requesting the `read:user user:email repo` scopes.
2. GitHub calls back to `GET /api/auth/github/callback?code=…&state=…`. The
   server verifies `state`, exchanges the `code` for an access token, reads the
   user's profile, and **dynamically upserts the user in PostgreSQL**
   (`users.upsertFromGitHub`).
3. It then starts an isolated cookie session by setting `req.session.userId`.
   Sessions are stored in the database too, via `connect-pg-simple` (a
   `session` table created lazily). The cookie is `httpOnly`, `sameSite=lax`,
   and `secure` in production.

All project, document, chat, and GitHub routes are guarded by `requireAuth`,
which 401s when there is no `req.session.userId`.

#### Connecting a repository

`POST /api/github/connect` works in two modes:

- `{ mode: 'existing', owner, name, branch? }` — looks the repo up and records
  the mapping.
- `{ mode: 'create', name, private?, description? }` — creates a new repo under
  the user (`auto_init: true`) and records the mapping.

Either way, instead of dumping to a generic directory, this endpoint
**registers the repository mapping inside the user's specific database row**
(`users.repo` JSONB: `owner`, `name`, `branch`, `html_url`, …).

#### Syncing markdown without zip or local git

`POST /api/projects/:id/github/sync` pushes every project document (plus the
generated `deployment-plan.md` when present) into the connected repo. To send
files without zipping them or installing Git on Render, it uses the low-level
**Git Trees API** to build a file-structure footprint and move the target
branch in a single backend flow (`lib/github-api.pushFiles`):

```
GET   /repos/:o/:r/git/ref/heads/:branch   → current commit sha (base tree)
POST  /repos/:o/:r/git/blobs        (×N)   → one blob per markdown file
POST  /repos/:o/:r/git/trees               → assemble the tree (on base_tree)
POST  /repos/:o/:r/git/commits             → new commit
PATCH /repos/:o/:r/git/refs/heads/:branch  → move the branch to the new commit
```

A brand-new empty repo (no ref yet) is handled by creating the first commit
and `POST`ing a fresh ref instead.

#### Project shape (a `projects` row)

```json
{
  "id": "p_a1b2c3d4e5f6",
  "user_id": 1,
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
    "profile": { },
    "arch":    { },
    "priced":  { "items": [], "issues": [], "total": 1418.87 },
    "compliance": { "ok": true, "passes": [], "issues": [] },
    "region": { "code": "ap-southeast-5", "name": "...", "country": "..." },
    "markdown": "# ☁️ AWS Cloud Infrastructure Deployment Plan\n…"
  },
  "created_at": "…",
  "updated_at": "…"
}
```

#### Privacy

- Chat **attachment contents are NOT persisted**. The user message stores
  only `{ name, bytes }` metadata; the file body lives in memory for one LLM
  call and is then discarded.
- Documents the user authors in the editor **are** persisted (that's the
  whole point of the document store).
- The `.env` file is git-ignored. The `Chutes_api_key`, GitHub client secret,
  and stored OAuth tokens never leave the server process — `users.publicUser()`
  strips the access token before any response reaches the client.

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
3. **Persistence** — `projects.appendChat(userId, pid, { role:'user', content })`
   writes the user turn to the `projects` row in PostgreSQL.
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
├─ server.js                    Express server (REST API + SPA static + auth)
├─ package.json                 Root: starts the server, builds the client
├─ .env                         Chutes key, GitHub OAuth, DATABASE_URL (you create this)
├─ render.yaml                  Render blueprint (web service + managed Postgres)
├─ data/
│  └─ aws-catalog.json          Deterministic services + regions + pricing (read-only)
├─ lib/
│  ├─ catalog.js                Pricing helpers + region availability + compliance
│  ├─ catalog-api.js            Public catalog summary for the frontend
│  ├─ service-docs.js           Per-service deep documentation
│  ├─ architect.js              LLM orchestrator: design / chat / draft / spec
│  ├─ chutes.js                 Chutes API client + JSON extraction
│  ├─ db.js                     PostgreSQL pool + schema bootstrap (users, projects)
│  ├─ users.js                  User data-access (GitHub upsert, repo mapping)
│  ├─ projects.js               PostgreSQL project + document CRUD (user-scoped)
│  ├─ github-config.js          OAuth credential selection (local vs production)
│  ├─ github-api.js             GitHub REST + Git Trees push (no zip / no git)
│  ├─ routes-auth.js            OAuth login / callback / logout / me
│  ├─ routes-github.js          Repo list / connect / disconnect
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
│     │  ├─ api.js              Fetch wrapper for the REST API (credentials: include)
│     │  ├─ auth.js             useAuth hook (session state, login, logout)
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

:: 2. Create the .env file (Chutes key, GitHub OAuth, DATABASE_URL)
::    Copy the template and fill in your values:
copy .env.example .env

:: 3. Install everything (root deps + client deps via the postinstall hook)
npm install

:: 4. Build the React client
npm run build

:: 5. Boot the server (serves the SPA + API on :3000)
npm start
```

Then open <http://localhost:3000>. You'll land on a **Sign in with GitHub**
screen — the workspace is gated behind a session.

> ⚠️ **Run `npm start` from the project root, NOT from `client/`.** The
> client folder only has `dev`/`build`/`preview` scripts; the Express server
> lives at the root.

> 🔑 **Prerequisites for sign-in:** a reachable PostgreSQL instance
> (`DATABASE_URL`) and a GitHub OAuth app whose callback URL is
> `http://localhost:3000/api/auth/github/callback` (see
> [Configuration](#configuration-env)). The `users`, `projects`, and `session`
> tables are created automatically on first boot.

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
::  → must contain at minimum: Chutes_api_key=..., DATABASE_URL=...,
::    and a GitHub OAuth pair (GITHUB_CLIENT_ID[_LOCAL] / _SECRET[_LOCAL])

:: 6. Run the server
npm start
```

The `users`, `projects`, and `session` tables are created automatically in
PostgreSQL on first boot (`lib/db.js` → `init()`). Nothing else needs
scaffolding.

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

Copy `.env.example` to `.env` and fill in your values:

```
# Chutes LLM
Chutes_api_key=cpk_xxxxxxxxxxxxxxxxxxxxxxxx_yyyyyyyyyyyyyyyy_zzzzzzzzzzzz
CHUTES_MODEL=zai-org/GLM-5.1-TEE

# GitHub OAuth (production pair)
GITHUB_CLIENT_ID=Iv1_xxxxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# GitHub OAuth (local/dev pair)
GITHUB_CLIENT_ID_LOCAL=Iv1_yyyyyyyyyyyy
GITHUB_CLIENT_SECRET_LOCAL=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy

# Server + database
PORT=3000
SESSION_SECRET=a_long_random_string
DATABASE_URL=postgres://user:pass@localhost:5432/cia
```

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `Chutes_api_key` | **yes** | — | Bearer token used in `Authorization: Bearer …` against `https://llm.chutes.ai/v1/chat/completions`. Get one at <https://chutes.ai>. |
| `CHUTES_MODEL`   | no | `zai-org/GLM-5.1-TEE` | Any Chutes-listed chat-completions model id. The full list is returned by `GET https://llm.chutes.ai/v1/models`. |
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string. TLS is auto-enabled for non-localhost hosts. The schema is created on boot. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | prod | — | Production GitHub OAuth app credentials (used when `NODE_ENV=production` or on Render). |
| `GITHUB_CLIENT_ID_LOCAL` / `GITHUB_CLIENT_SECRET_LOCAL` | local | — | Local GitHub OAuth app credentials (used in development). |
| `GITHUB_ENV` | no | auto | Force `local` or `production` credential selection, overriding auto-detection. |
| `SESSION_SECRET` | recommended | dev fallback | Secret used to sign the session cookie. Set a long random value in production. |
| `PUBLIC_URL` | no | derived | Explicit public base URL for building the OAuth callback (otherwise derived from the request / `RENDER_EXTERNAL_URL`). |
| `PORT`           | no | `3000` | Port for the Express server. |

> The variable name **must** be `Chutes_api_key` (capital C, the rest
> lowercase). The code also accepts `CHUTES_API_KEY` as a fallback.

> The `.env` file is gitignored — never commit it.

### Server configuration & local vs. production selection

The app registers **two GitHub OAuth apps** and chooses the right credential
pair at runtime, so the same codebase runs locally and on Render without edits
(`lib/github-config.js`):

1. `GITHUB_ENV=local|production` forces a mode if set.
2. Otherwise `NODE_ENV=production` → production.
3. Otherwise the presence of Render's `RENDER` / `RENDER_EXTERNAL_URL` → production.
4. Otherwise → local.

Set up the GitHub OAuth apps at
<https://github.com/settings/developers> → **New OAuth App**:

| App | Homepage URL | Authorization callback URL |
|---|---|---|
| Local | `http://localhost:3000` | `http://localhost:3000/api/auth/github/callback` |
| Production | `https://<your-app>.onrender.com` | `https://<your-app>.onrender.com/api/auth/github/callback` |

The callback URL is derived from the incoming request (honouring
`x-forwarded-proto`/`-host` because the server sets `trust proxy`), or pinned
explicitly with `PUBLIC_URL`. The requested scopes are
`read:user user:email repo` — `repo` is required to create repositories and
push files on the user's behalf.

> **Dev note:** when using the Vite dev server on `:5173`, sign in by opening
> `http://localhost:3000` directly (the Express origin), or register the
> `:5173` callback as a second local app. Session cookies are host-scoped, so
> they're shared across ports once set.

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
Every request from the client sends the session cookie (`credentials:
'include'`). **Project, document, chat, and GitHub routes require an
authenticated session** and return `401` otherwise. Catalog routes are public.

### Auth

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/auth/github` | Start OAuth (`?returnTo=#/app`); redirects to GitHub |
| `GET`  | `/api/auth/github/callback` | OAuth callback; upserts the user, starts the session, redirects back |
| `POST` | `/api/auth/logout` | Destroy the session |
| `GET`  | `/api/auth/me` | `{ user, configured, mode }` — current session user (or `null`) |

### GitHub

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/github/repos` | List the signed-in user's repositories |
| `POST` | `/api/github/connect` | Connect existing `{ mode:'existing', owner, name, branch? }` or create `{ mode:'create', name, private?, description? }`; stores the mapping on the user row |
| `POST` | `/api/github/disconnect` | Clear the connected-repo mapping |
| `POST` | `/api/projects/:id/github/sync` | Push the project's markdown (+ plan) to the repo via the Git Trees API; body: `{ path?, branch?, message? }` |

### Catalog

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/catalog` | Regions + services + compliance frameworks |
| `GET`  | `/api/services-overview` | Compact service list for landing/library grids |
| `GET`  | `/api/services/:name` | Full service doc + per-region pricing snapshot |
| `GET`  | `/api/regions` | Legacy region list |
| `GET`  | `/api/services` | Legacy service-name list |

### Projects

> All project routes require a session and are scoped to the signed-in user.

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

`scripts/` contains automated end-to-end checks.

The data layer can be tested without GitHub or a running server — point
`DATABASE_URL` at a throwaway database and run:

```bat
:: User + project DB layer: upsert, per-user scoping, cross-user isolation,
:: document CRUD, repo mapping, cascade delete (needs DATABASE_URL)
node scripts\smoke-db.js
```

For the HTTP checks, start the server first (`npm start`), then in another
terminal:

```bat
:: Auth gate + session wiring: public catalog, /api/auth/me, 401 on
:: project + github routes without a session
node scripts\smoke-auth-http.js

:: Deterministic-only — no LLM call
node scripts\smoke-catalog.js

:: SPA shell + static serving
node scripts\smoke-spa.js

:: Mermaid normaliser unit-style check
node scripts\smoke-mermaid.js
```

> **Note:** the older `smoke-v3/v4/v5`, `smoke-fullstack`, `smoke-context`,
> `smoke-default-services`, and `smoke-attachments` scripts hit the
> now-authenticated project routes directly and will receive `401` without a
> session cookie. Run them through an authenticated browser session, or adapt
> them to carry the `cia.sid` cookie, before relying on them.

---

## Troubleshooting

**Stuck on the "Sign in with GitHub" screen / "GitHub OAuth isn't configured".**
The server didn't find a client id/secret for the active mode. Check
`/api/auth/me` — `configured` should be `true` and `mode` should match your
intent. Set the `GITHUB_CLIENT_ID[_LOCAL]` / `GITHUB_CLIENT_SECRET[_LOCAL]`
pair and restart.

**`GitHub sign-in failed: invalid OAuth state`.** The session cookie was lost
between starting the flow and the callback (often a port/origin mismatch in
dev). Open the app on the Express origin (`http://localhost:3000`) and retry.

**`redirect_uri_mismatch` from GitHub.** The callback URL on your OAuth app
doesn't match what the server sent. It must be exactly
`<base>/api/auth/github/callback`. Pin the base with `PUBLIC_URL` if you're
behind a proxy.

**Server exits with "failed to initialise database".** `DATABASE_URL` is
missing, wrong, or the database is unreachable. For hosted Postgres, TLS is
auto-enabled; for localhost it's disabled. Verify with
`psql "$DATABASE_URL" -c "select 1"`.

**`401` from `/api/projects` in a script.** Project routes now require a
session. Sign in through the browser, or carry the `cia.sid` cookie in your
test client.



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
