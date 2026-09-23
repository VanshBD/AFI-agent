# FRAUD COMMAND — TigerGraph Live Integration Final Report

**Recorded:** 2026-09-22  
**Status:** **BLOCKED — LIVE TIGERGRAPH INTEGRATION STILL FAILING**

## 1. Previous runtime path

The UI (`scripts/serve_ui.ts`) and deterministic benchmark (`scripts/run_benchmark.ts`) inject local mock `CommanderToolClient` implementations. Commander itself uses typed contracts and the controlled tool registry, but no production client connects it to installed TigerGraph queries.

## 2. Root cause investigation for HTTP 400

The configured Cloud host was contacted using token-only calls. No secret, token, URL query string, or response body is reproduced here.

| Endpoint / form | HTTP result |
| --- | ---: |
| `POST /restpp/requesttoken`, JSON secret/graph/lifetime | 400 |
| `GET /restpp/requesttoken`, documented secret parameters | 400 |
| `POST /restpp/requesttoken`, legacy raw secret | 400 |
| `POST /requesttoken`, JSON secret/graph/lifetime | 404 |

The REST++ route exists, but the service rejects every supported token form with a non-JSON HTTP 400 response. This points to a current secret/workspace/REST++ authentication configuration problem. It is not safe to guess a different credential, rotate secrets blindly, or route to mock data.

## 3. Authentication fix

**Not applied.** The required external correction is to verify in Savanna/GraphStudio that the local ignored secret is current and permitted for the active database’s REST++ token generation. Once that is confirmed, repeat only the documented JSON POST token request before making writes.

## 4. Live adapter

**Not implemented.** The required live adapter must not be enabled until token authentication is proven. Implementing it now would create an untestable production path and violate the no-silent-fallback rule.

## 5. Query contract mapping

The intended fixed read allowlist remains:

- `getTransactionContext(txn, cutoff)`
- `getTransactionRelationshipContext(txn, cutoff)`
- `findRelatedCases(txn, cutoff)`
- `getGraphValidationCounts()` (validation only)

All have existing source/query contracts. No arbitrary GSQL was submitted in this remediation attempt.

## 6. Mock separation and transaction-specific audit

Verified defects remain:

- UI and benchmark runtime paths inject mock graph clients.
- `scripts/run_benchmark.ts` and `scripts/serve_ui.ts` include transaction-specific mock branches.

They were not removed in this turn because live authentication is a hard prerequisite to replacing the runtime dependency safely. Mocks remain a test/offline concern, not evidence of a live benchmark.

## 7. Live read, writeback, idempotency, and temporal verification

Not run in this remediation attempt because token acquisition failed before a valid authenticated query call could occur. No live write was attempted.

## 8. Existing output truthfulness correction

The earlier audit repaired `scripts/generate_official_answers.ts` so `written_to_graph` is overwritten with the actual write outcome. The latest generation recorded 0/20 accepted writebacks and all 20 JSON files correctly report `written_to_graph: false`; all 20 still pass the structural validator.

## 9. Tests executed in this audit stream

```text
npm.cmd test                         PASS
npm.cmd run typecheck                PASS
python tests/staged-ingestion.test.py PASS
npx.cmd tsc                          PASS
node dist/tests/e2e-pipeline.test.js PASS (mocked in-process pipeline)
node dist/scripts/validate_official_answers.js PASS (20/20 structural files)
```

## 10. Exact files changed during the live-integration analysis

- `docs/TIGERGRAPH_RUNTIME_GAP_ANALYSIS.md`
- `docs/TIGERGRAPH_LIVE_INTEGRATION_FINAL_REPORT.md`

The preceding whole-project audit also changed `scripts/generate_official_answers.ts` to correct false writeback claims; that change remains required.

## 11. Required next action

Restore valid TigerGraph REST++ authentication in Savanna, then run a token-only check. Only after it returns successful JSON with a token should work continue with the typed live `CommanderToolClient`, read fixture regression, controlled writeback, and live benchmark.
