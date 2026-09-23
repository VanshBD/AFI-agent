# Phase 2C — Baseline Inspection Report

**Date of Inspection:** 2026-09-22  
**Phase:** 2C (Final Product, Analyst Command Center UI, E2E Validation, Submission Readiness)  
**Status:** BACKEND BASELINE FROZEN AND FULLY VERIFIED (`LIVE_PASS` on TigerGraph Savanna Cloud, 13/13 tests pass, 20/20 benchmark evaluated).

---

## 1. Existing Repository Inventory & Frontend Status

- **Root Directory Structure:**
  - `packages/domain/`: Pure TypeScript domain engine (Commander, Evidence Ledger, 5 Specialist Hunters, Hypotheses, Decision Sensitivity, Evidence Value, Prosecutor/Defense, Contradiction Engine, Policy/NBA, ModelGateway).
  - `packages/tigergraph/`: Read-tool contracts and token/provenance validators.
  - `tigergraph/`: Formal schema DDL (`schema.gsql`) and 4 allowlisted queries in SYNTAX v2.
  - `HHGOA_IEEE/`: 590K transaction dataset, identity join, closed cases, case pack.
  - `tests/`: 13 test suites covering temporal boundaries, contracts, all 5 specialists, interaction, evidence value, prosecutor/defense, NBA policy, query sources, and staged ingestion.
  - `scripts/`: Staged ingestion, dataset forensics, and 20-case benchmark runner.
  - `benchmark/final/`: Structured machine-readable results (`results.json`).
  - `docs/`: Complete engineering documentation from Phase 0 to Milestone 6 and TigerGraph live verification.
- **Frontend Status:**
  - Currently **no UI directory exists**.
  - All operations are currently executed headless via TypeScript/Node.js scripts.

---

## 2. Reusable Domain Contracts & API Surface

The backend provides complete structured data structures ready for UI consumption:
- `InvestigationState` ([`investigation-state.ts`](file:///c:/Users/Vansh%20Dobariya/OneDrive/Desktop/Work-Stuff/HackathonProjects/AFI-agent/packages/domain/src/investigation-state.ts)):
  - Header: `investigationId`, `triggerId`, `flaggedTransactionId`, `customerId`, `cardId`, `investigationCutoff`, `riskScore`, `status`, `currentPhase`.
  - Evidence references: `evidenceIds`, `toolCallIds`, `unresolvedQuestions`, `requestedEvidence`.
  - Contradictions: `contradictions` with conflicting evidence IDs, status, and resolution rationale.
  - Decision: `continuationDecision`, `nextBestAction` with action type, approval required (`auto`, `L1`, `L2`), and rationale.
- `EvidenceItem` ([`evidence-ledger.ts`](file:///c:/Users/Vansh%20Dobariya/OneDrive/Desktop/Work-Stuff/HackathonProjects/AFI-agent/packages/domain/src/evidence-ledger.ts)):
  - Categories: `observed_fact` vs `model_interpretation`.
  - Provenance: `queryOrSourceRef`, `requestId`, `executionTimestamp`.
  - Polarity: `supports`, `contradicts`, `neutral`, `unresolved`.
- `CommanderStepResult` ([`commander.ts`](file:///c:/Users/Vansh%20Dobariya/OneDrive/Desktop/Work-Stuff/HackathonProjects/AFI-agent/packages/domain/src/commander.ts)):
  - Specialist findings from all 5 hunters.
  - Competing hypotheses pool.
  - `decisionSensitivities` ([`decision-sensitivity.ts`](file:///c:/Users/Vansh%20Dobariya/OneDrive/Desktop/Work-Stuff/HackathonProjects/AFI-agent/packages/domain/src/decision-sensitivity.ts)).
  - `evidenceValueResult` ([`evidence-value.ts`](file:///c:/Users/Vansh%20Dobariya/OneDrive/Desktop/Work-Stuff/HackathonProjects/AFI-agent/packages/domain/src/evidence-value.ts)).
  - `adversarialResult` ([`prosecutor-defense.ts`](file:///c:/Users/Vansh%20Dobariya/OneDrive/Desktop/Work-Stuff/HackathonProjects/AFI-agent/packages/domain/src/prosecutor-defense.ts)).
  - `policyResult` ([`next-best-action.ts`](file:///c:/Users/Vansh%20Dobariya/OneDrive/Desktop/Work-Stuff/HackathonProjects/AFI-agent/packages/domain/src/next-best-action.ts)).

---

## 3. Technology Path for Phase 2C UI

In strict compliance with engineering rules:
- **No new heavyweight frameworks or servers required**:
  - We can construct a lightweight, high-performance web dashboard application using Node's built-in HTTP server or a minimal static bundle with Vanilla CSS/JS that directly runs the backend engine or serves the live investigation API.
  - A lightweight local HTTP server (`server.ts` or `scripts/serve_ui.ts`) serves the Analyst Command Center frontend and exposes:
    - `GET /api/cases`: Returns selectable cases from `HHGOA_IEEE/case_pack.csv`.
    - `POST /api/investigate`: Runs the real `CommanderOrchestrator` pipeline on the selected case, returning the full structured investigation record.
    - `GET /api/benchmark`: Returns the 20-case benchmark metrics.
- **Frontend Architecture**:
  - High-aesthetic Vanilla CSS + HTML5 + modern modular JavaScript.
  - Real SVG/Canvas Interactive Graph visualization displaying entities (Customer, Card, Transaction, Device, Email, BillingRegion, KnownCard, ClosedCase) directly from TigerGraph query observations.
  - Zero arbitrary external dependencies.

---

## 4. Required Phase 2C Deliverables

1. **Analyst Command Center UI** (`ui/`):
   - Header, Pipeline Phase Stepper, Interactive Graph, Evidence Ledger (filterable), Hypotheses Matrix, Prosecutor vs Defense panels, Contradictions, Decision Sensitivity, Evidence Value queue, NBA & Authorization Routing modal/panel, and Audit Timeline.
2. **Backend API Bridge**:
   - Clean, lightweight bridge allowing browser interaction with the existing `CommanderOrchestrator`.
3. **E2E Browser Validation**:
   - Automated browser test validating end-to-end case inspection, graph rendering, adversarial analysis, and authorization status.
4. **Final Regression & Freeze**:
   - Ensure all existing backend tests pass without modification.
