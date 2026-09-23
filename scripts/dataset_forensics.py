"""Read-only forensic profile for the HHGOA_IEEE benchmark dataset."""

from __future__ import annotations

import csv
import json
from collections import Counter
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1] / "HHGOA_IEEE"


def parse_dt(value: str) -> datetime | None:
    return datetime.strptime(value, "%Y-%m-%d %H:%M:%S") if value else None


def card_fingerprint(row: dict[str, str]) -> tuple[str, ...]:
    return tuple(row[f"card{i}"] for i in range(1, 7))


def profile_transactions() -> tuple[dict, dict[str, tuple[datetime, str, tuple[str, ...]]]]:
    path = ROOT / "transactions.csv"
    ids: dict[str, tuple[datetime, str, tuple[str, ...]]] = {}
    customers: set[str] = set()
    card_fingerprints: set[tuple[str, tuple[str, ...]]] = set()
    channels: Counter[str] = Counter()
    products: Counter[str] = Counter()
    selected_nulls: Counter[str] = Counter()
    risk_values: list[float] = []
    amount_min = float("inf")
    amount_max = float("-inf")
    timestamp_min: datetime | None = None
    timestamp_max: datetime | None = None
    dt_min: int | None = None
    dt_max: int | None = None
    duplicate_ids = 0
    malformed_rows = 0
    columns: list[str]
    checked = [
        "customer_id", "ts", "channel", "risk_score", "addr1", "addr2", "P_emaildomain",
        "R_emaildomain", "dist1", "dist2", "card2", "card3", "card4", "card5", "card6",
    ]
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = reader.fieldnames or []
        rows = 0
        for row in reader:
            rows += 1
            if None in row:
                malformed_rows += 1
            transaction_id = row["TransactionID"]
            timestamp = parse_dt(row["ts"])
            if transaction_id in ids:
                duplicate_ids += 1
            else:
                ids[transaction_id] = (timestamp, row["customer_id"], card_fingerprint(row))
            customers.add(row["customer_id"])
            card_fingerprints.add((row["customer_id"], card_fingerprint(row)))
            channels[row["channel"]] += 1
            products[row["ProductCD"]] += 1
            for name in checked:
                if not row[name]:
                    selected_nulls[name] += 1
            risk_values.append(float(row["risk_score"]))
            amount = float(row["TransactionAmt"])
            amount_min = min(amount_min, amount)
            amount_max = max(amount_max, amount)
            timestamp_min = timestamp if timestamp_min is None or timestamp < timestamp_min else timestamp_min
            timestamp_max = timestamp if timestamp_max is None or timestamp > timestamp_max else timestamp_max
            delta = int(row["TransactionDT"])
            dt_min = delta if dt_min is None or delta < dt_min else dt_min
            dt_max = delta if dt_max is None or delta > dt_max else dt_max
    return {
        "file": path.name,
        "rows": rows,
        "columns": len(columns),
        "header": columns,
        "malformed_rows": malformed_rows,
        "duplicate_transaction_ids": duplicate_ids,
        "unique_transaction_ids": len(ids),
        "unique_customers": len(customers),
        "unique_customer_card_fingerprints": len(card_fingerprints),
        "timestamp_range": [str(timestamp_min), str(timestamp_max)],
        "transaction_dt_range": [dt_min, dt_max],
        "amount_range": [amount_min, amount_max],
        "risk_score": {
            "min": min(risk_values), "max": max(risk_values),
            "mean": round(sum(risk_values) / len(risk_values), 6),
            "zero": sum(value == 0 for value in risk_values),
            "at_least_0_7": sum(value >= 0.7 for value in risk_values),
        },
        "channel_counts": dict(channels),
        "product_counts": dict(products),
        "selected_null_counts": dict(selected_nulls),
    }, ids


def profile_identity(transaction_ids: set[str]) -> dict:
    path = ROOT / "identity.csv"
    ids: set[str] = set()
    device_types: Counter[str] = Counter()
    selected_nulls: Counter[str] = Counter()
    rows = malformed_rows = duplicate_ids = 0
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = reader.fieldnames or []
        for row in reader:
            rows += 1
            if None in row:
                malformed_rows += 1
            transaction_id = row["TransactionID"]
            duplicate_ids += transaction_id in ids
            ids.add(transaction_id)
            device_types[row["DeviceType"]] += 1
            for name in ["DeviceType", "DeviceInfo", "id_15", "id_23", "id_30", "id_31", "id_33", "id_34"]:
                if not row[name]:
                    selected_nulls[name] += 1
    return {
        "file": path.name, "rows": rows, "columns": len(columns), "header": columns,
        "malformed_rows": malformed_rows, "duplicate_transaction_ids": duplicate_ids,
        "unique_transaction_ids": len(ids), "matched_transaction_ids": len(ids & transaction_ids),
        "orphan_transaction_ids": len(ids - transaction_ids), "device_type_counts": dict(device_types),
        "selected_null_counts": dict(selected_nulls),
    }


