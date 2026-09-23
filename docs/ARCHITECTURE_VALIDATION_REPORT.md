# FRAUD COMMAND — Architecture Validation Report

**Evidence basis:** hackathon README, full CSV forensic profile, and repository inspection on 2026-09-21. Claims not supported by those sources are marked **NOT VERIFIED**.

## A. Executive Summary

Build one controlled investigation service, not a microservice fleet: deterministic graph tools produce provenance-rich evidence; a bounded Commander evaluates competing hypotheses and policy; an LLM synthesizes only retrieved evidence. The winning differentiator is the Evidence Ledger plus before/after next-best-action (NBA), not agent count.

## B. Official Requirement Matrix

| Requirement | Class | Component | Verification / fallback |
| --- | --- | --- | --- |
| TigerGraph, GSQL, MCP | REQUIRED | controlled graph tool registry | integration test; read-only degraded mode if unavailable |
| GraphRAG | REQUIRED | policy/pattern/case retrieval | direct policy retrieval plus analyst escalation |
| UI | REQUIRED | analyst command center | demo E2E test |
| cases, memory, explainability, NBA | REQUIRED | case store, ledger, policy engine | answer-schema validation |
| graph algorithms | REQUIRED where useful | evaluate components/community metrics | omit any algorithm without benchmark value |
| multi-agent specialization | STRONGLY RECOMMENDED | bounded specialist passes | begin as modules, split only if measured |
| Supabase / Redis | OPTIONAL | state / cache | no adoption until a verified need |

## C. Dataset Forensics

Transactions: 590,742 valid rows, 397 columns, unique IDs, 13,553 customers. Identity: 144,432 valid one-to-one transaction joins with no orphans. Closed history: 5,565 unique cases (4,665 confirmed fraud, 900 cleared). Case pack: 20 valid triggers. Details are in `DATA_DICTIONARY.md`.

## D. Dataset Schema

Use `transactions.csv` as the fact table, joined to optional `identity.csv` by `TransactionID`. Use supplied `customer_id` as customer identity; use supplied `card_id` only where available in cases. Raw `card1`–`card6` are attributes, not a stable primary key: 42 historical business card IDs had multiple observed raw fingerprints. See the data dictionary for every field group.

## E. Benchmark Case Structure

Twenty November/December alerts: 11 risk-score, 8 customer-report, 1 analyst-request. Each required JSON must contain case, SAR, evidence requests, initial/final NBA, stop reason, and execution metrics exactly as specified by the README. The answer key is unavailable.

## F. Leakage Analysis

For case cutoff `opened_at`, permit transactions/identity where `ts <= opened_at`; historical cases only where `closed_at < opened_at`; derived profiles, aggregates, embeddings, and graph edges must be cutoff-built. Prohibit outcome/pattern/notes for open or future cases, future transactions, benchmark answer material, and public IEEE/Kaggle outcome recovery. Case-pack input itself carries no labels.

## G. Fraud Pattern Analysis

Documented patterns: card testing, card-not-present (CNP), CNP from new device, out-of-region use, and account takeover; undocumented is valid. History distribution is CNP 1,404, out-of-region 955, ATO 1,205, CNP-new-device 1,076, card-testing 16, undocumented 9, cleared/none 900. Policy rules, not historical frequency, govern actions.

## H. TigerGraph Schema

Minimum vertices: `Customer`, `Card`, `Transaction`, `DeviceProfile`, `EmailDomain`, `BillingRegion`, `ClosedCase`, `InvestigationCase`, `Evidence`, `PolicyRule`. Minimum edges: OWNS, MADE, FROM_DEVICE, PURCHASER_EMAIL, BILLED_IN, NEXT, INVOLVES, ON_CARD, CONNECTED_TO, HAS_EVIDENCE, GOVERNED_BY. Use transaction `ts` on facts/edges. Card mapping must be explicitly versioned and validated during ingestion.

## I. GSQL Investigation Tool Catalogue

Start with `getTransactionContext`, `getCustomerTimeline(cutoff)`, `getDeviceNeighbors(cutoff)`, `getBillingRegionNeighbors(cutoff)`, `findVelocitySequence`, `findRelatedCases(cutoff)`, `writeCase`, and `updateCase`. Inputs and outputs require schemas, cutoff, request ID, timeout, evidence references, and least privilege. Add clusters/similarity only after an ablation proves value.

## J. TigerGraph MCP Architecture

Commander → typed Tool Registry → permission guard → TigerGraph MCP → parameterized GSQL → structured result → Evidence Ledger. Read, case-write, and admin identities are separate. The LLM cannot submit arbitrary GSQL.

## K. GraphRAG Architecture

Index policy sections, documented typologies, regulatory references if acquired, and historical case notes as data. Retrieve by investigation need and temporal eligibility; attach source chunk IDs to evidence. Structured graph results remain separate from text retrieval until evidence synthesis.

