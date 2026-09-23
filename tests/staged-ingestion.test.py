import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from staged_ingestion import (
    IngestionValidationError,
    build_stage,
    device_id,
    parse_timestamp,
    profile_id,
)


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


row = {"customer_id": "C00001", "card1": "1", "card2": "", "card3": "3", "card4": "visa", "card5": "", "card6": "credit"}
expect(profile_id(row) == profile_id(dict(row)), "profile IDs must be deterministic")
device = {"DeviceType": " Mobile ", "DeviceInfo": "Example", "id_30": "OS", "id_31": "Browser", "id_33": "100x100"}
expect(device_id(device) == device_id(dict(device)), "device IDs must be deterministic")
try:
    parse_timestamp("not-a-time", "ts")
except IngestionValidationError as error:
    expect(str(error) == "malformed_ts", "malformed timestamp must retain deterministic reason")
else:
    raise AssertionError("malformed timestamp must fail")

first = build_stage(8, 2, ROOT / "artifacts" / "stage1_ingestion_test_one")
second = build_stage(8, 2, ROOT / "artifacts" / "stage1_ingestion_test_two")
expect(first["run_id"] == second["run_id"], "same staged source must produce same run ID")
expect(first["selected_transaction_ids"] == second["selected_transaction_ids"], "same staged source must select same transactions")
expect(first["report"]["planned_vertices"] == second["report"]["planned_vertices"], "planned graph counts must be repeatable")
benchmark_pack = ROOT / "HHGOA_IEEE" / "case_pack.csv"
coverage = build_stage(0, 0, ROOT / "artifacts" / "benchmark_coverage_ingestion_test", benchmark_pack)
expect(len(coverage["selection"]["benchmark_transaction_ids"]) == 20, "benchmark case pack must select all 20 transaction inputs")
expect(set(coverage["selection"]["benchmark_transaction_ids"]) <= set(coverage["selected_transaction_ids"]), "every benchmark transaction must be selected")
expect(coverage["selected_case_ids"] == [], "coverage ingestion must not add outcome-bearing historical cases")
print("staged-ingestion tests passed")
