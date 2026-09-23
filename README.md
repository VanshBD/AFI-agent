# AFI Agent — TigerGraph Agentic Fraud Investigation Platform
> **TigerGraph × Hacker House Goa 2026** | Autonomous AI Fraud Investigation, Knowledge Graph Traversal & Next-Best Action (NBA) Governance

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![TigerGraph](https://img.shields.io/badge/TigerGraph-Savanna%20Cloud-orange.svg)](https://www.tigergraph.com/)
[![MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-green.svg)](https://modelcontextprotocol.io/)
[![Tests](https://img.shields.io/badge/Tests-14%20Passing-brightgreen.svg)](tests/)

---

## 📌 Overview

**AFI Agent** is an enterprise-grade agentic fraud investigation system built on **TigerGraph**. Designed for tier-1 financial institutions, it replaces manual fraud analysis workflows with an autonomous multi-agent pipeline. 

When an alert is triggered (via ML risk score, customer dispute, or analyst inquiry), AFI Agent:
1. Traverses the live knowledge graph across multiple hops (Customers, Cards, Transactions, Devices, Billing Regions, and Historical Cases).
2. Synthesizes bounded temporal context using **GraphRAG** and runs topological graph algorithms (centrality, bridge detection, and syndicated ring scoring).
3. Pits a **Prosecutor Agent** against a **Defense Agent** to eliminate confirmation bias.
4. Evaluates bank governance policies (Rules R1–R7) to recommend defensible **Next-Best Actions** (`ALLOW`, `DECLINE`, `BLOCK_CARD`, `FILE_REPORT`), with human approval routing (`auto`, `L1`, `L2`).
5. Writes completed investigation cases and evidence idempotently back to the live **TigerGraph Savanna** graph.

---

## 🏛️ System Architecture

```text
       [ Investigation Trigger: ML Score / Customer Dispute / Analyst Request ]
                                      │
                                      ▼
                        [ InvestigationService ]
                                      │
                       [ Commander Orchestrator ]
                                      │
           ┌──────────────────────────┴──────────────────────────┐
           │                     Hunter Agents                   │
           ▼                          ▼                          ▼
  [ TransactionHunter ]        [ GraphHunter ]        [ DeviceIdentityHunter ]
  • Amount, Timestamp          • 2-hop Neighbors      • Device Profiles (DP-*)
  • Merchant Code              • Multi-Card Clusters  • Email Domains (EM-*)
           │                          │                          │
           └──────────────────────────┬──────────────────────────┘
                                      ▼
                          [ CaseMemoryHunter ]
                          • Historical Closed Cases (cutoff enforced)
                          • Recurring Fraud Ring Precedents
                                      │
                                      ▼
                           [ Evidence Ledger ]
                          (Observed Facts vs Model Interpretations)
                                      │
           ┌──────────────────────────┴──────────────────────────┐
           ▼                                                     ▼
 [ Topological Graph Analytics ]                          [ GraphRAG Engine ]
 • Degree Centrality                                    • Bounded Temporal Subgraph
 • Bridge / Shared Telemetry                            • Structured LLM Reasoning
 • Syndicated Ring Scoring
           │                                                     │
           └──────────────────────────┬──────────────────────────┘
                                      ▼
                      [ Adversarial Analysis Pool ]
                       Prosecutor  vs  Defense
                                      │
                                      ▼
                         [ Governance & NBA Engine ]
                         • Bank Policies (R1 to R7)
                         • Dual-stage NBA Lifecycle (Initial ➔ Final)
                         • Human Routing: auto, L1, L2
                         • SAR Filing (Suspicious Activity Report)
                                      │
                                      ▼
                     [ TigerGraph Savanna Writeback ]
                      (CASE-HHG-* and HAS_EVIDENCE)
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v18 or higher
- **Python**: v3.10 or higher
- **uv** (astral.sh package runner for TigerGraph MCP):
  - *Windows (PowerShell)*: `irm https://astral.sh/uv/install.ps1 | iex`
  - *Mac/Linux*: `curl -LsSf https://astral.sh/uv/install.sh | sh`

### 2. Installation
```bash
git clone https://github.com/VanshBD/AFI-agent.git
cd AFI-agent
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env` and configure your TigerGraph Cloud credentials:
```bash
cp .env.example .env
```

```env
TG_HOST=https://tg-4a1174a1-8e0e-4de6-bb2c-8f80dd95acef.tg-2635877100.i.tgcloud.io
TG_GRAPHNAME=FraudCommand
TG_SECRET=<your_tigergraph_secret>
TG_TGCLOUD=true
TG_SSL_PORT=443
GROQ_API_KEY=<your_groq_api_key>
AFI_RUNTIME_MODE=live
```

---

## 🧪 Testing & Validation

### Run Full Test Suite (14 Tests)
```bash
npm test
```
*Covers temporal safety boundaries, TigerGraph read-tool contracts, MCP Commander client, hunter foundation agents, adversarial reasoning, and GSQL query syntax.*

### Validate the 20 Official Benchmark Answers
```bash
npm run validate:official
```
*Validates that all 20 benchmark case outputs in `cases/HHG-*.json` strictly comply with the official Hacker House Goa schema.*

---

## 🖥️ Interactive Command Center UI

Launch the dark-mode analyst dashboard:
```bash
npm start
```
Navigate to **`http://localhost:3000`** in your browser to explore:
- **Trigger Selector**: Inspect any of the 20 benchmark cases (`HHG-001` through `HHG-020`).
- **Interactive SVG Graph**: Real-time visual topology showing linked cards, devices, and billing regions.
- **Evidence Ledger**: Tabular view of observed graph facts, provenance refs, and impact polarity.
- **Adversarial Perspectives**: Side-by-side prosecutor and defense arguments.
- **Next-Best Action (NBA) Lifecycle**: Pre-evidence vs. post-evidence recommendations and regulatory SAR filing status.

---

## 📁 Repository Structure

```text
├── cases/              # Official 20 benchmark answer JSON files (HHG-001 to HHG-020)
├── docs/               # System architecture and compliance audit documentation
├── HHGOA_IEEE/         # Case pack definitions and schemas
├── packages/
│   ├── domain/         # Pure TypeScript agents, hunters, state, and governance engines
│   └── tigergraph/     # Live MCP client, GSQL tool contracts, and writeback adapter
├── scripts/            # CLI utilities, UI server (serve_ui.ts), and benchmark generators
├── tests/              # 14 automated unit, integration, and temporal boundary tests
├── tigergraph/         # GSQL schemas and installed query sources
└── ui/                 # Command Center web dashboard (HTML, CSS, JS)
```

---

## ⚖️ License
MIT License. Built for the TigerGraph × Hacker House Goa Agentic Fraud Investigation Hackathon (2026).
