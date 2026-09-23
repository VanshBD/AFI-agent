"""Deterministic Phase 2A loader-plan generator for the verified HHGOA_IEEE data.

This program never connects to TigerGraph.  It validates a small, repeatable
subset and emits a reviewed GSQL `INTERPRET QUERY` command for the existing
FraudCommand graph.  Running that command remains an explicit live gate.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import subprocess
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "HHGOA_IEEE"
NORMALIZATION_VERSION = "hhgoa-ieee-v1"
REQUIRED_TRANSACTION_COLUMNS = {
    "TransactionID", "TransactionDT", "TransactionAmt", "ProductCD", "customer_id", "ts", "channel", "risk_score",
    "card1", "card2", "card3", "card4", "card5", "card6", "addr1", "addr2", "P_emaildomain", "R_emaildomain",
}
REQUIRED_IDENTITY_COLUMNS = {"TransactionID", "DeviceType", "DeviceInfo", "id_15", "id_23", "id_30", "id_31", "id_33", "id_34"}
REQUIRED_CASE_COLUMNS = {"case_id", "customer_id", "card_id", "opened_at", "closed_at", "outcome", "pattern", "txn_ids", "exposure_usd", "report_filed", "analyst_notes", "connected_card_ids"}


class IngestionValidationError(ValueError):
    pass


@dataclass
class RunReport:
    base_transaction_limit: int
    case_limit: int
    source_rows: Counter[str] = field(default_factory=Counter)
    accepted_rows: Counter[str] = field(default_factory=Counter)
    rejected_rows: Counter[str] = field(default_factory=Counter)
    rejection_reasons: Counter[str] = field(default_factory=Counter)
    vertices: Counter[str] = field(default_factory=Counter)
    edges: Counter[str] = field(default_factory=Counter)
    temporal_anomalies: Counter[str] = field(default_factory=Counter)

    def reject(self, source: str, reason: str) -> None:
        self.rejected_rows[source] += 1
        self.rejection_reasons[f"{source}:{reason}"] += 1


def clean(value: str | None) -> str:
    return (value or "").strip()


def normalize(value: str | None) -> str:
    return re.sub(r"\s+", " ", clean(value).lower())


def parse_timestamp(value: str, field_name: str) -> datetime:
    try:
        return datetime.strptime(clean(value), "%Y-%m-%d %H:%M:%S")
    except ValueError as error:
        raise IngestionValidationError(f"malformed_{field_name}") from error


def parse_uint(value: str, field_name: str) -> int:
    try:
        parsed = int(clean(value))
    except ValueError as error:
        raise IngestionValidationError(f"malformed_{field_name}") from error
    if parsed < 0:
        raise IngestionValidationError(f"negative_{field_name}")
    return parsed


def parse_float(value: str, field_name: str) -> float:
    try:
        return float(clean(value))
    except ValueError as error:
        raise IngestionValidationError(f"malformed_{field_name}") from error


def parse_bool(value: str, field_name: str) -> bool:
    lowered = normalize(value)
    if lowered == "yes":
        return True
    if lowered == "no":
        return False
    raise IngestionValidationError(f"malformed_{field_name}")


def require_columns(path: Path, expected: set[str]) -> None:
    with path.open(encoding="utf-8", newline="") as handle:
        columns = set(csv.DictReader(handle).fieldnames or [])
    missing = sorted(expected - columns)
    if missing:
        raise IngestionValidationError(f"source_schema_mismatch:{path.name}:missing={','.join(missing)}")


def profile_id(row: dict[str, str]) -> str:
    customer = clean(row["customer_id"])
    fingerprint = "\x1f".join([customer, *(normalize(row[f"card{i}"]) for i in range(1, 7))])
    return "CP-" + hashlib.sha256(fingerprint.encode()).hexdigest()[:24]


def device_id(row: dict[str, str]) -> str | None:
    parts = [normalize(row.get(field)) for field in ("DeviceType", "DeviceInfo", "id_30", "id_31", "id_33")]
    if not any(parts):
        return None
    return "DP-" + hashlib.sha256((NORMALIZATION_VERSION + "\x1f" + "\x1f".join(parts)).encode()).hexdigest()[:24]


def region_id(row: dict[str, str]) -> str | None:
    addr1, addr2 = clean(row.get("addr1")), clean(row.get("addr2"))
    return f"BR-{addr1}|{addr2}" if addr1 or addr2 else None


def gsql_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "") + '"'


def gsql_datetime(value: datetime) -> str:
    return f"to_datetime({gsql_string(value.strftime('%Y-%m-%d %H:%M:%S'))})"


def select_cases(path: Path, limit: int, report: RunReport) -> list[dict[str, Any]]:
    if limit == 0:
        return []
    cases: list[dict[str, Any]] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for raw in csv.DictReader(handle):
            report.source_rows["closed_cases_history"] += 1
            try:
                case_id, customer_id, card_id = clean(raw["case_id"]), clean(raw["customer_id"]), clean(raw["card_id"])
                if not case_id or not customer_id or not card_id:
                    raise IngestionValidationError("missing_case_identity")
                opened_at, closed_at = parse_timestamp(raw["opened_at"], "opened_at"), parse_timestamp(raw["closed_at"], "closed_at")
                if closed_at < opened_at:
                    raise IngestionValidationError("case_closed_before_opened")
                txn_ids = [value for value in (clean(v) for v in raw["txn_ids"].split("|")) if value]
                if not txn_ids:
                    raise IngestionValidationError("missing_case_transactions")
                cases.append({"raw": raw, "case_id": case_id, "customer_id": customer_id, "card_id": card_id,
                              "opened_at": opened_at, "closed_at": closed_at, "txn_ids": txn_ids})
                report.accepted_rows["closed_cases_history"] += 1
                if len(cases) == limit:
                    break
            except IngestionValidationError as error:
                report.reject("closed_cases_history", str(error))
    return cases


def select_benchmark_transaction_ids(path: Path) -> set[str]:
    """Reads case inputs only; it never reads labels or expected answers."""
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = set(reader.fieldnames or [])
        required = {"case_id", "flagged_txn_id", "opened_at"}
        missing = sorted(required - columns)
        if missing:
            raise IngestionValidationError(f"benchmark_case_pack_schema_mismatch:missing={','.join(missing)}")
        transaction_ids = {clean(row["flagged_txn_id"]) for row in reader}
    if not transaction_ids or "" in transaction_ids:
        raise IngestionValidationError("benchmark_case_pack_missing_transaction_id")
    return transaction_ids


def select_transactions(path: Path, base_limit: int, required_ids: set[str], report: RunReport) -> dict[str, dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    # The coverage gate requests only explicitly named benchmark inputs.  Use
    # repository-standard ripgrep to avoid parsing all 700MB of unrelated CSV
    # columns, then apply the same validation/normalization as the normal path.
    if base_limit == 0 and required_ids:
        header = path.open(encoding="utf-8", newline="").readline()
        pattern = "^(?:" + "|".join(re.escape(identifier) for identifier in sorted(required_ids)) + "),"
        result = subprocess.run(
            ["rg", "--no-heading", "--no-line-number", "-e", pattern, str(path)],
            capture_output=True,
            text=True,
            check=False,
            encoding="utf-8",
        )
        if result.returncode not in (0, 1):
            raise IngestionValidationError("benchmark_transaction_lookup_failed")
        for raw in csv.DictReader([header, *result.stdout.splitlines()]):
            report.source_rows["transactions"] += 1
            try:
                transaction_id = clean(raw["TransactionID"])
                if transaction_id not in required_ids or not clean(raw["customer_id"]):
                    raise IngestionValidationError("missing_transaction_identity")
                occurred_at = parse_timestamp(raw["ts"], "ts")
                parsed = {"raw": raw, "transaction_id": transaction_id, "occurred_at": occurred_at,
                          "transaction_dt": parse_uint(raw["TransactionDT"], "transaction_dt"),
                          "amount": parse_float(raw["TransactionAmt"], "amount"),
                          "risk_score": parse_float(raw["risk_score"], "risk_score"), "profile_id": profile_id(raw)}
                if not 0 <= parsed["risk_score"] <= 1:
                    raise IngestionValidationError("risk_score_out_of_range")
                selected[transaction_id] = parsed
                report.accepted_rows["transactions"] += 1
            except IngestionValidationError as error:
                report.reject("transactions", str(error))
        for transaction_id in sorted(required_ids - selected.keys()):
            report.reject("transactions", f"missing_case_transaction:{transaction_id}")
        return selected

    base_accepted = 0
    with path.open(encoding="utf-8", newline="") as handle:
        for raw in csv.DictReader(handle):
            report.source_rows["transactions"] += 1
            transaction_id = clean(raw["TransactionID"])
            take_for_case = transaction_id in required_ids
            if base_accepted >= base_limit and not take_for_case:
                if required_ids <= selected.keys():
                    break
                continue
            try:
                if not transaction_id or not clean(raw["customer_id"]):
                    raise IngestionValidationError("missing_transaction_identity")
                occurred_at = parse_timestamp(raw["ts"], "ts")
                parsed = {"raw": raw, "transaction_id": transaction_id, "occurred_at": occurred_at,
                          "transaction_dt": parse_uint(raw["TransactionDT"], "transaction_dt"),
                          "amount": parse_float(raw["TransactionAmt"], "amount"),
                          "risk_score": parse_float(raw["risk_score"], "risk_score"), "profile_id": profile_id(raw)}
                if not 0 <= parsed["risk_score"] <= 1:
                    raise IngestionValidationError("risk_score_out_of_range")
                if transaction_id not in selected:
                    selected[transaction_id] = parsed
                    report.accepted_rows["transactions"] += 1
                    if base_accepted < base_limit:
                        base_accepted += 1
            except IngestionValidationError as error:
                report.reject("transactions", str(error))
    missing_case_transactions = required_ids - selected.keys()
    for transaction_id in sorted(missing_case_transactions):
        report.reject("transactions", f"missing_case_transaction:{transaction_id}")
    return selected


def select_identity(path: Path, transaction_ids: set[str], report: RunReport) -> dict[str, dict[str, str]]:
    identity: dict[str, dict[str, str]] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            report.source_rows["identity"] += 1
            transaction_id = clean(row["TransactionID"])
            if transaction_id not in transaction_ids:
                continue
            if transaction_id in identity:
                report.reject("identity", "duplicate_transaction_id")
                continue
            identity[transaction_id] = row
            report.accepted_rows["identity"] += 1
    return identity


def add_vertex(lines: list[str], report: RunReport, vertex: str, values: list[str]) -> None:
    lines.append(f"  INSERT INTO {vertex} VALUES ({', '.join(values)});")
    report.vertices[vertex] += 1


def add_edge(lines: list[str], report: RunReport, edge: str, source: str, target: str, *attributes: str) -> None:
    values = [gsql_string(source), gsql_string(target), *attributes]
    lines.append(f"  INSERT INTO {edge} VALUES ({', '.join(values)});")
    report.edges[edge] += 1


def build_gsql(transactions: dict[str, dict[str, Any]], identities: dict[str, dict[str, str]], cases: list[dict[str, Any]], report: RunReport) -> str:
    lines = ["// Generated by scripts/staged_ingestion.py. Deterministic Stage 1 only.", "INTERPRET QUERY () FOR GRAPH FraudCommand {"]
    customers, profiles, domains, regions, devices, known_cards, patterns = set(), set(), set(), set(), set(), set(), set()
    for transaction in transactions.values():
        raw = transaction["raw"]
        customer, profile, transaction_id = clean(raw["customer_id"]), transaction["profile_id"], transaction["transaction_id"]
        if customer not in customers:
            add_vertex(lines, report, "Customer", [gsql_string(customer)])
            customers.add(customer)
        if profile not in profiles:
            add_vertex(lines, report, "CardProfile", [gsql_string(profile), gsql_string(customer), *(gsql_string(clean(raw[f"card{i}"])) for i in range(1, 7)), gsql_string(NORMALIZATION_VERSION)])
            add_edge(lines, report, "OWNS", customer, profile)
            profiles.add(profile)
        add_vertex(lines, report, "Transaction", [gsql_string(transaction_id), str(transaction["transaction_dt"]), str(transaction["amount"]), gsql_string(clean(raw["ProductCD"])), gsql_string(clean(raw["channel"])), str(transaction["risk_score"]), gsql_datetime(transaction["occurred_at"]), gsql_string(clean(raw["addr1"])), gsql_string(clean(raw["addr2"])), gsql_string(normalize(raw["P_emaildomain"])), gsql_string(normalize(raw["R_emaildomain"]))])
        add_edge(lines, report, "MADE", profile, transaction_id)
        for field, edge in (("P_emaildomain", "PURCHASER_EMAIL"), ("R_emaildomain", "RECIPIENT_EMAIL")):
            domain = normalize(raw[field])
            if domain:
                if domain not in domains:
                    add_vertex(lines, report, "EmailDomain", [gsql_string(domain)])
                    domains.add(domain)
                add_edge(lines, report, edge, transaction_id, domain)
        billing_region = region_id(raw)
        if billing_region:
            if billing_region not in regions:
                add_vertex(lines, report, "BillingRegion", [gsql_string(billing_region), gsql_string(clean(raw["addr1"])), gsql_string(clean(raw["addr2"]))])
                regions.add(billing_region)
            add_edge(lines, report, "BILLED_IN", transaction_id, billing_region)
        identity = identities.get(transaction_id)
        if identity:
            normalized_device_id = device_id(identity)
            if normalized_device_id:
                if normalized_device_id not in devices:
                    add_vertex(lines, report, "DeviceProfile", [gsql_string(normalized_device_id), gsql_string(normalize(identity["DeviceType"])), gsql_string(normalize(identity["DeviceInfo"])), gsql_string(normalize(identity["id_30"])), gsql_string(normalize(identity["id_31"])), gsql_string(normalize(identity["id_33"])), gsql_string(normalize(identity["id_15"])), gsql_string(normalize(identity["id_23"])), gsql_string(NORMALIZATION_VERSION)])
                    devices.add(normalized_device_id)
                add_edge(lines, report, "FROM_DEVICE", transaction_id, normalized_device_id)
    for profile, profile_transactions in _transactions_by_profile(transactions).items():
        for previous, current in zip(profile_transactions, profile_transactions[1:]):
            gap = int((current["occurred_at"] - previous["occurred_at"]).total_seconds())
            if gap < 0:
                report.temporal_anomalies["negative_next_gap"] += 1
            else:
                add_edge(lines, report, "NEXT", previous["transaction_id"], current["transaction_id"], str(gap))
    profiles_by_customer: dict[str, set[str]] = defaultdict(set)
    for transaction in transactions.values():
        profiles_by_customer[clean(transaction["raw"]["customer_id"])].add(transaction["profile_id"])
    known_card_by_id: set[str] = set()
    for case in cases:
        raw, case_id, customer, card_id = case["raw"], case["case_id"], case["customer_id"], case["card_id"]
        if card_id not in known_card_by_id:
            add_vertex(lines, report, "KnownCard", [gsql_string(card_id), gsql_string(customer)])
            add_edge(lines, report, "HAS_KNOWN_CARD", customer, card_id)
            known_card_by_id.add(card_id)
        add_vertex(lines, report, "ClosedCase", [gsql_string(case_id), gsql_string(customer), gsql_datetime(case["opened_at"]), gsql_datetime(case["closed_at"]), gsql_string(clean(raw["outcome"])), gsql_string(clean(raw["pattern"])), str(parse_float(raw["exposure_usd"], "exposure_usd")), "true" if parse_bool(raw["report_filed"], "report_filed") else "false", gsql_string(clean(raw["analyst_notes"]))])
        add_edge(lines, report, "ON_KNOWN_CARD", case_id, card_id)
        pattern = clean(raw["pattern"])
        if pattern and pattern not in patterns:
            add_vertex(lines, report, "FraudPattern", [gsql_string(pattern), gsql_string("HHGOA_IEEE historical case pattern")])
            patterns.add(pattern)
        if pattern:
            add_edge(lines, report, "CLASSIFIED_AS", case_id, pattern)
        for transaction_id in case["txn_ids"]:
            if transaction_id in transactions:
                add_edge(lines, report, "INVOLVES", case_id, transaction_id)
        for profile in sorted(profiles_by_customer[customer]):
            add_edge(lines, report, "OBSERVED_AS", card_id, profile, gsql_datetime(case["closed_at"]), gsql_string(case_id))
        for connected_card_id in (clean(value) for value in raw["connected_card_ids"].split("|")):
            if connected_card_id and connected_card_id in known_card_by_id:
                add_edge(lines, report, "CONNECTED_TO", case_id, connected_card_id)
    lines.append("}")
    return "\n".join(lines) + "\n"


def _transactions_by_profile(transactions: dict[str, dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for transaction in transactions.values():
        grouped[transaction["profile_id"]].append(transaction)
    for values in grouped.values():
        values.sort(key=lambda item: (item["occurred_at"], item["transaction_id"]))
    return grouped


def build_stage(
    base_limit: int,
    case_limit: int,
    output_dir: Path,
    benchmark_case_pack: Path | None = None,
) -> dict[str, Any]:
    for path, columns in ((DATA / "transactions.csv", REQUIRED_TRANSACTION_COLUMNS), (DATA / "identity.csv", REQUIRED_IDENTITY_COLUMNS), (DATA / "closed_cases_history.csv", REQUIRED_CASE_COLUMNS)):
        require_columns(path, columns)
    report = RunReport(base_limit, case_limit)
    cases = select_cases(DATA / "closed_cases_history.csv", case_limit, report)
    required_ids = {transaction_id for case in cases for transaction_id in case["txn_ids"]}
    benchmark_ids: set[str] = set()
    if benchmark_case_pack is not None:
        benchmark_ids = select_benchmark_transaction_ids(benchmark_case_pack)
        required_ids.update(benchmark_ids)
    transactions = select_transactions(DATA / "transactions.csv", base_limit, required_ids, report)
    identities = select_identity(DATA / "identity.csv", set(transactions), report)
    gsql = build_gsql(transactions, identities, cases, report)
    selected_ids = sorted(transactions)
    run_digest = hashlib.sha256(json.dumps({"base_limit": base_limit, "case_limit": case_limit, "benchmark_ids": sorted(benchmark_ids), "transactions": selected_ids, "cases": [case["case_id"] for case in cases]}, sort_keys=True).encode()).hexdigest()[:16]
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "stage1.gsql").write_text(gsql, encoding="utf-8")
    manifest = {"run_id": f"stage1-{run_digest}", "source_version": "HHGOA_IEEE as present in workspace", "stage": "stage1_deterministic_fixture", "selection": {"base_transactions": "first accepted transaction rows in source-file order", "base_limit": base_limit, "closed_cases": "first accepted closed-case rows in source-file order", "case_limit": case_limit, "case_transaction_expansion": "all txn_ids from selected closed cases", "benchmark_case_pack": str(benchmark_case_pack) if benchmark_case_pack else None, "benchmark_transaction_ids": sorted(benchmark_ids)}, "selected_transaction_ids": selected_ids, "selected_case_ids": [case["case_id"] for case in cases], "report": {"source_rows_scanned": dict(report.source_rows), "accepted_rows": dict(report.accepted_rows), "rejected_rows": dict(report.rejected_rows), "rejection_reasons": dict(report.rejection_reasons), "planned_vertices": dict(report.vertices), "planned_edges": dict(report.edges), "temporal_anomalies": dict(report.temporal_anomalies)}}
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-transactions", type=int, default=32)
    parser.add_argument("--closed-cases", type=int, default=5)
    parser.add_argument("--benchmark-case-pack", type=Path)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts" / "stage1_ingestion")
    args = parser.parse_args()
    if args.base_transactions < 0 or args.closed_cases < 0:
        raise SystemExit("subset limits cannot be negative")
    if args.base_transactions == 0 and args.closed_cases == 0 and args.benchmark_case_pack is None:
        raise SystemExit("provide a positive subset limit or --benchmark-case-pack")
    manifest = build_stage(args.base_transactions, args.closed_cases, args.output_dir, args.benchmark_case_pack)
    print(json.dumps(manifest, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
