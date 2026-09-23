# TigerGraph Phase 2 Design Gate

## Logical graph

`FraudCommand`. The name is GSQL-safe and matches the application’s bounded domain. It is not applied by this repository.

## Required configuration before apply

| Value | Purpose | Required privilege |
| --- | --- | --- |
| `TIGERGRAPH_HOST` | Savanna/Community endpoint | network access |
| `TIGERGRAPH_GRAPH` | logical graph name, default `FraudCommand` | n/a |
| one configured auth method | username/password or query/RESTPP secret | authenticate |
| schema principal | run reviewed DDL only | `WRITE_SCHEMA` |
| ingestion principal | run reviewed loading job only | graph write/load privilege |
| MCP principal | execute allow-listed read tools; separately gated case writes | query-only by default |

No actual values were present during inspection. `TIGERGRAPH_MCP_URL` is not required until Phase 4.

## Reconciliation with verified data

- `Transaction` is fact-level and uses `ts` as `occurred_at`; every benchmark query must accept a cutoff and filter to `occurred_at <= cutoff`.
- Identity is optional and only creates `FROM_DEVICE` when a versioned, non-empty device normalization can be computed.
- `CardProfile` represents a raw, deterministic payment profile. `KnownCard` represents the supplied `Cxxxxx-Kn` case identity. They are intentionally distinct because 42 known cards had multiple observed raw fingerprints.
- `ClosedCase` outcome, pattern, and notes are loaded only into queries constrained to `closed_at < cutoff`.
- `NEXT` edges are derived within a CardProfile and must be built from cutoff-safe transaction ordering at query time or through a versioned temporal load.

## Validation gate before apply

1. Review the GSQL against the running TigerGraph version.
2. Confirm exact user/secret authentication mode and least privileges.
3. Dry-run schema in a disposable development graph.
4. Load a small fixture, assert vertex/edge counts and all expected joins.
5. Validate cutoff queries cannot return future transactions or ineligible closed cases.
6. Only then approve full ingestion. No `DROP ALL`, production mutation, or arbitrary GSQL is permitted.
