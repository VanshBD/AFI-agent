# FRAUD COMMAND — Final TigerGraph Design

**Logical graph:** `FraudCommand`  
**Status:** published to Savanna as `FraudCommand` schema v1; verified by the Phase 2 integration gate.

## Why this is the minimum complete graph

The verified data supports four fact networks: payment activity, customer/payment profiles, device identity, and historical investigations. Billing regions and email domains are separate vertices because policy R6 requires cross-card shared-origin traversal. Opaque Vesta fields stay transaction attributes or offline features: inventing entities for them would create unsupported semantics. There is no merchant field in the dataset, so there is deliberately no `Merchant` vertex.

## Vertex types and source mapping

| Vertex | Primary ID | Dataset / system source | Purpose |
| --- | --- | --- | --- |
| `Customer` | `customer_id` | transactions/cases | customer neighborhood |
| `CardProfile` | deterministic versioned raw-card profile ID | customer + card1–card6 | transaction sequence and behavioral context |
| `KnownCard` | `Cxxxxx-Kn` | case pack / closed history | official case identity; separate from raw profiles |
| `Transaction` | `TransactionID` | transactions | temporal investigation fact |
| `DeviceProfile` | versioned normalized identity tuple | identity join | shared-device traversal |
| `EmailDomain` | normalized domain | transactions | purchaser/recipient shared-origin traversal |
| `BillingRegion` | `addr1|addr2` | transactions | region relationship traversal |
| `ClosedCase` | `case_id` | closed history | temporally eligible labeled memory |
| `InvestigationCase` | case ID | application | case memory written by agent |
| `Evidence` | evidence ID | application | auditable evidence ledger |
| `PolicyRule` | `R1`–`R10` | dataset README policy | deterministic policy grounding |
| `FraudPattern` | documented pattern name | dataset README | historical case classification |
| `DocumentChunk` | versioned chunk ID | README/policy/regulatory docs when acquired | GraphRAG provenance |

## Edge types and why they exist

| Edge | From → To | Investigation question |
| --- | --- | --- |
| `OWNS`, `HAS_KNOWN_CARD` | Customer → CardProfile/KnownCard | what payment identities belong to customer? |
| `MADE` | CardProfile → Transaction | customer/card timeline and velocity |
| `OBSERVED_AS` | KnownCard → CardProfile | case-card to raw profile mapping with provenance; may be one-to-many |
| `FROM_DEVICE` | Transaction → DeviceProfile | which profiles/cards share a device? |
| `PURCHASER_EMAIL`, `RECIPIENT_EMAIL` | Transaction → EmailDomain | shared origin, especially R6 recipient domain |
| `BILLED_IN` | Transaction → BillingRegion | out-of-region / shared-region analysis |
| `NEXT` | Transaction → Transaction | precomputed sequence only within same CardProfile |
| `INVOLVES`, `ON_KNOWN_CARD`, `CONNECTED_TO`, `CLASSIFIED_AS` | ClosedCase → fact vertices | closed-case memory and outcome relationships |
| `TRIGGERED_BY`, `HAS_EVIDENCE`, `GOVERNED_BY` | InvestigationCase → fact vertices | case trace and policy traceability |
| `EVIDENCE_REFERENCES` | Evidence → fact vertices | claim-to-entity provenance |
| `SOURCE_CHUNK` | PolicyRule/FraudPattern → DocumentChunk | GraphRAG grounding |

## Temporal contract

Every read query accepts `cutoff`. It must only return a transaction when `occurred_at <= cutoff` and historical case labels/notes only when `closed_at < cutoff`. `NEXT`, device aggregation, graph algorithm inputs, embeddings, and similarity must be built from the same cutoff snapshot. Output from one benchmark case is not memory for another benchmark case by default.

## Controlled query set

1. `getTransactionContext`
2. `getCustomerTimeline`
3. `getDeviceNeighbors`
4. `getBillingRegionNeighbors`
5. `findVelocitySequence`
6. `findRelatedCases`
7. `writeCase` (authorized case-write identity only)
8. `updateCase` (authorized case-write identity only)

The GSQL implementation is intentionally deferred until a fixture graph proves the installed server version and query syntax. No model may generate arbitrary GSQL.

## Algorithms: evaluation plan, not premature deployment

| Algorithm | Derived cutoff-safe projection | Question | Gate |
| --- | --- | --- | --- |
| Connected components | CardProfile–DeviceProfile / CardProfile–BillingRegion | is there a multi-card connected cluster? | compare R6 recall and false links |
| Degree / neighborhood | DeviceProfile, BillingRegion, EmailDomain | how widely is an origin shared before cutoff? | compare evidence relevance |
| Shortest path | transaction-to-closed-case subgraph | what explainable link connects the alert to prior fraud? | retain only if paths improve case explanation |

Community detection, embeddings, GNNs, and similarity algorithms are deferred. The dataset supports them structurally, but no benchmark benefit is verified.

## Savanna schema gate (completed)

`FraudCommand` was created after a successful authenticated schema session, controlled synthetic fixture load, and temporal query verification. Full 590,742-row ingestion remains prohibited until the separate Phase 2A staged real-data ingestion gate passes.
