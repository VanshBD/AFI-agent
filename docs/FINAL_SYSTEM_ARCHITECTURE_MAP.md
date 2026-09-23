# FRAUD COMMAND — Final System Architecture Map (As Audited)

**Recorded:** 2026-09-22  
**Scope:** actual repository implementation; not a target-state design.

## Entry points

| Flow | Actual entry point | Runtime dependency | Audit status |
| --- | --- | --- | --- |
| Deterministic benchmark | `scripts/run_benchmark.ts` | HHGOA case pack and an in-process mock tool client | Runs locally; not live TigerGraph |
| Official JSON generation | `scripts/generate_official_answers.ts` | extracted local context, historical CSV, deterministic Commander, optional live writeback | Generates/validates JSON; live writeback blocked |
| UI/API | `scripts/serve_ui.ts` | Node HTTP server and in-process mock tool client | Local HTTP smoke test passed; not live TigerGraph |
| Stage 1 ingestion | `scripts/staged_ingestion.py` | generated GSQL and authenticated GraphStudio | previously live-verified bounded ingestion |
| Live controlled queries | `tigergraph/queries/*.gsql` | FraudCommand Savanna graph | partly documented live verification; unavailable during this audit |

## Actual investigation flow

```text
Benchmark trigger / UI case selection
  -> InvestigationService (`packages/domain/src/investigation-service.ts`)
  -> InvestigationState with cutoff (`investigation-state.ts`)
  -> CommanderOrchestrator (`commander.ts`)
  -> fixed tool names via Tool Registry (`tool-registry.ts`)
  -> supplied CommanderToolClient
      -> local mock in benchmark/UI, or test mock in unit/E2E tests
      -> live REST++ adapter is not implemented as a CommanderToolClient
  -> Evidence Ledger (`evidence-ledger.ts`)
  -> Graph / Transaction / DeviceIdentity / Behavior / CaseMemory hunters
  -> hypotheses, Prosecutor/Defense, contradictions
  -> Decision Sensitivity + Evidence Value
  -> Next-Best-Action / policy routing (`next-best-action.ts`)
  -> InvestigationService response or official JSON
```

## Controlled live graph layer

| Component | Source |
| --- | --- |
| Schema | `tigergraph/schema/fraud_command_v1.gsql` |
| Context query | `tigergraph/queries/get_transaction_context.gsql` |
| Relationship query | `tigergraph/queries/get_transaction_relationship_context.gsql` |
| Historical case query | `tigergraph/queries/find_related_cases.gsql` |
| Count query | `tigergraph/queries/get_graph_validation_counts.gsql` |
| Typed local input guard | `packages/tigergraph/src/read-tool-contracts.ts` |

The GSQL source layer is allowlisted and locally source-tested. It is not wired to the benchmark runner or UI server through a production REST++ client.

## Data and output flow

```text
HHGOA_IEEE/case_pack.csv -> benchmark runner / UI case list
HHGOA_IEEE transactions + identity extracts -> benchmark/final/extracted_contexts.json
HHGOA_IEEE closed_cases_history.csv -> official answer generator historical filter
generated deterministic result -> benchmark/final/results.json
official answer generator -> cases/HHG-001.json ... HHG-020.json
optional writeback -> TigerGraph REST++ (currently HTTP 400; all case JSON flags are false)
```

## Explicit non-implemented or unverified links

- No Supabase, Redis, or GraphRAG runtime exists in this repository.
- No TigerGraph MCP runtime exists in this repository.
- `GroqModelGateway` architecture exists in `model-gateway.ts`, but no live model call was audited.
- No live CommanderToolClient adapter invokes installed TigerGraph queries.
- No browser automation/E2E test of a rendered UI was found; the E2E test is an in-process mocked pipeline test.
