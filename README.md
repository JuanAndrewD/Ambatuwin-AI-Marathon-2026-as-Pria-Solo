# ☁️ The Cloud Infrastructure Architect

An **Autonomous Technical Sales Consultant** website that takes a high-level requirements brief
and autonomously designs a complete, valid, and quoted AWS deployment plan — solving the
*"Autonomous Sales Engineer"* problem statement at the AI Marathon 2026.

> The user describes their application stack (e.g. *"We need a secure database for 50,000 active
> users in Malaysia with auto-failover"*). The website parses this, interfaces with cloud service
> catalogs, validates regional availability, computes a deterministic monthly bill, and outputs a
> full `.md` deployment plan with a Mermaid AWS architecture diagram and data-residency
> compliance check.

---

## How it works

```
Brief ──▶ [Chutes LLM] ──▶ Workload profile (JSON)
                              │
                              ▼
         [Chutes LLM, constrained vocabulary] ──▶ Architecture (JSON)
                              │
                              ▼
        ┌───────── DETERMINISTIC GUARDRAILS ─────────┐
        │ • Region availability check                │
        │ • Auto-fallback to nearest region          │
        │ • Pricing from local AWS catalog (USD/mo)  │
        │ • Data-residency / compliance verdict      │
        └────────────────────────────────────────────┘
                              │
                              ▼
                   Markdown deployment plan
                   (executive summary, Mermaid
                    diagram, component table,
                    itemized bill, compliance,
                    next steps)
```

The LLM proposes the **shape** of the architecture only. Pricing, region validity, and compliance
are computed locally from `data/aws-catalog.json`, so the bill is **reproducible** from the same
input — no hallucinated numbers.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js 18+, Express |
| LLM | [Chutes](https://chutes.ai) OpenAI-compatible chat API (`Chutes_api_key` from `.env`) |
| Frontend | Vanilla HTML/CSS/JS, [marked](https://marked.js.org) for markdown, [Mermaid](https://mermaid.js.org) for diagrams |
| Pricing | Local deterministic catalog (`data/aws-catalog.json`, AWS on-demand list, 730 h/month) |

---

## Setup

```bat
:: 1. Install
npm install

:: 2. Confirm .env contains: Chutes_api_key=<your key>
type .env

:: 3. Run
npm start
```

Then open <http://localhost:3000>.

Optional environment variables:

```
Chutes_api_key=...              (required)
CHUTES_MODEL=deepseek-ai/DeepSeek-V3.1     (override the default model)
PORT=3000
```

---

## Supported AWS regions

| Code | Region | Country | Native attestations |
|---|---|---|---|
| `ap-southeast-5` | Asia Pacific (Malaysia) | Malaysia | PDPA-MY |
| `ap-southeast-1` | Asia Pacific (Singapore) | Singapore | PDPA-SG |
| `ap-southeast-3` | Asia Pacific (Jakarta) | Indonesia | UU-PDP-ID |
| `ap-southeast-7` | Asia Pacific (Thailand) | Thailand | PDPA-TH |
| `ap-northeast-1` | Asia Pacific (Tokyo) | Japan | APPI-JP |
| `ap-south-1` | Asia Pacific (Mumbai) | India | DPDP-IN |
| `us-east-1` | US East (N. Virginia) | US | HIPAA, SOC 2, FedRAMP-Moderate |
| `eu-west-1` | Europe (Ireland) | EU | GDPR |

## Supported services

EC2, RDS, DynamoDB, S3, EBS, ALB, NAT Gateway, CloudFront, Route 53, Lambda, ElastiCache, EKS,
WAF, Shield, KMS, Backup, DataTransferOut.

---

## Endpoints

- `GET /api/regions` — list of supported regions.
- `POST /api/design` — body: `{ brief, region, compliance? }` → returns `{ profile, arch, priced, compliance, region, markdown, model }`.

---

## Output

The downloadable `.md` plan contains:

1. Executive summary & original brief
2. Extracted workload profile
3. **Mermaid AWS architecture diagram**
4. Component inventory with tier, role, specs, region, and per-component monthly cost
5. **Itemized monthly bill** with budget-vs-actual delta
6. Data-residency & compliance check (✅ / ❌)
7. HA + scaling + security narrative
8. Validation notes (region fallbacks, dropped services)
9. Assumptions
10. Recommended next steps

---

## Why is the bill trustworthy?

Because the LLM never sees a price. It only emits a structured JSON of which services to use,
which sizes, and how many. The Express server then walks that JSON and bills each component
from a versioned local catalog of public AWS list prices. Run the same brief twice and you get
the same number.
