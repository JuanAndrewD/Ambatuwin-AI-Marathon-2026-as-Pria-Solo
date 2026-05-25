# ☁️ The Cloud Infrastructure Architect

A **fullstack** Autonomous Technical Sales Consultant for AWS — solves the *Autonomous Sales Engineer*
problem statement at AI Marathon 2026.

You describe the workload in natural language. The agent parses it with a Chutes-hosted LLM,
navigates a deterministic AWS catalog, validates regional availability, computes a reproducible
monthly bill, and delivers a complete `.md` deployment plan with a Mermaid architecture diagram and
data-residency compliance check.

---

## Tour

| Route | Purpose |
|---|---|
| `#/` | Landing page — Anthropic-style hero, GridMotion grid background, BorderGlow feature cards, SpotlightCard service grid |
| `#/services` | Library of every AWS service in the catalog, grouped by category, searchable |
| `#/services/:name` | Per-service deep dive — purpose, when to use, how to implement, sample Terraform, common pitfalls, **live regional pricing** |
| `#/app` | Three-pane workspace: Projects + Resources · Chat · Studio |

### React-Bits inspired primitives

Built into `client/src/components/bits/` (zero external dependency):

- **GridMotion** — animated grid of cells scrolling at different speeds (hero background)
- **BorderGlow** — moving conic-gradient border on cards
- **SpotlightCard** — radial spotlight follows the cursor
- **ShinyText** — gradient sweep highlight
- **SplitText** — word-by-word entrance reveal
- **MagneticButton** — element follows the cursor inside a hover radius
- **TiltCard** — 3D tilt on mouse move

### What's new in v4

- **Per-project documents** — every project automatically owns a "Requirements brief" markdown document. Add as many notes / proposal / Terraform fragments as you want.
- **In-browser code editor** — line-numbered, tab-aware (Tab/Shift+Tab indent + outdent on selection), Ctrl/Cmd+S to save, list-continuation on Enter, debounced auto-save (1.2 s), live word/line/char counter.
- **Markdown preview** — three view modes per document: Edit, Split, Preview. Mermaid diagrams render in preview/split.
- **In-context documents** — toggle the "eye" on any document to inject it into every chat turn. The architect quotes from documents verbatim when asked.
- **Memory-aware chat** — the system prompt now ships every in-context document plus a summary of the last generated plan, and the message-history window doubled to 20 turns.
- **Draft brief from chat** — one click and the architect synthesises a structured Requirements Brief from the existing conversation, then writes it back to the brief document.
- **Insert document into chat** — promote a document into the conversation as authoritative context.
- **Smooth scroll & affordances** — landing page has a "Scroll to explore" cue under the hero and a back-to-top FAB after scrolling past the fold; the chat stream has a "jump to latest" button when you scroll up to read older messages.
- **Project export** — the .zip bundle now includes every project document under `documents/`.

### What's new in v3

- **Anthropic-style landing page** with a grid-motion background and a "Project Glassroom" showcase block.
- **Service library + service detail pages** — every AWS building block has its own page covering purpose, when to use it, how to wire it in, common pitfalls, sample Terraform, and live regional pricing tiles.
- **File uploads** in the chat composer (drag-and-drop or click). Text-only formats accepted (`.md, .txt, .json, .yaml, .csv, .log, .tf, .hcl, .toml, .ini`). Caps: 5 files × 200 KB each × 500 KB total.
- **Per-IP rate limiting** — chat 30 req/min, design 6 req/min, upload 12 req/min. Sliding-window, in-memory.
- **One-click `.zip` export** of the project bundle (README + brief + plan + Terraform + proposal + chat transcript).
- **Top-bar navigation** between landing / services / workspace.

---

## Architecture

