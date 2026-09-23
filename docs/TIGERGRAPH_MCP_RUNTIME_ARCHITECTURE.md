# TigerGraph MCP Runtime Architecture

## Purpose and boundary

This document records the verified runtime path for live TigerGraph access. It replaces only the graph-client boundary; it does not alter the FraudCommand graph schema, GSQL sources, Commander workflow, or investigation logic.

The application must use one explicitly selected mode:

```text
LIVE
UI → Investigation API → InvestigationService → CommanderOrchestrator
   → CommanderToolClient → LiveTigerGraphMcpCommanderToolClient
   → tigergraph-mcp (stdio) → FraudCommand installed query
   → validated result → Evidence Ledger → investigation result

DETERMINISTIC (tests/offline only)
UI/test harness → explicitly injected DeterministicMockCommanderToolClient
```

There is no live-mode fallback to mock data. If MCP startup, authentication, an allowlisted query, or response validation fails, the request fails with a controlled error.

## Verified MCP connection

On 2026-09-22, a stdio MCP client launched `uvx tigergraph-mcp` with the local server-side `TG_HOST`, `TG_SECRET`, and `TG_GRAPHNAME` environment configuration. The JSON-RPC connection completed and `tigergraph__list_graphs` returned exactly `FraudCommand`.

An additional live read proved the installed-query invocation shape:

```text
tigergraph__run_installed_query
  graph_name: FraudCommand
  query_name: getTransactionContext
  params: { txn, cutoff }
```

The MCP response is textual JSON whose successful payload is under:

```text
data.result → TigerGraph GSQL result array
```

No secret, token, or authorization header is retained in this document.

## Discovered MCP operations

The server exposes graph/schema inspection, installed-query execution, node/edge reads, and mutation operations. Relevant names include:

- Read: `tigergraph__list_graphs`, `tigergraph__get_graph_schema`, `tigergraph__is_query_installed`, `tigergraph__get_query_metadata`, `tigergraph__run_installed_query`, `tigergraph__get_node`, `tigergraph__get_node_edges`, `tigergraph__get_vertex_count`, and `tigergraph__get_edge_count`.
- Controlled mutation capability: `tigergraph__add_node`, `tigergraph__add_edge`, and their batch/delete counterparts.

The server also exposes powerful administrative and GSQL operations. They are expressly **not** available through `CommanderToolClient`.

## Query allowlist and contracts

Commander may request only these repository-owned installed queries:

| Commander tool | MCP operation | Required input |
| --- | --- | --- |
| `getTransactionContext` | `tigergraph__run_installed_query` | `txn`, `cutoff` |
| `getTransactionRelationshipContext` | `tigergraph__run_installed_query` | `txn`, `cutoff` |
| `findRelatedCases` | `tigergraph__run_installed_query` | `txn`, `cutoff` |
| `getGraphValidationCounts` | `tigergraph__run_installed_query` | none |

`ToolRegistry` and `read-tool-contracts.ts` validate IDs, cutoffs, requests, phase eligibility, and the immutable investigation cutoff before the adapter is reached. The adapter independently revalidates the allowlist and response shape. The LLM receives neither raw GSQL nor a generic MCP execution capability.

## Provenance and temporal safety

The adapter sends the validated investigation cutoff unchanged to each temporal query. Its normalized result has the existing GSQL `results` form plus application provenance identifying `source: TigerGraph`, the MCP operation, fixed query identity, graph name, cutoff, request ID, and latency. This metadata is then represented by the existing Evidence Ledger provenance fields. A `future_transaction` GSQL response remains a fact of temporal denial, not a graph fact that can be used as positive evidence.

## Runtime configuration and secrets

Only the server process reads `TG_HOST`, `TG_SECRET`, and `TG_GRAPHNAME`. The adapter passes them only to the MCP child process environment. It does not return child environment, stderr, tokens, or headers to callers. `TG_TGCLOUD` and `TG_SSL_PORT` remain configuration context and are not used to rewrite the verified workspace URL.

## Mutation boundary

Commander reads through the query allowlist only. Any future InvestigationCase/Evidence writeback is a separate, typed, explicitly authorized adapter that can invoke only the smallest required MCP mutation operations with deterministic IDs. It must never mutate source `Transaction` or historical `ClosedCase` records and must be verified separately for idempotency.

## Current validation sequence

1. Unit-test the adapter with an injected MCP transport.
2. Run the established live read/temporal fixtures through the application adapter.
3. Wire the UI and benchmark to an explicit runtime mode and remove case-specific production mock branches.
4. Verify an explicitly controlled writeback only if the mutation contract is implemented and live reads are passing.
5. Run a LIVE benchmark only when all its trigger transactions are staged; otherwise fail loudly and record the coverage blocker.
