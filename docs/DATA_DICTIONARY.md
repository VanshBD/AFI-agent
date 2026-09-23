# HHGOA_IEEE — Verified Data Dictionary

Source: `HHGOA_IEEE/README.md` and a full streaming profile run by `scripts/dataset_forensics.py` on 2026-09-21. Blank means unavailable; it is not a negative signal.

## `transactions.csv` — 590,742 rows, 397 columns

| Field group | Fields | Verified meaning / treatment |
| --- | --- | --- |
| Transaction identity and time | `TransactionID`, `TransactionDT`, `ts` | `TransactionID` is unique. `TransactionDT` is seconds from dataset start; `ts` is the authoritative real timestamp for temporal controls. |
| Transaction facts | `TransactionAmt`, `ProductCD`, `channel`, `risk_score` | USD amount; product code; `W` is `in_person`, others are `online`; risk score is an alerting input, never an outcome. |
| Customer / payment attributes | `customer_id`, `card1`–`card6` | `customer_id` is the supplied customer identity. Card fields are attributes, not a safe standalone card primary key: missing values and observed fingerprint variation exist. |
| Billing / location | `addr1`, `addr2`, `dist1`, `dist2` | Anonymized billing-region/country and unnamed distance signals. `addr2=87` is documented as home country. |
| Email | `P_emaildomain`, `R_emaildomain` | Purchaser and recipient domains; each supports only domain-level relationship evidence. |
| Count features | `C1`–`C14` | Vesta unnamed count features. Use as named signals only, never assert an individual semantic not documented by the source. |
| Time-delta features | `D1`–`D15` | Vesta unnamed day-delta signals; do not infer individual field semantics. |
| Match flags | `M1`–`M9` | Vesta unnamed match signals; usable as opaque feature evidence. |
| Engineered features | `V1`–`V339` | Opaque Vesta ranking/count/relationship features. Preserve as features; do not create semantic entities from them. |

Measured range: `ts` 2016-07-02 00:02:21 through 2016-12-31 23:58:54; amount $0.27–$31,937.38; 13,553 customers; 14,893 observed customer/raw-card fingerprints; 151,072 online and 439,670 in-person rows. All 590,742 TransactionIDs are unique.

## `identity.csv` — 144,432 rows, 41 columns

| Field group | Fields | Verified meaning / treatment |
| --- | --- | --- |
| Join | `TransactionID` | Unique and joins to `transactions.csv`; no orphan identity IDs were found. |
| Encoded identity ratings | `id_01`–`id_11` | Opaque ratings/counts as documented. Treat as attributes only. |
| Categorical identity signals | `id_12`–`id_38` | `id_15`, `id_23`, `id_30`, `id_31`, `id_33`, `id_34` have documented interpretations in the README; other IDs remain opaque. |
| Device attributes | `DeviceType`, `DeviceInfo` | Device/platform descriptions; can support a derived, versioned DeviceProfile only with documented normalization. |

Identity exists only for a subset of online activity. It must never be treated as a required field or as proof of a device link when blank.

## `closed_cases_history.csv` — 5,565 rows, 15 columns

| Field | Meaning |
| --- | --- |
| `case_id`, `customer_id`, `card_id` | Historical case and supplied business identities. |
| `opened_at`, `closed_at` | Historical investigation lifecycle timestamps. |
| `outcome`, `pattern` | The only confirmed outcomes; `confirmed_fraud` or `cleared`, with documented pattern labels. |
| `first_fraud_txn_id`, `txn_ids`, `n_txns`, `exposure_usd` | Episode facts and labeled transaction set. `txn_ids` is pipe-separated. |
| `connected_card_ids`, `actions_taken`, `report_filed`, `analyst_notes` | Historical relationships, prior action/outcome context, and untrusted narrative data. |

All 5,565 case IDs are unique; all transaction references resolve and occur on/before case close. Historical labels are usable only after a case’s `closed_at` and only when `closed_at < current_case.opened_at`.

## `case_pack.csv` — 20 rows, 8 columns

`case_id`, `opened_at`, `trigger_type`, `trigger_text`, `flagged_txn_id`, `card_id`, `customer_id`, `risk_score`.

Every flagged ID resolves to a transaction; all customer identities match; no flagged transaction occurs after its case opens. It is benchmark input, never a source of outcome labels.
