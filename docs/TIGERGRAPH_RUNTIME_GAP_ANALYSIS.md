# FRAUD COMMAND — TigerGraph Runtime Gap Analysis

**Recorded:** 2026-09-22  
**Scope:** observed implementation before live-adapter changes.

## Current runtime path

```text
UI (`ui/app.js`)
  -> HTTP API (`scripts/serve_ui.ts`)
  -> InvestigationService (`packages/domain/src/investigation-service.ts`)
  -> CommanderOrchestrator (`packages/domain/src/commander.ts`)
  -> CommanderToolClient interface
  -> `mockToolClient` in `scripts/serve_ui.ts`
  -> deterministic fabricated graph-shaped response
```

`scripts/run_benchmark.ts` independently constructs a similar mock. `scripts/generate_official_answers.ts` constructs a separate local CSV/extract-backed tool client. No runtime path provides a production implementation of `CommanderToolClient`.

## Desired runtime path

```text
UI
  -> HTTP API
  -> InvestigationService
  -> CommanderOrchestrator
  -> typed LiveTigerGraphCommanderToolClient
  -> fixed allowlist + typed input validation
  -> installed FraudCommand REST++ query endpoint
  -> validated structured TigerGraph response
  -> Evidence Ledger / specialists / NBA
```

## Existing contracts and live assets

| Layer | Existing implementation |
| --- | --- |
| Commander interface | `packages/domain/src/commander.ts` (`CommanderToolClient`) |
| Immutable cutoff and registry guard | `packages/domain/src/tool-registry.ts`, `temporal-boundary.ts` |
| Typed query input guard | `packages/tigergraph/src/read-tool-contracts.ts` |
| Read allowlist | `getTransactionContext`, `getTransactionRelationshipContext`, `findRelatedCases`, `getGraphValidationCounts` |
| GSQL source | `tigergraph/queries/` |
| Environment convention currently used by writeback | `TG_HOST`, `TG_GRAPHNAME`, `TG_SECRET` in local ignored `.env` |
| Current graph writeback | `scripts/generate_official_answers.ts` |

## Verified gaps

1. UI and benchmark use mocks; some include transaction-specific behavior.
2. There is no typed REST++ read-query client in `packages/tigergraph/`.
3. Existing local read contracts validate caller inputs but do not validate TigerGraph response shape.
4. Writeback token acquisition returned HTTP 400 during the final audit.
5. `written_to_graph` previously overstated success; it has been corrected to reflect actual writeback result.

## Remediation order

1. Diagnose REST++ token request format/endpoint with token-only requests and sanitized output.
2. Add one fixed, typed live read adapter—no arbitrary GSQL or dynamic query names.
3. Prove temporal reads on validated fixtures.
4. Inject the live adapter explicitly in application/live benchmark mode; retain mocks only for tests/offline mode.
5. Fix and verify controlled writeback separately.
6. Only then run a live benchmark and writeback acceptance test.

## Authentication diagnosis performed on 2026-09-22

The local ignored configuration was used without printing any host credential, secret, token, or response body. Token-only requests produced:

| Request | Result |
| --- | --- |
| `POST /restpp/requesttoken` with documented JSON `{secret, graph, lifetime}` | HTTP 400, non-JSON response |
| `GET /restpp/requesttoken` with documented secret parameters | HTTP 400, non-JSON response |
| `POST /restpp/requesttoken` with legacy raw-secret body | HTTP 400, non-JSON response |
| `POST /requesttoken` with documented JSON | HTTP 404 |

The configured host routes REST++ through `/restpp`; however, no tested token form was accepted. The evidence establishes a **live authentication/configuration blocker**. It does not establish that an arbitrary request-format change will work. A user with Savanna Admin/GraphStudio access must verify that the local `TG_SECRET` is current, issued for this active workspace/database, permitted for REST++ token generation, and that REST++ authentication is enabled on the endpoint. Do not rotate secrets blindly or add a client fallback to mocks.
