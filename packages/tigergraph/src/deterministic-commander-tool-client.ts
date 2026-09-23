/** Explicit offline/test dependency. Never selected by live runtime mode. */
import type { CommanderToolClient } from "../../domain/src/commander.js";
import type { TigerGraphReadTool } from "./read-tool-contracts.js";

export class DeterministicMockCommanderToolClient implements CommanderToolClient {
  public async executeTool(
    toolName: TigerGraphReadTool,
    params: { txn?: string; cutoff?: string },
    _requestId: string,
  ): Promise<unknown> {
    if (toolName === "getTransactionContext") {
      return { results: [{
        transaction: { transaction_id: params.txn, amount: 99.5, channel: "offline-test", risk_score: 0.5 },
        card_profiles: [{ card_profile_id: "CP-DETERMINISTIC", customer_id: "C-DETERMINISTIC" }],
      }] };
    }
    if (toolName === "getTransactionRelationshipContext") {
      return { results: [{
        transaction: params.txn,
        device_profiles: [], billing_regions: [], purchaser_email_domains: [], recipient_email_domains: [], known_cards: [],
      }] };
    }
    if (toolName === "findRelatedCases") {
      return { results: [{ transaction: params.txn, eligible_closed_cases: [], fraud_patterns: [], known_cards: [] }] };
    }
    return { results: [] };
  }
}
