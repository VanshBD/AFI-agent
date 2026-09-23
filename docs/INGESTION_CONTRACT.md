# FraudCommand — Phase 2A Deterministic Ingestion Contract

## Scope and non-goals

This contract loads only facts supported by `HHGOA_IEEE`. It creates no Merchant entity, does not infer meanings for Vesta opaque fields, does not ingest benchmark outcomes, and does not make labels or case notes visible without a query-level temporal cutoff. Stage 1 is a deterministic real-data subset; full ingestion remains a separate gate.

## Stage 1 selection

`scripts/staged_ingestion.py` selects the first 32 accepted `transactions.csv` rows in source-file order, the first 5 accepted `closed_cases_history.csv` rows in source-file order, and every `txn_ids` member referenced by those cases. Identity records are selected only when their `TransactionID` belongs to that transaction set. This is deterministic source-order sampling, not benchmark-oriented selection.

## Source-to-graph mapping

| Source | Columns | Destination | Transformation / null policy | Temporal semantics |
| --- | --- | --- | --- | --- |
| `transactions.csv` | `customer_id` | `Customer.customer_id` | required trimmed ID; reject blank | customer is non-temporal identity; activity remains time-filtered through transactions |
| `transactions.csv` | `customer_id`, `card1`–`card6` | `CardProfile` / `OWNS` | ID = SHA-256 of normalized tuple, prefix `CP-`; blanks retained in fingerprint | profile has no independent activity time |
| `transactions.csv` | `TransactionID`, `TransactionDT`, `TransactionAmt`, `ProductCD`, `channel`, `risk_score`, `ts`, billing/email fields | `Transaction` / `MADE` | required IDs/time/numerics are validated; emails lowercase/trimmed; blank optional fields remain blank | `ts` parses exactly as `%Y-%m-%d %H:%M:%S` into `occurred_at`; graph reads require `occurred_at <= cutoff` |
| `identity.csv` | `DeviceType`, `DeviceInfo`, `id_30`, `id_31`, `id_33`, `id_15`, `id_23` | `DeviceProfile` / `FROM_DEVICE` | ID = SHA-256 of version + normalized tuple, prefix `DP-`; no vertex/edge for entirely blank tuple | identity is available only with its joined transaction and inherits that transaction’s cutoff |
| `transactions.csv` | `P_emaildomain`, `R_emaildomain` | `EmailDomain` / email edges | lowercase normalized domain; blank creates no vertex or edge | relationship is visible only through its qualifying transaction |
| `transactions.csv` | `addr1`, `addr2` | `BillingRegion` / `BILLED_IN` | ID `BR-<addr1>|<addr2>` only if either component exists | relationship is visible only through its qualifying transaction |
| derived | profile transaction sort | `NEXT` | same profile, ordered `(occurred_at, transaction_id)`; non-negative gap only | must be filtered/rebuilt from the same cutoff snapshot by readers |
| `closed_cases_history.csv` | case lifecycle, outcome, pattern, notes | `ClosedCase`, `KnownCard`, `FraudPattern`, case edges | required IDs/times validated; `report_filed` must be Yes/No; unknown connected cards are not invented | outcome/pattern/notes are eligible only when `closed_at < cutoff` |

## Determinism and idempotency

- Source IDs and SHA-256-derived IDs are stable; no random IDs, UUIDs, or ingestion-time timestamps are used.
- Vertex and edge `INSERT` statements use identical endpoint IDs and attributes on rerun. TigerGraph graph types are not multi-graph types, so the same edge identity is not duplicated by a repeat run.
- The run ID is a SHA-256 digest of selection configuration and selected source IDs.
- A stage aborts before emitting a load command on required-column mismatch. Bad selected rows are counted with deterministic rejection codes; they are never converted into valid evidence.

## Procedure

```text
python scripts/staged_ingestion.py --base-transactions 32 --closed-cases 5 --output-dir artifacts/stage1_ingestion
python tests/staged-ingestion.test.py
```

The generated `stage1.gsql` is the only approved Stage 1 mutation command. Execute it in authenticated GraphStudio, then run it once more unchanged for idempotency validation. Do not use it for full-dataset ingestion.