def profile_cases(transaction_data: dict[str, tuple[datetime, str, tuple[str, ...]]]) -> tuple[dict, dict[str, set[tuple[str, tuple[str, ...]]]]]:
    path = ROOT / "closed_cases_history.csv"
    outcomes: Counter[str] = Counter()
    patterns: Counter[str] = Counter()
    report_filed: Counter[str] = Counter()
    case_ids: set[str] = set()
    card_map: dict[str, set[tuple[str, tuple[str, ...]]]] = {}
    mapping_conflict_examples: list[dict[str, object]] = []
    rows = duplicate_ids = missing_txns = future_relative_to_close = 0
    opened_min = closed_max = None
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = reader.fieldnames or []
        for row in reader:
            rows += 1
            case_id = row["case_id"]
            duplicate_ids += case_id in case_ids
            case_ids.add(case_id)
            outcomes[row["outcome"]] += 1
            patterns[row["pattern"]] += 1
            report_filed[row["report_filed"]] += 1
            opened = parse_dt(row["opened_at"])
            closed = parse_dt(row["closed_at"])
            opened_min = opened if opened_min is None or opened < opened_min else opened_min
            closed_max = closed if closed_max is None or closed > closed_max else closed_max
            for transaction_id in row["txn_ids"].split("|"):
                if transaction_id not in transaction_data:
                    missing_txns += 1
                    continue
                transaction_time, customer, fingerprint = transaction_data[transaction_id]
                future_relative_to_close += transaction_time > closed
                candidate = (customer, fingerprint)
                candidates = card_map.setdefault(row["card_id"], set())
                candidates.add(candidate)
                if len(candidates) > 1 and len(mapping_conflict_examples) < 10:
                    mapping_conflict_examples.append({
                        "card_id": row["card_id"], "candidate_count": len(candidates),
                        "case_id": case_id, "transaction_id": transaction_id,
                    })
    return {
        "file": path.name, "rows": rows, "columns": len(columns), "header": columns,
        "unique_case_ids": len(case_ids), "duplicate_case_ids": duplicate_ids,
        "outcomes": dict(outcomes), "patterns": dict(patterns), "report_filed": dict(report_filed),
        "opened_at_min": str(opened_min), "closed_at_max": str(closed_max),
        "referenced_transactions_missing": missing_txns,
        "referenced_transactions_after_case_close": future_relative_to_close,
        "mapped_card_ids": len(card_map),
        "card_ids_with_multiple_observed_fingerprints": sum(len(candidates) > 1 for candidates in card_map.values()),
        "card_mapping_conflict_examples": mapping_conflict_examples,
    }, card_map


def profile_case_pack(transaction_data: dict[str, tuple[datetime, str, tuple[str, ...]]], card_map: dict[str, set[tuple[str, tuple[str, ...]]]]) -> dict:
    path = ROOT / "case_pack.csv"
    triggers: Counter[str] = Counter()
    rows = missing_txns = customer_mismatches = card_conflicts = future_flags = 0
    opened_min = opened_max = None
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = reader.fieldnames or []
        for row in reader:
            rows += 1
            triggers[row["trigger_type"]] += 1
            opened = parse_dt(row["opened_at"])
            opened_min = opened if opened_min is None or opened < opened_min else opened_min
            opened_max = opened if opened_max is None or opened > opened_max else opened_max
            record = transaction_data.get(row["flagged_txn_id"])
            if record is None:
                missing_txns += 1
                continue
            transaction_time, customer, fingerprint = record
            customer_mismatches += customer != row["customer_id"]
            known = card_map.get(row["card_id"])
            if known is not None and (customer, fingerprint) not in known:
                card_conflicts += 1
            future_flags += transaction_time > opened
    return {
        "file": path.name, "rows": rows, "columns": len(columns), "header": columns,
        "trigger_counts": dict(triggers), "opened_at_range": [str(opened_min), str(opened_max)],
        "flagged_transactions_missing": missing_txns, "customer_mismatches": customer_mismatches,
        "known_card_mapping_conflicts": card_conflicts,
        "flagged_transactions_after_case_opened": future_flags,
    }


def main() -> None:
    transactions, transaction_data = profile_transactions()
    identity = profile_identity(set(transaction_data))
    cases, card_map = profile_cases(transaction_data)
    case_pack = profile_case_pack(transaction_data, card_map)
    profile = {"transactions": transactions, "identity": identity, "closed_cases": cases, "case_pack": case_pack}
    for section in profile.values():
        section.pop("header", None)
    profile["closed_cases"].pop("card_mapping_conflict_examples", None)
    print(json.dumps(profile, indent=2))


if __name__ == "__main__":
    main()
