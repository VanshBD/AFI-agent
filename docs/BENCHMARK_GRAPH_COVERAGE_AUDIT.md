# Benchmark Graph Coverage Audit

**Audit date:** 2026-09-22  
**Scope:** Read-only audit before benchmark-coverage ingestion

## Current graph coverage

The verified Stage 1 manifest contains 38 transaction vertices, selected from transaction IDs `3000001` through the bounded Stage 1 fixture expansion. None of the 20 official benchmark transaction IDs occur in that manifest. A live MCP `getTransactionContext` request for `3514030` returned a controlled query error, confirming the missing context is a live-graph condition rather than a benchmark-runner issue.

The benchmark transaction records are present in the canonical `HHGOA_IEEE/transactions.csv` source. The matching identity records must be selected from `HHGOA_IEEE/identity.csv` by `TransactionID`. No benchmark transaction ID appears in `HHGOA_IEEE/closed_cases_history.csv`, so ingesting outcome-bearing cases would not create a direct relationship returned by the existing `findRelatedCases` or relationship query. It is therefore not justified for the 20-context coverage gate.

## Required minimal entities

For each transaction, the existing loader deterministically creates or reuses: `Customer`, `CardProfile`, `Transaction`, `EmailDomain` when populated, `BillingRegion` when populated, and `DeviceProfile` when a matching identity record has normalized device data. It adds `OWNS`, `MADE`, email, billing, and device edges. Historical `ClosedCase`, `KnownCard`, and fraud-pattern records remain absent unless the canonical history directly names the transaction; none does.

`Transaction.occurred_at` comes from canonical `transactions.csv.ts`. All benchmark `opened_at` values are later than their matched transaction timestamps. Existing query contracts remain authoritative: transaction context requires `occurred_at <= cutoff`; historical case evidence requires `closed_at < cutoff`.

## 20-case matrix

| Case | Transaction | Customer | Card | Investigation cutoff | Current live context | Canonical source |
| --- | --- | --- | --- | --- | --- | --- |
| HHG-001 | 3514030 | C12382 | C12382-K1 | 2016-12-05 01:55:28 | missing | transactions.csv + identity.csv |
| HHG-002 | 3478782 | C11891 | C11891-K1 | 2016-11-22 23:27:07 | missing | transactions.csv + identity.csv |
| HHG-003 | 3530164 | C08623 | C08623-K2 | 2016-12-10 15:01:21 | missing | transactions.csv + identity.csv |
| HHG-004 | 3583227 | C08106 | C08106-K1 | 2016-12-29 07:53:54 | missing | transactions.csv + identity.csv |
| HHG-005 | 3523199 | C02923 | C02923-K1 | 2016-12-08 03:38:37 | missing | transactions.csv + identity.csv |
| HHG-006 | 3476682 | C07297 | C07297-K1 | 2016-11-22 02:30:00 | missing | transactions.csv + identity.csv |
| HHG-007 | 3514948 | C09933 | C09933-K2 | 2016-12-05 03:46:14 | missing | transactions.csv + identity.csv |
| HHG-008 | 3558054 | C13171 | C13171-K2 | 2016-12-20 03:08:56 | missing | transactions.csv + identity.csv |
| HHG-009 | 3581141 | C08299 | C08299-K1 | 2016-12-28 17:10:53 | missing | transactions.csv + identity.csv |
| HHG-010 | 3506725 | C10434 | C10434-K1 | 2016-12-02 18:18:27 | missing | transactions.csv + identity.csv |
| HHG-011 | 3583368 | C11923 | C11923-K2 | 2016-12-29 06:27:44 | missing | transactions.csv + identity.csv |
| HHG-012 | 3553342 | C05876 | C05876-K2 | 2016-12-18 05:00:31 | missing | transactions.csv + identity.csv |
| HHG-013 | 3526826 | C07671 | C07671-K2 | 2016-12-09 05:39:29 | missing | transactions.csv + identity.csv |
| HHG-014 | 3478561 | C13487 | C13487-K1 | 2016-11-22 20:11:00 | missing | transactions.csv + identity.csv |
| HHG-015 | 3464869 | C03042 | C03042-K1 | 2016-11-17 19:03:36 | missing | transactions.csv + identity.csv |
| HHG-016 | 3534820 | C09988 | C09988-K1 | 2016-12-12 01:39:08 | missing | transactions.csv + identity.csv |
| HHG-017 | 3450629 | C04570 | C04570-K1 | 2016-11-12 00:46:24 | missing | transactions.csv + identity.csv |
| HHG-018 | 3491361 | C02354 | C02354-K2 | 2016-11-27 14:41:26 | missing | transactions.csv + identity.csv |
| HHG-019 | 3503878 | C07987 | C07987-K2 | 2016-12-01 22:28:53 | missing | transactions.csv + identity.csv |
| HHG-020 | 3509359 | C12265 | C12265-K2 | 2016-12-03 12:04:26 | missing | transactions.csv + identity.csv |

## Approved ingestion boundary

Use the existing `scripts/staged_ingestion.py` architecture with an explicit case-pack input. It must select exactly these 20 transaction IDs and matching identity rows, retain the existing deterministic normalization/rejection/idempotency logic, and emit an auditable GSQL artifact. No outcome labels, closed cases, benchmark answers, or additional surrounding transactions are required to make the current fixed graph-query contexts available.
