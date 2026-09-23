# FraudCommand — TigerGraph Integration Validation

**Recorded:** 2026-09-22  
**Graph:** `FraudCommand`  
**Scope:** schema publication and controlled synthetic fixture only. The HHGOA_IEEE dataset has not been ingested.

## Gate result

**Status: PASS — TigerGraph Phase 2 integration gate.**

The authenticated Savanna GraphStudio session confirmed that `FraudCommand` exists and is at schema version 1. The schema, controlled fixture vertices, and controlled fixture edges were successfully applied. `getTransactionContext` is installed and was executed twice against the fixture. The observed results enforce the required temporal cutoff boundary.

## Verified evidence

| Requirement | Result | Evidence |
| --- | --- | --- |
| Authenticated TigerGraph connectivity | PASS | Active Savanna GraphStudio session selected `Workspace-1` and graph `FraudCommand`. |
| Graph exists | PASS | GraphStudio graph tree displayed `FraudCommand`. |
| Schema published | PASS | Schema-change job `FraudCommandV1` completed successfully; the service reported `Graph FraudCommand updated to new version 1`. |
| Actual schema inventory | PASS | Live GraphStudio verification reported 13 vertex types and 24 edge types. |
| Local schema comparison | PASS | The displayed vertex and authored edge names match [TIGERGRAPH_FINAL_DESIGN.md](TIGERGRAPH_FINAL_DESIGN.md). |
| Synthetic vertex fixture | PASS | An `INTERPRET QUERY` inserted `TG_FIXTURE_CUSTOMER`, `TG_FIXTURE_CARD`, and `TG_FIXTURE_TXN`; the response returned `error: false` at schema version 1. |
| Synthetic edge fixture | PASS | An `INTERPRET QUERY` inserted `OWNS(TG_FIXTURE_CUSTOMER, TG_FIXTURE_CARD)` and `MADE(TG_FIXTURE_CARD, TG_FIXTURE_TXN)`; the response returned `error: false`. |
| Temporal field write | PASS | `TG_FIXTURE_TXN.occurred_at` was written as `2020-01-01 00:00:00` using `to_datetime(...)` in the successful synthetic fixture. |
| Controlled GSQL query creation | PASS | GraphStudio returned `Successfully created queries: [getTransactionContext]`. |
| Controlled GSQL query installation | PASS | `getTransactionContext` was installed and made available in the GraphStudio Run Query panel. |
| Controlled query result — post-timestamp cutoff | PASS | With `txn=TG_FIXTURE_TXN` and `cutoff=2020-01-02 00:00:00`, normal transaction context returned `TG_FIXTURE_TXN`, `CardProfile=TG_FIXTURE_CARD`, and `customer_id=TG_FIXTURE_CUSTOMER`. |
| Controlled query result — pre-timestamp cutoff | PASS | With `txn=TG_FIXTURE_TXN` and `cutoff=2019-12-31 00:00:00`, the result returned `status=future_transaction` and `transaction=TG_FIXTURE_TXN`, preventing transaction-context retrieval. |
| Production dataset ingestion | NOT STARTED | Explicitly prohibited until this gate passes. |

## Schema compatibility correction

The initially generated source declared `Customer.customer_id` both as its primary ID and as a normal attribute while setting `primary_id_as_attribute="true"`. TigerGraph rejected that duplicate declaration. The local GSQL was corrected to declare only `PRIMARY_ID customer_id STRING`; with `primary_id_as_attribute="true"`, TigerGraph still exposes the primary ID as the `customer_id` attribute. This is a compiler-compatibility repair, not a logical model change.

## Observed live temporal executions

### Test A — cutoff after fixture transaction

```text
txn:    TG_FIXTURE_TXN
cutoff: 2020-01-02 00:00:00
```

Observed result: normal transaction context returned, identifying transaction `TG_FIXTURE_TXN`, card profile `TG_FIXTURE_CARD`, and customer `TG_FIXTURE_CUSTOMER`.

### Test B — cutoff before fixture transaction

```text
txn:    TG_FIXTURE_TXN
cutoff: 2019-12-31 00:00:00
```

Observed result: `status = future_transaction` and `transaction = TG_FIXTURE_TXN`. No normal transaction context was returned.

## Security and scope controls

- No secret, access token, cookie, or endpoint credential is copied into this record.
- Only synthetic IDs prefixed `TG_FIXTURE_` were written.
- No source dataset record, benchmark trigger, outcome, or case data was written to TigerGraph.
- The installed query is read-only and requires a caller-provided temporal cutoff.

## Phase 2A controlled read-tool continuation

Local implementation is ready for the next live gate. The fixed sources are `getGraphValidationCounts`, `getTransactionRelationshipContext`, and `findRelatedCases`; they contain no caller-supplied GSQL and use bounded projections/limits with the required temporal predicates. Typed contracts and negative tests pass through `npm.cmd test`.

Live installation and result verification are intentionally **not claimed** in this record yet. The browser service cannot access the authenticated session (latest sanitized condition: `User unavailable`; previously `Debugger unattached`), and the desktop-control inventory currently exposes no GraphStudio window. A direct REST++ token request reached the cloud endpoint but returned HTTP 400; no alternate credential format was attempted. Until an authenticated session is targetable, counts, relationship retrieval, idempotency comparison, and `closed_at < cutoff` results remain unverified. No production-scale ingestion has started.
