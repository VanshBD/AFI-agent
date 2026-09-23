/**
 * AFI Agentic Fraud Investigation — Behavior Hunter Test Suite
 * Asserts all 10 required test criteria (A-J):
 * A. valid state
 * B. evidence provenance
 * C. temporal safety
 * D. missing behavioral history
 * E. no fabricated velocity
 * F. no baseline fabrication
 * G. no absence-of-evidence conclusion
 * H. competing hypothesis preservation
 * I. Commander integration
 * J. arbitrary GSQL rejection
 */

import {
  createInvestigationState,
} from "../packages/domain/src/investigation-state.js";
import {
  createEvidenceItem,
  EvidenceLedgerError,
} from "../packages/domain/src/evidence-ledger.js";
import {
  createHypothesis,
} from "../packages/domain/src/hypotheses.js";
import {
  validateToolInvocationRequest,
  ToolRegistryError,
} from "../packages/domain/src/tool-registry.js";
import {
  BehaviorHunterAnalyzer,
  createBehaviorFinding,
  BehaviorHunterError,
} from "../packages/domain/src/behavior-hunter.js";
import {
  CommanderOrchestrator,
  CommanderToolClient,
} from "../packages/domain/src/commander.js";
import { TigerGraphReadTool } from "../packages/tigergraph/src/read-tool-contracts.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function expectThrows<TError extends Error>(
  action: () => unknown,
  errorType: new (...args: any[]) => TError,
  message: string
): void {
  try {
    action();
  } catch (err) {
    expect(
      err instanceof errorType,
      `Expected ${errorType.name} but got ${(err as Error).name}: ${(err as Error).message}`
    );
    return;
  }
  throw new Error(`Expected throw (${message}) but action succeeded`);
}

