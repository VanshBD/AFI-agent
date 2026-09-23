# TigerGraph MCP Live Integration Report

**Recorded:** 2026-09-22  
**Final status:** **BLOCKED — LIVE TIGERGRAPH RUNTIME INCOMPLETE**

## Previous and new runtime paths

Previously UI and benchmark runtime injected transaction-specific mock graph clients. The new live path is:

```text
InvestigationService → CommanderOrchestrator → ToolRegistry
→ LiveTigerGraphMcpCommanderToolClient → tigergraph-mcp (stdio)
→ FraudCommand installed query → validated TigerGraph result
→ Evidence Ledger → specialists / NBA / authorization
```

`AFI_RUNTIME_MODE` is mandatory for the UI. `live` selects MCP, while `deterministic` explicitly selects a generic offline client. There is no live-to-mock fallback.

## Actual MCP capability discovery

Live MCP listed exactly `FraudCommand`. Discovered read capabilities include graph/schema inspection, installed query metadata, `tigergraph__run_installed_query`, and graph reads. The server also exposes controlled mutations: `tigergraph__add_node`, `tigergraph__add_edge`, and `tigergraph__get_node`.

Commander can use only fixed installed queries: `getTransactionContext`, `getTransactionRelationshipContext`, `findRelatedCases`, and `getGraphValidationCounts`. It has no raw-GSQL or generic MCP execution capability.

## Live reads and temporal safety

These results came through the application MCP adapter.

| Fixture | Actual result |
| --- | --- |
| `3000001`, `2016-07-02 00:02:22` | Eligible transaction context returned. |
| `3000001`, `2016-07-02 00:02:20` | `future_transaction` returned. |
| `3000120`, `2016-07-02 01:17:27` | KnownCard correctly excluded before historical closure. |
| `3000183`, `2016-07-04 02:10:21` | Eligible KnownCard and BillingRegion returned. |
| Commander case for `3000183` | All three planned fixed tools ran; three `tigergraph_tool` Evidence Ledger items were produced. |

Each adapter result contains source `TigerGraph`, fixed MCP tool/query identity, graph name, request ID, immutable cutoff, query-enforced temporal status, and latency. No token or secret is returned, logged, or sent to the UI.

## Controlled writeback

The smallest verified MCP writeback created/read back InvestigationCase `MCP_LIVE_VALIDATION_3000183`, then repeated the same deterministic write. The second write verified idempotency. `scripts/generate_official_answers.ts` now uses this MCP writer; `written_to_graph` remains dependent on actual write success.

This only proves InvestigationCase node persistence. Evidence-node/edge writeback, 20-case writeback, and full official-output regeneration are not claimed.

## Mock-branch audit

Transaction-specific production mock branches were removed from `scripts/serve_ui.ts` and `scripts/run_benchmark.ts`. Test-only deterministic behavior is generic. Fixed IDs remain solely in dedicated live verification scripts.

## Commands verified

```text
npm.cmd run typecheck                     PASS
npm.cmd test                              PASS
python tests/staged-ingestion.test.py     PASS
npm.cmd run verify:live-mcp-reads         PASS
npm.cmd run verify:live-mcp-commander     PASS
npm.cmd run verify:live-mcp-writeback     PASS
```

## Blocking evidence and next action

The current Stage 1 graph does not contain all 20 benchmark transactions. A real `getTransactionContext` call for first benchmark transaction `3514030` returned a controlled MCP query error. Therefore live 20-case benchmark, official-output validation, and live browser E2E are BLOCKED—not failed by MCP authentication.

Next, complete the approved temporally safe data-coverage ingestion gate; then run `scripts/run_benchmark.ts --mode=live`, verify per-case evidence/writeback, validate official files, and exercise the UI against a live staged benchmark case.
