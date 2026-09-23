import { createInvestigationState } from "../packages/domain/src/investigation-state.js";
import { createHypothesis } from "../packages/domain/src/hypotheses.js";
import { createEvidenceItem } from "../packages/domain/src/evidence-ledger.js";
import { AdversarialAnalyzer } from "../packages/domain/src/prosecutor-defense.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function runAdversarialAnalyzerTests(): Promise<void> {
  const state = createInvestigationState({
    investigationId: "inv-test-adv-1",
    triggerId: "trg-adv-1",
    flaggedTransactionId: "3000120",
    customerId: "C10001",
    cardId: "C10001-K1",
    investigationCutoff: "2016-12-01 10:00:00",
    riskScore: 0.82,
  });

  const hypFraud = createHypothesis({
    hypothesisId: "hyp-fraud-1",
    investigationId: "inv-test-adv-1",
    type: "card_not_present",
    title: "Card Not Present Fraud",
    description: "Suspicious CNP transaction",
    decisionRelevance: "Determines if card blocking is needed",
    confidenceScore: 0.65,
  });

  const hypLegit = createHypothesis({
    hypothesisId: "hyp-legit-1",
    investigationId: "inv-test-adv-1",
    type: "legitimate_activity",
    title: "Legitimate Cardholder Activity",
    description: "Normal cardholder spend",
    decisionRelevance: "Determines if transaction should proceed",
    confidenceScore: 0.50,
  });

  const evRisk = createEvidenceItem({
    evidenceId: "ev-adv-risk",
    investigationId: "inv-test-adv-1",
    category: "observed_fact",
    sourceType: "dataset_fact",
    toolName: "getTransactionContext",
    entityType: "Transaction",
    entityId: "3000120",
    observation: "risk_score 0.82 observed on online channel",
    investigationCutoff: "2016-12-01 10:00:00",
    polarity: "supports",
    relevantHypothesisIds: [hypFraud.hypothesisId],
    decisionImpact: "high",
    provenance: {
      queryOrSourceRef: "getTransactionContext",
      requestId: "req-1",
      executionTimestamp: "2016-12-01 10:00:01",
    },
  });

  const evNoCompromise = createEvidenceItem({
    evidenceId: "ev-adv-clean-graph",
    investigationId: "inv-test-adv-1",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionRelationshipContext",
    entityType: "Transaction",
    entityId: "3000120",
    observation: "Observed 0 linked devices, 1 billing regions, and 0 historically eligible known cards.",
    investigationCutoff: "2016-12-01 10:00:00",
    polarity: "neutral",
    relevantHypothesisIds: [hypLegit.hypothesisId],
    decisionImpact: "medium",
    provenance: {
      queryOrSourceRef: "getTransactionRelationshipContext",
      requestId: "req-2",
      executionTimestamp: "2016-12-01 10:00:02",
    },
  });

  const analyzer = new AdversarialAnalyzer();
  const result = analyzer.analyze(state, [hypFraud, hypLegit], [evRisk, evNoCompromise]);

  expect(result.prosecutorFindings.length > 0, "Prosecutor must formulate findings based on elevated risk");
  expect(result.defenseFindings.length > 0, "Defense must formulate findings based on zero known-card compromise");
  expect(result.detectedContradictions.length > 0, "Must detect contradiction between high risk score and clean graph");
  expect(result.detectedContradictions[0].resolutionStatus === "unresolved", "Contradiction must remain unresolved without arbitrary confidence drift");

  console.log("adversarial analyzer & contradiction engine tests passed");
}

runAdversarialAnalyzerTests();
