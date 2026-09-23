# TigerGraph 20-Case Live Coverage Report

**Recorded:** 2026-09-22  
**Status:** **LIVE TIGERGRAPH + 20 CASE COVERAGE VERIFIED — PROCEED TO FINAL AUDIT**

## Previous coverage

The original bounded Stage 1 load contained 39 live `Transaction` vertices. None of the 20 official case-pack transaction IDs was in that selection. A live MCP context query for `3514030` therefore failed before this gate.

## Canonical source and minimum ingestion

`HHGOA_IEEE/case_pack.csv` supplies the 20 official investigation inputs. Each transaction was found in canonical `HHGOA_IEEE/transactions.csv`; matching identity data was selected from `HHGOA_IEEE/identity.csv` by `TransactionID`.

No benchmark transaction appears in `closed_cases_history.csv`. No `ClosedCase`, `KnownCard`, outcome, fraud pattern, expected answer, or extra surrounding transaction was added by this coverage ingestion. This preserved the existing historical-query boundary instead of manufacturing case-memory evidence.

The existing `scripts/staged_ingestion.py` was extended with an explicit `--benchmark-case-pack` selection input. The reviewed artifact selected exactly 20 transactions and 14 matching identity records, with no rejections.

## Live ingestion and counts

The controlled MCP executor accepted only the generated coverage artifact. A first attempt exposed a concrete Savanna MCP condition: the fresh GSQL session required `USE GRAPH FraudCommand`. The executor now prefixes that fixed selection and rejects embedded GSQL error text rather than treating MCP transport success as data success.

| Graph element | Before effective ingest | After first effective ingest | After identical repeat |
| --- | ---: | ---: | ---: |
| Customer | 28 | 46 | 46 |
| CardProfile | 29 | 47 | 47 |
| Transaction | 39 | 59 | 59 |
| DeviceProfile | 8 | 22 | 22 |
| EmailDomain | 6 | 11 | 11 |
| BillingRegion | 17 | 24 | 24 |
| MADE edges | 39 | 59 | 59 |
| FROM_DEVICE edges | 11 | 25 | 25 |
| PURCHASER_EMAIL edges | 30 | 47 | 47 |
| RECIPIENT_EMAIL edges | 8 | 22 | 22 |
| BILLED_IN edges | 29 | 43 | 43 |

The unchanged repeat counts verify idempotency. Existing `Transaction` and historical `ClosedCase` data were not modified.

## Live coverage result

The read-only MCP coverage verifier ran `getTransactionContext` and `getTransactionRelationshipContext` for every official input/cutoff pair. Its saved evidence is `artifacts/benchmark_coverage_ingestion/live_coverage.json`.

```text
contexts available: 20 / 20
query errors:        0
```

Every case returned one card profile. Device, email, billing-region, KnownCard, and historical-case results vary according to actual source availability. Their absence was retained as absence; it was not interpreted as a tool failure or filled with synthetic data.

## Temporal regression

The established live MCP temporal suite passed after ingestion:

- `3000001` remains visible at `2016-07-02 00:02:22`.
- `3000001` remains `future_transaction` at `2016-07-02 00:02:20`.
- `3000120` at `2016-07-02 01:17:27` still excludes future KnownCard evidence.
- `3000183` at `2016-07-04 02:10:21` still returns its historically eligible KnownCard and BillingRegion.

This retains `Transaction.occurred_at <= cutoff` and `ClosedCase.closed_at < cutoff` semantics.

## Live Commander and benchmark

The earlier single live Commander path remained verified. The 20-case benchmark then ran through explicit `--mode=live` using `LiveTigerGraphMcpCommanderToolClient`; its output is `benchmark/final/results-live.json`.

```text
mode: LIVE
cases processed: 20 / 20
execution errors: 0
average latency: 17,112.20 ms/case
```

The run used the fixed MCP query allowlist. It did not fall back to mocks.

## UI/API check

An HTTP request to the already-running local API for `HHG-001` returned HTTP 200, transaction `3514030`, three tool calls, and three evidence items. A separate controlled server launch could not bind port 3000 because that port was already occupied. This is an API-path smoke result, not a clean independently started browser E2E result.

## Writeback and official outputs

The prior controlled MCP InvestigationCase writeback/idempotency test remains valid. This gate did not write 20 final InvestigationCase records or regenerate official output files, because the current live benchmark result contract does not expose an evidence-to-case persistence payload or an evidence-backed final `fraud_probability`; inventing either would violate the evidence rule.

`written_to_graph` therefore remains governed by actual write status. Full 20-case case/evidence persistence and official-output regeneration are required work for the final audit, not assumed success from this coverage result.

## Tests

```text
npm.cmd run typecheck                     PASS
npm.cmd test                              PASS
python tests/staged-ingestion.test.py     PASS
python tests/tigergraph-query-source.test.py PASS
npm.cmd run verify:live-mcp-reads         PASS
npm.cmd run verify:live-benchmark-coverage PASS
npm.cmd run benchmark -- --mode=live      PASS (20/20)
```

## Files introduced or changed

- `docs/BENCHMARK_GRAPH_COVERAGE_AUDIT.md`
- `scripts/staged_ingestion.py`
- `tests/staged-ingestion.test.py`
- `scripts/execute_staged_ingestion_mcp.ts`
- `scripts/verify_live_benchmark_coverage.ts`
- `scripts/run_benchmark.ts`
- `package.json`
- `artifacts/benchmark_coverage_ingestion/`

## Remaining limitations

The graph now supports all 20 official transaction contexts and the live benchmark. The next final-audit work is to extend the benchmark output contract so that completed case writeback includes actual evidence records and a non-fabricated final decision field, then verify the 20 case/evidence writes, official output regeneration, validator result, and a clean browser E2E run.