## L. Evidence Ledger Specification

Evidence requires ID, case ID, source/type, tool/query reference, entity IDs, event timestamp, normalized claim, quality, supports/contradicts hypothesis IDs, decision impact, provenance, and creation time. Final factual claims must resolve to ledger entries.

## M. Commander State Machine

Bounded states: CREATED → CONTEXT → HYPOTHESES → PLAN → INVESTIGATE → LEDGER → CONTRADICTIONS → DECISION-GAP → REQUEST/REASSESS or READY → POLICY → AUTHORIZATION → CASE/MEMORY → CLOSED. Each transition logs event, input snapshot, allowed retry, and maximum budget. Terminal fallback is escalation.

## N. Multi-Agent Architecture

Use Commander plus deterministic Graph, Transaction, Device/Identity, Behavior, and Memory specialist passes. Prosecutor and Defense are opposing structured analyses, not free-form agent chats. Run only selected specialists; do not require eight model calls.

## O. Hypothesis Engine

Maintain dataset-derived hypotheses: five documented patterns, undocumented coordinated abuse, and legitimate unusual activity. Track supporting/contradicting evidence, unanswered questions, confidence band, and action impact; never present fabricated precision.

## P. Prosecutor / Defense Architecture

Prosecutor seeks pattern evidence; Defense seeks normal recurrence, travel/legitimate explanations, weak attribution, and missing expected signals. Both return typed `AgentResult`; the Commander cannot close a material conflict silently.

## Q. Contradiction Engine

Flag direct, contextual, temporal, identity, stale-source, source-disagreement, and missing-expected-evidence contradictions. Example: a shared region is weak when normal customer travel supports it. Material unresolved conflict routes to R8 escalation.

## R. Decision Sensitivity Engine

Represent action-changing unknowns explicitly: e.g., customer denial changes verify/monitor to block/create case; confirmation changes to close legitimate. Do not request evidence that cannot alter a policy-permitted action.

## S. Evidence Value Engine

Use transparent ordinal scoring: relevance, hypothesis discrimination, decision impact, availability, latency, customer friction, and policy permission. Validate each added request against decision impact; no fake EVI mathematics.

## T. Investigation Budget

Versioned configurable limits: iterations, tools, specialist/model calls, evidence requests, latency, and cost. On exhaustion, emit a defensible partial case and escalate when policy requires.

## U. Intelligent Stopping

Stop at policy thresholds (>=0.85 or <=0.15 with two independent evidence pieces), settled verification, immaterial remaining uncertainty, or exhausted budget. Record evidence, uncertainty, and why further work lacks value.

## V. Next-Best-Action Engine

Deterministically map validated evidence, exposure, policy rules, and approval route into ordered actions. Output both initial and post-response NBA; LLM explains the mapping but cannot choose an unauthorized action.

## W. Policy / Authorization Engine

Encode R1–R10 and exact action/route identifiers as versioned deterministic rules. Recommendation, policy decision, approval, and simulated execution remain separate. Only `auto` may execute; L1/L2 wait for people.

## X. Case Management

The case record follows the supplied answer schema and adds state transitions, hypotheses, ledger IDs, contradictions, tool calls, approvals, and replay metadata. Write case vertices only through authorized tools.

## Y. Case Memory

Retrieve historical closed cases only with temporal eligibility. Store concluded benchmark investigations separately from benchmark inputs to prevent cross-run contamination. Historical similarity is evidence, not a verdict.

## Z. Outcome Feedback

Link recommendation → approval → action → confirmed outcome where supplied. Benchmark predictions are not converted into truth labels.

## AA. Counterfactual Evidence Evaluation

Re-evaluate final policy action without an evidence item and classify it decision-critical, supporting, redundant, or contradictory. This is a post-decision audit, not causal proof.

## AB. ModelGateway

Expose provider-neutral structured generation, classification, summarization, health, retries, and usage accounting. No provider has been selected or configured: **NOT VERIFIED**.

## AC. Groq/Gemini Provider Strategy

Route cheap structured extraction/tool planning separately from complex evidence synthesis; benchmark provider/model choices. A single provider/key must work. Pools are reliability mechanisms, never quota bypasses.

## AD. Redis Architecture

Do not add initially. Adopt only if measured need for locks, queueing, or short-lived result caching appears.

## AE. Supabase Architecture

Do not add initially. Adopt only when relational analyst state/audit persistence cannot be safely handled by the selected application store.

## AF. Security Architecture

Treat transactions, notes, documents, and external sources as data. Validate all tool and model contracts; deny arbitrary GSQL/writes; isolate credentials; redact logs; partition cases by ID/cutoff; preserve audit records.

## AG. Failure Recovery

Tool/graph: retry boundedly then safe escalation. Model: repair/retry, alternative provider, then deterministic policy/action path. GraphRAG: direct policy section fallback. Missing evidence: record it, request permitted evidence, or escalate.