```
┌─────────────────────── React SPA (Vite, hash-routed) ────────────────────────┐
│  /  ─ Landing                  /app  ─ Workspace                              │
│  /services  ─ Library          /services/:name  ─ Detail                      │
└──────────┬───────────────────┬─────────────────────────────┬──────────────────┘
           │                   │                             │
           │   /api/projects   │  /api/projects/:id/chat     │  /api/services/:name
           │                   │  (with attachments,         │  (rich docs +
           │                   │   rate limited)             │   live pricing)
           ▼                   ▼                             ▼
┌──────────────────────── Express server ──────────────────────────────────────┐
│ projects.js   architect.js   service-docs.js   rate-limit.js   catalog-api.js │
│      │             │                                                          │
│      └────► chutes.js ───── Chutes /v1/chat/completions                       │
│                                                                                │
│      catalog.js  ◄─────────  data/aws-catalog.json                            │
│   (deterministic pricing, region availability, compliance check)              │
└────────────────────────────────────────────────────────────────────────────────┘
```

The LLM only proposes the **shape** of the architecture. Pricing, regional validity, and compliance
verdicts are computed locally from a versioned catalog, so the bill is reproducible from the same
input — no hallucinated numbers.

---

## Setup

```bat
:: Install backend + client (the postinstall hook chains them)
npm install

:: Build the React client
npm run build

:: Start the server (serves the SPA + API on :3000)
npm start
```

Open <http://localhost:3000>.

### Hot-reload during development

```bat
:: terminal 1 — backend on :3000
npm run server

:: terminal 2 — Vite dev server on :5173 with proxy → :3000
npm run client
```

### Environment

```
Chutes_api_key=...                       # required
CHUTES_MODEL=zai-org/GLM-5.1-TEE         # optional (default)
PORT=3000                                # optional
```

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/catalog`                 | regions + services + compliance frameworks |
| `GET`  | `/api/services-overview`       | landing/library grid (icon, category, purpose) |
| `GET`  | `/api/services/:name`          | full doc + per-region pricing snapshot |
| `GET`  | `/api/projects`                | project sidebar list |
| `POST` | `/api/projects`                | create project |
| `GET`/`PATCH`/`DELETE` | `/api/projects/:id` | CRUD |
| `POST` | `/api/projects/:id/chat`       | conversational turn (with `attachments` + injected in-context docs); rate-limited |
| `POST` | `/api/projects/:id/clear-chat` | wipe chat history |
| `POST` | `/api/projects/:id/design`     | full deterministic plan; rate-limited |
| `POST` | `/api/projects/:id/draft-brief`| synthesise a Requirements Brief from chat history; rate-limited |
| `GET`  | `/api/projects/:id/documents`             | list documents (sidebar metadata only) |
| `POST` | `/api/projects/:id/documents`             | create document `{ name, type, content?, included_in_context? }` |
| `GET`  | `/api/projects/:id/documents/:docId`      | full document body |
| `PATCH`| `/api/projects/:id/documents/:docId`      | update name / content / included_in_context / type |
| `DELETE` | `/api/projects/:id/documents/:docId`    | delete (the brief is undeletable) |

---

## Supported

| AWS regions | Native attestations |
|---|---|
| `ap-southeast-5` Malaysia | PDPA-MY |
| `ap-southeast-1` Singapore | PDPA-SG |
| `ap-southeast-3` Jakarta | UU-PDP-ID |
| `ap-southeast-7` Thailand | PDPA-TH |
| `ap-northeast-1` Tokyo | APPI-JP |
| `ap-south-1` Mumbai | DPDP-IN |
| `us-east-1` N. Virginia | HIPAA, SOC 2, FedRAMP-Moderate |
| `eu-west-1` Ireland | GDPR |

**Services**: EC2, RDS, DynamoDB, S3, EBS, ALB, NAT Gateway, CloudFront, Route 53, Lambda,
ElastiCache, EKS, WAF, Shield, KMS, Backup, DataTransferOut.

---

## Why is the bill trustworthy?

The LLM never sees a price. It only emits a structured JSON of which services to use, sizes,
counts, and configuration. Express then walks that JSON and bills each component from a versioned
local catalog of public AWS list prices. Run the same brief twice and you get the same number.
