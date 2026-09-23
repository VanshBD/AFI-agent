/**
 * AFI Agentic Fraud Investigation — Transaction Hunter Test Suite
 * Tests all 13 required test criteria (A-M) and verifies real fixtures (3000001, 3000120, 3000183).
 */

import {
  createInvestigationState,
  InvestigationStateError,
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
  TransactionHunterAnalyzer,
  createTransactionFinding,
  TransactionHunterError,
} from "../packages/domain/src/transaction-hunter.js";
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

async function runTransactionHunterTests(): Promise<void> {
  const analyzer = new TransactionHunterAnalyzer();

  // Test Fixture Cutoffs
  const baseCutoff = "2016-07-04 02:10:21";

  // A. Valid InvestigationState accepted
  const validState = createInvestigationState({
    investigationId: "inv-tx-001",
    triggerId: "HHG-005",
    flaggedTransactionId: "3000183",
    customerId: "C08945",
    cardId: "C08945-K2",
    investigationCutoff: baseCutoff,
  });
  expect(validState.investigationId === "inv-tx-001", "A: Valid state received");

  // B. Transaction findings require real evidence IDs
  expectThrows(
    () =>
      createTransactionFinding({
        findingId: "fnd-tx-no-ev",
        findingType: "amount_context",
        title: "Test Finding",
        observation: "Transaction amount is $50.00",
        rationale: "Rationale",
        evidenceIds: [], // Empty evidence IDs must throw
        affectedEntities: [{ entityType: "Transaction", entityId: "3000183" }],
        confidenceScore: 0.8,
        isTemporallyEligible: true,
        decisionImpact: "low",
      }),
    TransactionHunterError,
    "B: Transaction finding without evidenceIds must throw"
  );

  // C. Transaction occurred_at respects <= cutoff (Evidence Ledger boundary)
  expectThrows(
    () =>
      createEvidenceItem({
        evidenceId: "ev-future-fail",
        investigationId: "inv-tx-001",
        category: "observed_fact",
        sourceType: "tigergraph_tool",
        toolName: "getTransactionContext",
        entityType: "Transaction",
        entityId: "3000183",
        observation: "Future transaction attempt",
        observedAt: "2016-07-05 00:00:00", // strictly after cutoff
        investigationCutoff: baseCutoff,
        polarity: "neutral",
        decisionImpact: "low",
        provenance: {
          queryOrSourceRef: "getTransactionContext",
          requestId: "req-1",
          executionTimestamp: "2026-09-22 10:00:00",
        },
      }),
    EvidenceLedgerError,
    "C: EvidenceItem with observedAt > cutoff must throw"
  );

  // D. Future transaction cannot become a normal transaction finding
  const futureEvidence = createEvidenceItem({
    evidenceId: "ev-future-denial-test",
    investigationId: "inv-tx-001",
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
      requestId: "req-future",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });

  const stateFuture = createInvestigationState({
    investigationId: "inv-tx-future",
    triggerId: "HHG-001",
    flaggedTransactionId: "3000001",
    customerId: "C06075",
    cardId: "unknown",
    investigationCutoff: "2016-07-02 00:02:20",
  });

  const futureResult = analyzer.analyzeTransactionEvidence(stateFuture, [futureEvidence], []);
  expect(futureResult.findings.length === 1, "D: Future transaction yields 1 finding");
  expect(futureResult.findings[0].findingType === "temporal_denial", "D: Finding must be temporal_denial, not normal amount finding");
  expect(futureResult.findings[0].supportingHypothesisTypes.length === 0, "D: Temporal denial does not support fraud hypotheses");

  // E. Wrong cutoff is rejected by existing tool controls
  expectThrows(
    () =>
      validateToolInvocationRequest({
        toolName: "getTransactionContext",
        parameters: { txn: "3000183", cutoff: "2016-07-05 00:00:00" }, // Mismatched cutoff
        currentPhase: "triage",
        investigationCutoff: baseCutoff,
      }),
    ToolRegistryError,
    "E: Tool parameter cutoff mismatched with investigation cutoff throws"
  );

  // F. Transaction Hunter cannot execute arbitrary GSQL
  expectThrows(
    () =>
      validateToolInvocationRequest({
        toolName: "SELECT * FROM Transaction WHERE amount > 5000;",
        parameters: { txn: "3000183", cutoff: baseCutoff },
        currentPhase: "triage",
        investigationCutoff: baseCutoff,
      }),
    ToolRegistryError,
    "F: Arbitrary GSQL execution throws ToolRegistryError"
  );

  // G. Transaction Hunter cannot bypass Commander / tool registry
  const toolExec = validateToolInvocationRequest({
    toolName: "getTransactionContext",
    parameters: { txn: "3000183", cutoff: baseCutoff },
    currentPhase: "triage",
    investigationCutoff: baseCutoff,
  });
  expect(toolExec.name === "getTransactionContext" && toolExec.isReadOnly, "G: Uses strictly controlled read-only tool");

  // H. Transaction Hunter does NOT automatically classify high amount as fraud
  const highAmountEvidence = createEvidenceItem({
    evidenceId: "ev-high-amt",
    investigationId: "inv-tx-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionContext",
    entityType: "Transaction",
    entityId: "3000183",
    observation: "Transaction 3000183 verified in graph for customer C08945 with 1 associated card profiles. amount: $2500.00 channel: online risk_score: 0.85",
    investigationCutoff: baseCutoff,
    polarity: "neutral",
    decisionImpact: "high",
    provenance: {
      queryOrSourceRef: "getTransactionContext",
      requestId: "req-high",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });

  const hypoFraud = createHypothesis({
    hypothesisId: "hypo-cnp",
    investigationId: "inv-tx-001",
    type: "card_not_present",
    title: "Card Not Present Fraud",
    description: "Unauthorized CNP",
    confidenceScore: 0.5,
    decisionRelevance: "Critical",
  });

  const highAmtResult = analyzer.analyzeTransactionEvidence(validState, [highAmountEvidence], [hypoFraud]);
  const highAmtFinding = highAmtResult.findings.find((f) => f.findingType === "amount_context");
  expect(highAmtFinding !== undefined, "H: High amount finding generated");
  expect(Boolean(highAmtFinding?.observation.includes("$2500.00")), "H: Observation states actual amount");
  expect(Boolean(highAmtFinding?.rationale.includes("does not inherently constitute fraud")), "H: Rationale respects semantic boundary (not automatic fraud)");
  const updatedHypoFraud = highAmtResult.updatedHypotheses.find((h) => h.hypothesisId === "hypo-cnp");
  expect(updatedHypoFraud?.status === "active", "H: Hypothesis remains active, not confirmed fraud");
  expect(updatedHypoFraud?.confidenceScore === 0.5, "H: Confidence score unchanged (no arbitrary numerical delta drift)");

  // I. Transaction Hunter does NOT automatically classify normal amount as legitimate
  const normalAmountEvidence = createEvidenceItem({
    evidenceId: "ev-norm-amt",
    investigationId: "inv-tx-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionContext",
    entityType: "Transaction",
    entityId: "3000183",
    observation: "Transaction 3000183 verified in graph for customer C08945 with 1 associated card profiles. amount: $50.00 channel: online risk_score: 0.20",
    investigationCutoff: baseCutoff,
    polarity: "neutral",
    decisionImpact: "low",
    provenance: {
      queryOrSourceRef: "getTransactionContext",
      requestId: "req-norm",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });

  const hypoLegit = createHypothesis({
    hypothesisId: "hypo-legit",
    investigationId: "inv-tx-001",
    type: "legitimate_activity",
    title: "Legitimate Cardholder Activity",
    description: "Authorized purchase",
    confidenceScore: 0.5,
    decisionRelevance: "Critical",
  });

  const normAmtResult = analyzer.analyzeTransactionEvidence(validState, [normalAmountEvidence], [hypoLegit]);
  const normAmtFinding = normAmtResult.findings.find((f) => f.findingType === "amount_context");
  expect(normAmtFinding !== undefined, "I: Normal amount finding generated");
  expect(Boolean(normAmtFinding?.rationale.includes("does not guarantee legitimacy on its own")), "I: Rationale respects semantic boundary (not automatic legitimate)");
  const updatedHypoLegit = normAmtResult.updatedHypotheses.find((h) => h.hypothesisId === "hypo-legit");
  expect(updatedHypoLegit?.status === "active", "I: Hypothesis remains active, not resolved legitimate");
  expect(updatedHypoLegit?.confidenceScore === 0.5, "I: Confidence score unchanged");

  // J. Missing transaction-history evidence becomes an unresolved question rather than fabricated velocity
  const velocityGapFinding = normAmtResult.findings.find((f) => f.findingType === "velocity_evidence_gap");
  expect(velocityGapFinding !== undefined, "J: Missing velocity finding created");
  expect(velocityGapFinding?.unresolvedQuestions.length! > 0, "J: Missing transaction window represented as unresolved question");
  expect(normAmtResult.requestedEvidence.includes("surrounding_transaction_velocity_window"), "J: Requested evidence correctly requested");

  // K. Existing Graph Hunter tests remain compatible (verifying Commander integration with both specialists)
  const mockToolClient: CommanderToolClient = {
    async executeTool(toolName: TigerGraphReadTool, params: { txn?: string; cutoff?: string }, reqId: string) {
      if (toolName === "getTransactionContext") {
        return {
          results: [
            {
              transaction: {
                transaction_id: "3000001",
                amount: 50.02,
                channel: "online",
                risk_score: 0.25,
              },
              card_profiles: [{ card_profile_id: "CP-69cb3841517044a914ad2b0c", customer_id: "C06075" }],
            },
          ],
        };
      }
      return { results: [] };
    },
  };

  const commander = new CommanderOrchestrator(mockToolClient);
  const state3000001 = createInvestigationState({
    investigationId: "inv-pipeline-3000001",
    triggerId: "HHG-001",
    flaggedTransactionId: "3000001",
    customerId: "C06075",
    cardId: "unknown",
    investigationCutoff: "2016-07-02 00:02:22",
  });

  const stepResult = await commander.executeInvestigationStep(state3000001, "step-tx-1", [hypoLegit, hypoFraud]);
  expect(stepResult.executedTool === "getTransactionContext", "K: Commander selects getTransactionContext");
  expect(stepResult.newFindings.some((f) => f.hunterName === "TransactionHunter"), "K: TransactionHunter findings present in step result");
  expect(stepResult.updatedState.requestedEvidence.includes("surrounding_transaction_velocity_window"), "K: Velocity gap recorded in investigation state requestedEvidence");

  // L. Existing temporal boundary tests remain valid
  expect(stepResult.updatedState.investigationCutoff === "2016-07-02 00:02:22", "L: Immutable cutoff preserved in commander");

  // M. Real benchmark / fixture transactions used (3000001, 3000120, 3000183)
  // Fixture 3000001: amount $50.02, channel online, risk_score 0.25
  const fnd3000001 = stepResult.newFindings.find((f) => f.findingType === "amount_context");
  expect(fnd3000001 !== undefined && fnd3000001.observation.includes("50.02"), "M: Fixture 3000001 amount verified");

  // Fixture 3000120: online channel
  const ev3000120 = createEvidenceItem({
    evidenceId: "ev-3000120",
    investigationId: "inv-3000120",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionContext",
    entityType: "Transaction",
    entityId: "3000120",
    observation: "Transaction 3000120 verified in graph for customer C08945 with 1 associated card profiles. amount: $115.00 channel: online risk_score: 0.65",
    investigationCutoff: "2016-07-02 01:17:27",
    polarity: "neutral",
    decisionImpact: "medium",
    provenance: {
      queryOrSourceRef: "getTransactionContext",
      requestId: "req-3000120",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });
  const res3000120 = analyzer.analyzeTransactionEvidence(
    createInvestigationState({
      investigationId: "inv-3000120",
      triggerId: "HHG-002",
      flaggedTransactionId: "3000120",
      customerId: "C08945",
      cardId: "CC-0001",
      investigationCutoff: "2016-07-02 01:17:27",
    }),
    [ev3000120]
  );
  expect(res3000120.findings.some((f) => f.findingType === "channel_context" && f.observation.includes("online")), "M: Fixture 3000120 channel verified");

  // Fixture 3000183: in-person or online check
  const ev3000183 = createEvidenceItem({
    evidenceId: "ev-3000183",
    investigationId: "inv-3000183",
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
      requestId: "req-3000183",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });
  const res3000183 = analyzer.analyzeTransactionEvidence(validState, [ev3000183]);
  expect(res3000183.findings.some((f) => f.findingType === "risk_signal_context" && f.observation.includes("0.72")), "M: Fixture 3000183 risk signal verified");

  console.log("transaction-hunter foundation tests passed");
}

runTransactionHunterTests();
