# ☁️ The Cloud Infrastructure Architect

A **fullstack** Autonomous Technical Sales Consultant for AWS — solves the *Autonomous Sales Engineer*
problem statement at AI Marathon 2026.

You describe the workload in natural language. The agent parses it with a Chutes-hosted LLM, navigates
a deterministic AWS catalog, validates regional availability, computes a reproducible monthly bill, and
delivers a complete `.md` deployment plan with a Mermaid architecture diagram and data-residency
compliance check.

---

## What's in v2

A NotebookLM-inspired three-pane workspace, an OpenAI-style minimal chrome, and Claude-grade typography.

- **Projects** (left pane) — name, organise, and switch between architecture engagements. Each project
  has its own brief, region, allowed-services subset, chat history, and last generated plan.
  Persisted to `data/projects.json`.
- **Resources** (left pane, second tab) — every AWS service in the catalog appears as a toggleable
  source. The architect is **locked to the enabled subset** — flip a service off and it disappears
  from the next plan. Services not natively available in the project's region are tagged "fallback".
- **Chat** (centre) — conversational architect with the project context (region, brief, allowed services,
  catalog snapshot) injected into every turn. Markdown + Mermaid render inline.
- **Studio** (right pane) — six one-click actions, NotebookLM "Audio Overview"-style:
  - Generate plan (full deterministic deliverable)
  - Architecture diagram
  - Itemized bill
  - Compliance audit
  - Terraform skeleton
  - Sales proposal
- **Live KPIs** — animated counters for monthly bill, components, region, compliance pass rate.
- **Plan download** — `.md` export with budget delta, validation notes, and recommended next steps.

---

## Architecture

```
┌────────────────────────── React SPA (Vite) ──────────────────────────┐
│  Projects │       Conversational Chat        │ Studio (actions, KPIs)│
│  Resources│  (NotebookLM-style three pane)   │                       │
└──────────┬───────────────────┬───────────────────────────┬───────────┘
           │                   │                           │
           │   /api/projects   │  /api/projects/:id/chat   │  /api/projects/:id/design
           ▼                   ▼                           ▼
┌──────────────────────── Express server ──────────────────────────────┐
│  projects.js (file-backed CRUD)   architect.js (LLM orchestration)   │
│        │                                  │                          │
│        └────────► chutes.js ──── Chutes /v1/chat/completions          │
│                                                                       │
│        catalog.js  ◄────────────  data/aws-catalog.json               │
│   (deterministic pricing, region availability, compliance check)      │
└───────────────────────────────────────────────────────────────────────┘
```

The LLM only proposes the **shape** of the architecture. Pricing, regional validity, and compliance
verdicts are computed locally from a versioned catalog, so the bill is reproducible from the same
input — no hallucinated numbers.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js 18+, Express |
| LLM | [Chutes](https://chutes.ai) `/v1/chat/completions` (key from `.env` → `Chutes_api_key`) |
| Default model | `zai-org/GLM-5.1-TEE` (override with `CHUTES_MODEL`) |
| Client | React 18, Vite 5, lucide-react, framer-motion |
| Markdown | marked |
| Diagrams | Mermaid (dark theme) |
| Pricing | Local catalog `data/aws-catalog.json` (USD on-demand list, 730 h/mo) |

---

## Setup

```bat
:: 1. Install backend + client (postinstall hook chains them)
npm install

:: 2. Confirm .env contains the key
type .env

:: 3. Build the React client
npm run build

:: 4. Start the server (serves the built SPA + API)
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
| `GET`  | `/api/catalog`               | regions, services with availability + compliance frameworks |
| `GET`  | `/api/regions`               | regions list (legacy) |
| `GET`  | `/api/projects`              | list projects (sidebar) |
| `POST` | `/api/projects`              | create project `{ name, region?, brief?, enabled_services? }` |
| `GET`  | `/api/projects/:id`          | full project incl. chat + last plan |
| `PATCH`| `/api/projects/:id`          | update name / region / brief / enabled_services |
| `DELETE` | `/api/projects/:id`        | delete project |
| `POST` | `/api/projects/:id/clear-chat` | wipe chat history |
| `POST` | `/api/projects/:id/chat`     | conversational turn `{ message }` |
| `POST` | `/api/projects/:id/design`   | generate full deterministic plan |
| `POST` | `/api/design`                | legacy single-shot design (no project) |

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

Because the LLM never sees a price. It only emits a structured JSON of which services to use, sizes,
counts, and configuration. Express then walks that JSON and bills each component from a versioned
local catalog of public AWS list prices. Run the same brief twice and you get the same number.
