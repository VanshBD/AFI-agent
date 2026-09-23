# FRAUD COMMAND — Final Requirement Matrix (Evidence-Based)

**Recorded:** 2026-09-22. Status reflects repository and executed audit evidence, not prior claims.

| Requirement | Implementation | Evidence/File | Verified? | Status | Remaining gap |
| --- | --- | --- | --- | --- | --- |
| TigerGraph schema and GSQL | FraudCommand schema and controlled queries | `tigergraph/schema/`, `tigergraph/queries/` | schema/query portions previously live-recorded; source locally tested | PARTIAL | live availability and query-to-app adapter |
| Transaction temporal guard | cutoff contracts and `future_transaction` query behavior | `temporal-boundary.ts`, GSQL, tests | local tests pass; prior live fixture record | PARTIAL | current-session live rerun |
| Relationship / KnownCard temporal guard | `closed_at < cutoff` in relationship query | relationship GSQL and query-source test | local source test; prior manual live inspection | PARTIAL | current-session positive live fixture record |
| Agentic investigation state | bounded Commander and InvestigationState | `commander.ts`, `investigation-state.ts` | unit tests pass | PASS (local) | live tools not connected |
| Specialist analysis | five hunter modules | `*-hunter.ts`, tests | local unit tests pass | PASS (local) | live data verification |
| Evidence Ledger | typed ledger and specialist findings | `evidence-ledger.ts` | local tests/inspection | PASS (local) | durable case store/writeback |
| Prosecutor / Defense / contradictions | deterministic adversarial analyzer | `prosecutor-defense.ts`, tests | local tests pass | PASS (local) | live evidence integration |
| Decision sensitivity / evidence value | deterministic analyzers | `decision-sensitivity.ts`, `evidence-value.ts`, tests | local tests pass | PASS (local) | benchmark quality evaluation |
| NBA / authorization | policy engine with AUTO/L1/L2 | `next-best-action.ts`, tests | local tests pass | PASS (local) | real action adapter / approvals |
| 20 JSON outputs | generator and schema validator | `cases/`, generator, validator | 20/20 validator pass | PASS (structural) | outputs use non-live graph client |
| Benchmark integrity | 20-case runner | `scripts/run_benchmark.ts` | runner completes 20 cases | BLOCKED | mock client contains transaction-specific branches |
| Graph writeback | optional REST++ writeback | `generate_official_answers.ts` | audit run: 0/20 accepted; all outputs now flag false | BLOCKED | authentication/configuration and live writeback verification |
| Analyst UI | static UI + Node HTTP API | `ui/`, `serve_ui.ts` | `/api/cases` and `/api/investigate` smoke test pass | PARTIAL | server uses mock graph client; no browser E2E |
| ModelGateway | provider abstraction and deterministic gateway | `model-gateway.ts` | deterministic tests only | PARTIAL | no live Groq/Gemini test |
| GraphRAG | none found | repository inventory | no | NOT IMPLEMENTED | required knowledge-retrieval implementation |
| TigerGraph MCP | none found | repository inventory | no | NOT IMPLEMENTED | MCP runtime/integration |
| Graph algorithms | none found beyond traversal | repository inventory | no | NOT IMPLEMENTED | justified algorithm or documented challenge exception |
| Supabase / Redis | none found | repository inventory | no | NOT IMPLEMENTED | only add if proven needed |
| Submission/demo artifacts | no demo/blog/social/GitHub release evidence | repository inventory | no | BLOCKED | produce non-engineering submission materials |