async function runBehaviorHunterTests(): Promise<void> {
  const analyzer = new BehaviorHunterAnalyzer();
  const baseCutoff = "2016-07-04 02:10:21";

  // A. Valid state accepted
  const validState = createInvestigationState({
    investigationId: "inv-beh-001",
    triggerId: "HHG-005",
    flaggedTransactionId: "3000183",
    customerId: "C08945",
    cardId: "C08945-K2",
    investigationCutoff: baseCutoff,
  });
  expect(validState.investigationId === "inv-beh-001", "A: Valid state accepted");

  // B. Evidence provenance required
  expectThrows(
    () =>
      createBehaviorFinding({
        findingId: "fnd-beh-no-ev",
        findingType: "channel_consistency",
        title: "Missing Evidence Finding",
        observation: "Channel online",
        rationale: "Rationale",
        evidenceIds: [], // Empty must throw
        affectedEntities: [{ entityType: "Transaction", entityId: "3000183" }],
        confidenceScore: 0.8,
        isTemporallyEligible: true,
        decisionImpact: "medium",
      }),
    BehaviorHunterError,
    "B: Finding without evidenceIds must throw"
  );

  // C. Temporal safety (rejects future observedAt, handles temporal_denial)
  expectThrows(
    () =>
      createEvidenceItem({
        evidenceId: "ev-future-beh-fail",
        investigationId: "inv-beh-001",
        category: "observed_fact",
        sourceType: "tigergraph_tool",
        toolName: "getTransactionContext",
        entityType: "Transaction",
        entityId: "3000183",
        observation: "Future behavior",
        observedAt: "2016-07-05 00:00:00",
        investigationCutoff: baseCutoff,
        polarity: "neutral",
        decisionImpact: "medium",
        provenance: {
          queryOrSourceRef: "getTransactionContext",
          requestId: "req-f-beh",
          executionTimestamp: "2026-09-22 10:00:00",
        },
      }),
    EvidenceLedgerError,
    "C: EvidenceItem with observedAt > cutoff must throw"
  );

  const futureDenialEv = createEvidenceItem({
    evidenceId: "ev-future-beh",
    investigationId: "inv-beh-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionContext",
    entityType: "Transaction",
    entityId: "3000001",
    observation: "Transaction 3000001 rejected as future_transaction relative to cutoff 2016-07-02 00:02:20.",
    investigationCutoff: "2016-07-02 00:02:20",
    polarity: "contradicts",
    decisionImpact: "high",
    provenance: {
      queryOrSourceRef: "getTransactionContext",
      requestId: "req-f-beh2",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });
  const futureRes = analyzer.analyzeBehaviorEvidence(validState, [futureDenialEv]);
  expect(futureRes.findings[0].findingType === "temporal_denial", "C: Temporal denial recognized");

  // D. Missing behavioral history identified
  const txnEvidence = createEvidenceItem({
    evidenceId: "ev-txn-beh",
    investigationId: "inv-beh-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionContext",
    entityType: "Transaction",
    entityId: "3000183",
    observation: "Transaction 3000183 verified in graph for customer C08945 with 1 associated card profiles. amount: $39.92 channel: online risk_score: 0.72",
    investigationCutoff: baseCutoff,
    polarity: "neutral",
    decisionImpact: "medium",
    provenance: {
      queryOrSourceRef: "getTransactionContext",
      requestId: "req-txn-beh",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });

  const hypoLegit = createHypothesis({
    hypothesisId: "hypo-legit",
    investigationId: "inv-beh-001",
    type: "legitimate_activity",
    title: "Legitimate Activity",
    description: "Normal cardholder behavior",
    confidenceScore: 0.5,
    decisionRelevance: "High",
  });
  const hypoCNP = createHypothesis({
    hypothesisId: "hypo-cnp",
    investigationId: "inv-beh-001",
    type: "card_not_present",
    title: "Card Not Present Fraud",
    description: "CNP unauthorized transaction",
    confidenceScore: 0.5,
    decisionRelevance: "High",
  });

  const behRes = analyzer.analyzeBehaviorEvidence(validState, [txnEvidence], [hypoLegit, hypoCNP]);

  // E. No fabricated velocity & F. No baseline fabrication
  const baselineGapFinding = behRes.findings.find((f) => f.findingType === "baseline_history_gap");
  expect(baselineGapFinding !== undefined, "D/F: Missing baseline gap finding created");
  expect(Boolean(baselineGapFinding?.rationale.includes("Fabricating an assumed baseline is strictly prohibited")), "F: Anti-fabrication rationale verified");
  expect(behRes.requestedEvidence.includes("customer_pre_cutoff_behavioral_timeline"), "E/F: Requested evidence explicitly logs missing timeline");

  // G. No absence-of-evidence conclusion (sparse baseline does NOT mean transaction is legitimate or fraudulent)
  expect(baselineGapFinding?.supportingHypothesisTypes.length === 0, "G: Baseline gap does not support fraud");
  expect(baselineGapFinding?.contradictingHypothesisTypes.length === 0, "G: Baseline gap does not contradict fraud");

  // H. Competing hypothesis preservation (scores unchanged)
  expect(behRes.updatedHypotheses[0].confidenceScore === 0.5, "H: Legitimate hypothesis score unchanged");
  expect(behRes.updatedHypotheses[1].confidenceScore === 0.5, "H: CNP hypothesis score unchanged");

  // I. Commander integration
  const mockToolClient: CommanderToolClient = {
    async executeTool(toolName: TigerGraphReadTool, params: { txn?: string; cutoff?: string }, reqId: string) {
      if (toolName === "getTransactionContext") {
        return {
          results: [
            {
              transaction: { transaction_id: "3000183", amount: 39.92, channel: "online", risk_score: 0.72 },
              card_profiles: [{ card_profile_id: "CP-1", customer_id: "C08945" }],
            },
          ],
        };
      }
      return { results: [] };
    },
  };

  const commander = new CommanderOrchestrator(mockToolClient);
  const stepRes = await commander.executeInvestigationStep(validState, "step-beh-1", [hypoLegit, hypoCNP]);
  expect(stepRes.newFindings.some((f) => f.hunterName === "BehaviorHunter"), "I: BehaviorHunter findings present in step result");
  expect(stepRes.updatedState.requestedEvidence.includes("customer_pre_cutoff_behavioral_timeline"), "I: Requested evidence propagated to state");

  // J. Arbitrary GSQL rejection
  expectThrows(
    () =>
      validateToolInvocationRequest({
        toolName: "SELECT avg(amount) FROM Transaction;",
        parameters: { txn: "3000183", cutoff: baseCutoff },
        currentPhase: "triage",
        investigationCutoff: baseCutoff,
      }),
    ToolRegistryError,
    "J: Arbitrary GSQL rejected by ToolRegistry"
  );

  console.log("behavior-hunter foundation tests passed");
}

runBehaviorHunterTests();
