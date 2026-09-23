# Controlled GSQL Tool Catalogue

All tools are parameterized, invoked by the application/MCP through the registry, and produce structured evidence. `cutoff` is mandatory on every read and is validated both before call and in GSQL predicates.

| Tool | Inputs | Output evidence | Failure behavior |
| --- | --- | --- | --- |
| `getGraphValidationCounts` | request ID only | fixed counts for Stage 1-relevant vertex and direct-edge types | fixed, aggregate-only result; no graph text or arbitrary projection accepted |
| `getTransactionContext` | transaction ID, cutoff, request ID | flagged transaction, profile, optional identity, region/domain context | `not_found` / `future_transaction` is explicit; never silently substitute |
| `getTransactionRelationshipContext` | transaction ID, cutoff, request ID | up to 20 each of directly linked device, purchaser/recipient email domains, billing regions, and KnownCards reached only through `ClosedCase` records with `closed_at < cutoff` | `future_transaction` is explicit; empty relationship lists are valid, not negative evidence; case-derived KnownCards are not exposed before case closure |
| `getCustomerTimeline` | customer ID, cutoff, lookback limit, request ID | time-ordered prior transactions and behavioral aggregates | bounded result; partial result is labeled |
| `getDeviceNeighbors` | device profile ID, cutoff, time window, request ID | other pre-cutoff transactions/profiles/cases sharing exact normalized device | empty is valid; missing identity is not a negative finding |
| `getBillingRegionNeighbors` | billing region ID, cutoff, time window, request ID | pre-cutoff region-connected activity | results are association evidence only, not fraud proof |
| `findVelocitySequence` | card profile ID, cutoff, window, small-amount threshold, request ID | ordered online authorizations and subsequent larger transactions | validates threshold/window; no outcome claim |
| `findRelatedCases` | entity IDs, cutoff, limit, request ID | closed cases with `closed_at < cutoff` and relationship path | excludes outcome/notes from ineligible cases |
| `writeCase` | validated case payload, authorization context | graph case/evidence IDs and audit receipt | denies absent policy/authorization; idempotent by case ID |
| `updateCase` | validated append-only update, authorization context | audit receipt | denies overwrites that erase provenance |

## Query contracts

- `cutoff`: ISO datetime, required on all reads.
- `request_id`: caller-generated ID stored in audit telemetry, required.
- Result claims carry source query name, entity IDs, graph schema version, and cutoff.
- Timeouts/retries are bounded by application policy. A query failure results in an investigation warning and potential analyst escalation—not fabricated evidence.
- Write tools are not exposed to the general agent identity.
- `getGraphValidationCounts` has no caller-controlled graph selector, predicate, or limit. Relationship and case tools use fixed `LIMIT 20` projections.

## Installation rule

The query source may be installed only after the schema is applied to a disposable Savanna graph and the exact server version is confirmed. This avoids claiming unexecuted GSQL as validated behavior.
