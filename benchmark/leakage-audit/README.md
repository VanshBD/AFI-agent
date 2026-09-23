# Benchmark Leakage Prevention Specification

For a benchmark case, its `opened_at` is the exclusive investigation boundary for future facts and the strict boundary for historical outcomes.

- Permit transactions and joined identity records only when transaction `ts <= case_pack.opened_at`.
- Permit closed-case outcome, pattern, notes, actions, and case-derived embeddings only when `closed_cases_history.closed_at < case_pack.opened_at`.
- Recompute every aggregate, device profile, region cluster, case similarity index, graph edge, and vector index under the same cutoff.
- Prohibit benchmark answer keys, public original IEEE-CIS/Kaggle outcome recovery, future case outputs, and outcomes inferred from a later case.
- Do not use a case produced in one benchmark run as memory for another benchmark case unless the runner explicitly models a later real-world opening time and records that dependency. Default: isolate all benchmark cases.

The domain guard in `packages/domain/src/temporal-boundary.ts` is the application boundary; graph queries must also accept and enforce the cutoff.
