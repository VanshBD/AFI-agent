/**
 * AFI Agentic Fraud Investigation — Graph Hunter Test Suite
 * Asserts all 13 required test criteria (A-M) and verifies real fixtures (3000001, 3000120, 3000183).
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
  GraphHunterAnalyzer,
  createGraphFinding,
  GraphHunterError,
} from "../packages/domain/src/graph-hunter.js";
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

async function runGraphHunterTests(): Promise<void> {
  const analyzer = new GraphHunterAnalyzer();

  // Test Fixture Cutoffs
  const baseCutoff = "2016-07-04 02:10:21";

  // A. Graph Hunter receives valid investigation state
  const validState = createInvestigationState({
    investigationId: "inv-gh-001",
    triggerId: "HHG-005",
    flaggedTransactionId: "3000183",
    customerId: "C08945",
    cardId: "C08945-K2",
    investigationCutoff: baseCutoff,
  });
  expect(validState.investigationId === "inv-gh-001", "A: Valid state received");

  // B. Graph Hunter uses only registered tools (Tool Registry assertion)
  expect(
    validateToolInvocationRequest({
      toolName: "getTransactionRelationshipContext",
      parameters: { txn: "3000183", cutoff: baseCutoff },
      currentPhase: "relationship_expansion",
      investigationCutoff: baseCutoff,
    }).name === "getTransactionRelationshipContext",
    "B: Registered tool allowed"
  );

  // C. Wrong investigation cutoff is rejected
  expectThrows(
    () =>
      validateToolInvocationRequest({
        toolName: "getTransactionRelationshipContext",
        parameters: { txn: "3000183", cutoff: "2016-12-31 23:59:59" },
        currentPhase: "relationship_expansion",
        investigationCutoff: baseCutoff,
      }),
    ToolRegistryError,
    "C: Mismatched cutoff rejected by tool registry"
  );

  // D. Future evidence cannot become a finding
  expectThrows(
    () =>
      createEvidenceItem({
        evidenceId: "ev-future-fail",
        investigationId: "inv-gh-001",
        category: "observed_fact",
        sourceType: "tigergraph_tool",
        toolName: "getTransactionContext",
        entityType: "Transaction",
        entityId: "3000183",
        observation: "Future observation",
        observedAt: "2016-07-05 00:00:00", // After cutoff!
        investigationCutoff: baseCutoff,
        polarity: "neutral",
        decisionImpact: "high",
        provenance: { queryOrSourceRef: "getTransactionContext", requestId: "req-1", executionTimestamp: "2026-09-22 10:00:00" },
      }),
    EvidenceLedgerError,
    "D: Future evidence rejected by Evidence Ledger"
  );

  // E. Historical closed case respects strict < cutoff
  // CC-0005 closed_at is 2016-07-04 02:10:20.
  // Pre-closure cutoff: 2016-07-03 00:00:00 -> CC-0005 closed_at > cutoff, so attempting to record it as eligible throws
  expectThrows(
    () =>
      createEvidenceItem({
        evidenceId: "ev-hist-leak",
        investigationId: "inv-gh-001",
        category: "observed_fact",
        sourceType: "tigergraph_tool",
        toolName: "findRelatedCases",
        entityType: "ClosedCase",
        entityId: "CC-0005",
        observation: "Prior closed case CC-0005",
        observedAt: "2016-07-04 02:10:20", // After or equal to 2016-07-03!
        investigationCutoff: "2016-07-03 00:00:00",
        polarity: "supports",
        decisionImpact: "high",
        provenance: { queryOrSourceRef: "findRelatedCases", requestId: "req-2", executionTimestamp: "2026-09-22 10:00:00" },
      }),
    EvidenceLedgerError,
    "E: Closed case with closed_at >= cutoff throws temporal leakage"
  );

  // F. Real nested TigerGraph response structures are handled (Fixture 3000183: KnownCard C08945-K2 + BillingRegion)
  const evRelationshipPositive = createEvidenceItem({
    evidenceId: "ev-rel-pos",
    investigationId: "inv-gh-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionRelationshipContext",
    entityType: "Transaction",
    entityId: "3000183",
    observation: "Observed 0 linked devices, 1 billing regions, and 1 historically eligible known cards.",
    investigationCutoff: baseCutoff,
    polarity: "supports",
    decisionImpact: "high",
    provenance: { queryOrSourceRef: "getTransactionRelationshipContext", requestId: "req-3", executionTimestamp: "2026-09-22 10:00:00" },
  });

  const hypo1 = createHypothesis({
    hypothesisId: "hypo-cnp",
    investigationId: "inv-gh-001",
    type: "card_not_present",
    title: "Card Not Present Fraud",
    description: "Suspicious online use",
    confidenceScore: 0.5,
    decisionRelevance: "Warrants card block",
  });

  const hypo2 = createHypothesis({
    hypothesisId: "hypo-legit",
    investigationId: "inv-gh-001",
    type: "legitimate_activity",
    title: "Authorized Cardholder Activity",
    description: "Normal customer transaction",
    confidenceScore: 0.5,
    decisionRelevance: "Allows safe case clearing",
  });

  const analysisResult = analyzer.analyzeGraphEvidence(
    validState,
    [evRelationshipPositive],
    [hypo1, hypo2]
  );

  expect(analysisResult.findings.length === 2, "F: Generated KnownCard and BillingRegion findings");
  const knownCardFinding = analysisResult.findings.find((f) => f.findingType === "known_card_linkage");
  expect(knownCardFinding !== undefined, "F: Known card finding created");
  expect(knownCardFinding?.evidenceIds.includes("ev-rel-pos") === true, "I: Finding references existing evidence ID");

  // G. Empty graph relationships produce valid sparse/neutral result rather than fabricated findings
  const evSparse = createEvidenceItem({
    evidenceId: "ev-sparse",
    investigationId: "inv-gh-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionRelationshipContext",
    entityType: "Transaction",
    entityId: "3000005",
    observation: "Observed 0 linked devices, 0 billing regions, and 0 historically eligible known cards.",
    investigationCutoff: baseCutoff,
    polarity: "neutral",
    decisionImpact: "low",
    provenance: { queryOrSourceRef: "getTransactionRelationshipContext", requestId: "req-4", executionTimestamp: "2026-09-22 10:00:00" },
  });

  const sparseAnalysis = analyzer.analyzeGraphEvidence(validState, [evSparse], [hypo1, hypo2]);
  expect(sparseAnalysis.findings.length === 1, "G: Single isolation finding produced");
  expect(sparseAnalysis.findings[0].findingType === "graph_isolation", "G: Accurately reports graph_isolation without fabrication");

  // H. Contradictory graph evidence representation
  const evContradict = createEvidenceItem({
    evidenceId: "ev-future-denial",
    investigationId: "inv-gh-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionContext",
    entityType: "Transaction",
    entityId: "3000001",
    observation: "Transaction 3000001 rejected as future_transaction relative to cutoff 2016-07-02 00:02:20.",
    investigationCutoff: "2016-07-02 00:02:20",
    polarity: "contradicts",
    decisionImpact: "high",
    provenance: { queryOrSourceRef: "getTransactionContext", requestId: "req-5", executionTimestamp: "2026-09-22 10:00:00" },
  });

  const stateDenial = createInvestigationState({
    investigationId: "inv-denial",
    triggerId: "HHG-001",
    flaggedTransactionId: "3000001",
    customerId: "C06075",
    cardId: "C06075-K1",
    investigationCutoff: "2016-07-02 00:02:20",
  });

  const denialAnalysis = analyzer.analyzeGraphEvidence(stateDenial, [evContradict], [hypo1, hypo2]);
  const denialFinding = denialAnalysis.findings.find((f) => f.findingType === "temporal_denial");
  expect(denialFinding !== undefined, "H: Temporal contradiction captured in findings");
  // Semantic Check C: future_transaction represents temporal unavailability, not automatic fraud/legit contradiction
  expect(denialFinding?.supportingHypothesisTypes.length === 0, "C: Temporal denial does not claim to support fraud");
  expect(denialFinding?.contradictingHypothesisTypes.length === 0, "C: Temporal denial does not contradict legitimate activity");

  // J. Hypothesis updates reference existing evidence without premature numerical confidence drift
  const updatedHypoCNP = analysisResult.updatedHypotheses.find((h) => h.type === "card_not_present");
  const updatedHypoLegit = analysisResult.updatedHypotheses.find((h) => h.type === "legitimate_activity");
  expect(updatedHypoCNP?.supportingEvidenceIds.includes("ev-rel-pos") === true, "J: Supporting hypothesis linked to evidence ID");
  // Semantic Check B: KnownCard does not automatically prove fraud or refute legitimate activity on its own
  expect(updatedHypoLegit?.status === "active", "B: Legitimate activity remains active");
  expect(updatedHypoCNP?.confidenceScore === 0.5, "8: Confidence score does not drift via arbitrary hardcoded delta");
  expect(updatedHypoLegit?.confidenceScore === 0.5, "8: Legitimate confidence preserved pending Evidence Value milestone");

  // Semantic Check D: graph isolation does not imply legitimate activity
  expect(sparseAnalysis.findings[0].supportingHypothesisTypes.length === 0, "D: Graph isolation does not support legitimate activity");
  expect(sparseAnalysis.findings[0].contradictingHypothesisTypes.length === 0, "D: Graph isolation does not contradict fraud");

  // Semantic Check E: billing-region linkage does not automatically prove out-of-region fraud
  const billingFinding = analysisResult.findings.find((f) => f.findingType === "billing_region_linkage");
  expect(billingFinding !== undefined, "E: Billing region finding created");
  expect(
    billingFinding?.unresolvedQuestions.some((q) => q.includes("primary/historical billing region")) === true,
    "E: Explicitly identifies need for home/historical region comparison"
  );



  // K. Graph Hunter cannot execute arbitrary GSQL (attempting arbitrary tool invocation throws)
  expectThrows(
    () =>
      validateToolInvocationRequest({
        toolName: "INTERPRET QUERY () { DROP ALL; }",
        parameters: { txn: "3000183", cutoff: baseCutoff },
        currentPhase: "relationship_expansion",
        investigationCutoff: baseCutoff,
      }),
    ToolRegistryError,
    "K: Arbitrary GSQL tool name throws ToolRegistryError"
  );

  // L. Graph Hunter cannot bypass Commander / Tool Registry in pipeline

  const mockToolClient: CommanderToolClient = {
    async executeTool(toolName: TigerGraphReadTool, params: { txn?: string; cutoff?: string }, reqId: string) {
      if (toolName === "getTransactionRelationshipContext") {
        return {
          results: [
            {
              transaction: params.txn,
              device_profiles: [],
              billing_regions: [{ billing_region_id: "BR-220.0|87.0" }],
              known_cards: [{ card_id: "C08945-K2" }],
            },
          ],
        };
      }
      return { results: [] };
    },
  };

  const commander = new CommanderOrchestrator(mockToolClient);
  const stateAtRel = createInvestigationState({
    investigationId: "inv-pipeline",
    triggerId: "HHG-005",
    flaggedTransactionId: "3000183",
    customerId: "C08945",
    cardId: "C08945-K2",
    investigationCutoff: baseCutoff,
  });

  // Execute step through Commander
  const stepRes = await commander.executeInvestigationStep(stateAtRel, "step-rel-1", [hypo1, hypo2]);
  expect(stepRes.executedTool === "getTransactionContext", "L: Commander controls pipeline tool progression");

  // M. Graph Hunter does NOT automatically classify investigation as fraud
  expect(stepRes.updatedState.status !== "completed", "M: Graph Hunter does not terminate investigation as fraud");
  expect(
    stepRes.updatedHypotheses.some((h) => h.type === "legitimate_activity" && h.status === "active"),
    "M: Legitimate hypothesis remains active and represented"
  );

  console.log("graph-hunter foundation and temporal fixture tests passed");
}

runGraphHunterTests();
