# FRAUD COMMAND — Implementation State

**Recorded:** 2026-09-22  
**Current phase:** final submission audit complete; remediation required  
**Status:** **BLOCKED — live Savanna MCP graph authorization HTTP 403 prevents repeat writeback/idempotency verification; GraphRAG remains unimplemented.**

## Verified foundations

- `FraudCommand` schema v1 is live with 13 vertex types and 24 edge types.
- Bounded Stage 1 ingestion is live and idempotency-tested; it is not full benchmark-data ingestion.
- Controlled installed GSQL tools exist: `getTransactionContext`, `getTransactionRelationshipContext`, `getGraphValidationCounts`, and `findRelatedCases`.
- TigerGraph MCP connectivity is live verified. `uvx tigergraph-mcp` listed exactly `FraudCommand`.
- Existing local temporal, GSQL-source, Commander, specialist, policy, and staged-ingestion tests pass.

## Verified MCP runtime integration

- A typed `LiveTigerGraphMcpCommanderToolClient` invokes only the fixed installed-query allowlist through `tigergraph__run_installed_query`; it cannot submit GSQL.
- UI and benchmark graph modes are explicit: `live` uses MCP; `deterministic` uses a generic test client. Live mode has no mock fallback.
- Application-level path `InvestigationService → Commander → MCP → TigerGraph` passed for staged transaction `3000183`, producing three TigerGraph evidence items through the planned fixed tools.
- Temporal live checks passed through the application adapter:
  - `3000001` at `2016-07-02 00:02:22`: eligible context returned.
  - `3000001` at `2016-07-02 00:02:20`: `future_transaction` returned.
  - `3000120` at `2016-07-02 01:17:27`: pre-closure KnownCard excluded.
  - `3000183` at `2016-07-04 02:10:21`: eligible KnownCard and BillingRegion returned.
- The controlled MCP InvestigationCase test record `MCP_LIVE_VALIDATION_3000183` was written, read back, and written again with the same deterministic ID. Idempotency passed.

## 20-case coverage gate

The canonical 20 case-pack transaction contexts have been loaded through the reviewed existing staged-ingestion architecture. Live MCP coverage is 20/20 with zero query errors. The second identical ingestion left live graph counts unchanged. The live benchmark completed 20/20 in explicit `--mode=live` with no execution errors.

The final audit remains responsible for full evidence-to-case writeback for all 20 cases, official-output regeneration/validation, and a clean browser E2E run. These are not claimed complete merely because graph coverage and the live benchmark now pass.

## Latest commands

```text
npm.cmd run typecheck                     PASS
npm.cmd test                              PASS
python tests/staged-ingestion.test.py     PASS
npm.cmd run verify:live-mcp-reads         PASS
npm.cmd run verify:live-mcp-commander     PASS
npm.cmd run verify:live-mcp-writeback     PASS
npm.cmd run verify:live-benchmark-coverage PASS (20/20)
npm.cmd run benchmark -- --mode=live      PASS (20/20)
```

## Final-audit evidence and next exact action

- A first live output/writeback pass completed for HHG-001 through HHG-020. `benchmark/final/live-official-output-summary.json` records three live evidence items and a successful writer result for every case.
- Official output validation passed 20/20 and the browser E2E passed using the explicit live server on port 3101.
- A required repeat writeback pass and the post-write live read regression then failed because MCP graph operations returned HTTP 403 (`Forbidden`). This means durable graph persistence and duplicate-edge absence cannot be certified.
- `docs/FINAL_SUBMISSION_AUDIT.md` records the final factual compliance assessment, including the unimplemented GraphRAG requirement.

**Next exact action:** restore the active Savanna secret/permission path that permits MCP graph reads and mutations, rerun the temporal regression, then rerun the controlled repeat 20-case writeback and read-only relationship verification. Do not use a mock fallback.