## AH. Observability

Record case/state/tool/model latency, token/provider usage, retries, evidence count, policy blocks, approvals, stop reason, decision flips, and graph query IDs. Use structured logs first; add OTel only after integration need is verified.

## AI. Frontend Architecture

One analyst command center: case queue, graph, evidence ledger, hypotheses/contradictions, timeline, NBA/policy/approval, similar cases, and replay trace. No chain-of-thought display; show source-grounded rationale.

## AJ. Benchmark Framework

A cutoff-aware runner must produce one schema-validated JSON per case, isolate output folders by run/version, and capture metrics. It must not use answer keys or future data.

## AK. Evaluation Metrics

Measure answer validity, evidence traceability, policy/route correctness, action accuracy when scoring becomes available, before/after NBA quality, tool efficiency, latency, cost, failure recovery, calibration, and reproducibility.

## AL. Baselines

Compare deterministic-policy + raw trigger, graph context, graph+GraphRAG, and full ledger/state-machine system on the same cutoff snapshots. No claim of superiority before runs.

## AM. Ablation Tests

Remove ledger, defense pass, contradiction checks, memory, GraphRAG, decision sensitivity, and graph tools one at a time. Retain a component only for measured accuracy, reliability, explainability, or judge-visible value.

## AN. Red-Team Plan

Test missing identity, stale/future edges, misleading cleared history, high-risk legitimate cases, low-risk coordinated cases, malformed model output, prompt injection, graph outage, policy conflict, unauthorized writes, and benchmark reuse.

## AO. Repository Structure

Begin compactly: `apps/api`, `apps/web`, `packages/domain`, `packages/investigation`, `packages/tigergraph`, `packages/evaluation`, `tigergraph/{schema,gsql}`, `benchmark/{leakage-audit,results}`, `docs`, `scripts`, `tests`. Create a directory only when its first implementation requires it.

## AP. ADR List

ADR-001 cutoff-first investigation; ADR-002 deterministic graph registry; ADR-003 ledger as factual boundary; ADR-004 policy separate from reasoning; ADR-005 start modular, not distributed; ADR-006 no Redis/Supabase until measured; ADR-007 card identity mapping validation.

## AQ. Implementation Roadmap

0 forensics/leakage; 1 domain contracts and cutoff guard; 2 graph schema/ingestion; 3 GSQL tools; 4 MCP; 5 ledger/state machine; 6 specialists/hypotheses; 7 policy/NBA; 8 GraphRAG/memory; 9 gateway; 10 benchmark; 11 UI/observability/demo.

## AR. Phase-by-Phase Quality Gates

Each phase requires typed contracts, tests, runtime inspection, documented fallback, and a relevant benchmark/replay check. Graph phases additionally require measured row/edge counts and GSQL result validation.

## AS. Demo Strategy

Use one representative case: trigger → cutoff graph context → competing hypotheses → ledger/contradiction → justified verification simulation → changed/stable NBA → policy route → case memory. Demo only verified behavior.

## AT. Submission Checklist

20 answer JSON files; graph-written case records; SARs where policy requires; reproducible runner/results; repository; 3–5 minute video; technical blog; social post. All remain unimplemented.

## AU. Risks and Weaknesses

No TigerGraph instance, MCP configuration, model credentials, application code, or answer key is currently supplied. Device identity is sparse; raw card fingerprints vary; narrative notes can contain untrusted content; benchmark feedback may be limited.

## AV. Overengineering Risks

Avoid early microservices, vector embeddings for every transaction, GNNs, probabilistic machinery, Redis/Supabase, and multiple autonomous agents. None has benchmark evidence yet.

## AW. Missing Requirements

The dataset provides regulatory links but not downloaded regulatory files. TigerGraph credentials and service endpoint are missing. Provider credentials and the Task 1 report itself were absent; this report replaces the latter.

## AX. Final Recommended Architecture

Triggers → cutoff guard → Commander state machine → typed graph/policy/retrieval tools → Evidence Ledger → hypothesis/defense/contradiction → sensitivity/value/stopping → NBA → policy/authorization → case/memory/replay → UI and benchmark runner.

## AY. Architecture Alternatives Considered

Generic RAG chatbot: rejected, no deterministic evidence boundary. Unrestricted LLM-generated GSQL: rejected, unsafe and irreproducible. Full multi-agent swarm: deferred, no measured benefit. Graph-only rules: insufficient for narrative synthesis and ambiguous evidence.

## AZ. FINAL GO / NO-GO ASSESSMENT

**GO for Phase 1.** Dataset and benchmark input are structurally validated; leakage controls are specified. **NO-GO for graph ingestion or provider work** until a TigerGraph instance/MCP credentials and selected runtime are available. Phase 1 can safely implement domain contracts and temporal controls without them.
