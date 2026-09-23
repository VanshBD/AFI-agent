import { createInvestigationState } from "../packages/domain/src/investigation-state.js";
import { createHypothesis } from "../packages/domain/src/hypotheses.js";
import { createEvidenceItem } from "../packages/domain/src/evidence-ledger.js";
import { DecisionSensitivityAnalyzer } from "../packages/domain/src/decision-sensitivity.js";
import { EvidenceValueEngine } from "../packages/domain/src/evidence-value.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function runEvidenceValueAndSensitivityTests(): Promise<void> {
  const state = createInvestigationState({
    investigationId: "inv-test-sens-1",
    triggerId: "trg-1",
    flaggedTransactionId: "3000001",
    customerId: "C10001",
    cardId: "C10001-K1",
    investigationCutoff: "2016-12-01 10:00:00",
    riskScore: 0.85,
  });

  const hyp = createHypothesis({
    hypothesisId: "hyp-1",
    investigationId: "inv-test-sens-1",
    type: "card_not_present",
    title: "Card Not Present Fraud",
    description: "Suspicious CNP transaction",
    decisionRelevance: "Determines if card blocking is needed",
    confidenceScore: 0.70,
  });

  const analyzer = new DecisionSensitivityAnalyzer();
  const currentAction = analyzer.evaluateCurrentAction(state, [hyp], []);
  expect(currentAction === "BLOCK", "Current action should evaluate to BLOCK for 0.85 risk and 0.70 fraud confidence");

  const sensitivities = analyzer.analyzeSensitivity(state, [hyp], []);
  expect(sensitivities.length >= 2, "Should identify missing relationship and case-memory queries");
  const relSens = sensitivities.find((s) => s.evidenceNeeded === "getTransactionRelationshipContext");
  expect(relSens !== undefined, "Must identify relationship query sensitivity");
  expect(relSens?.expectedImpact === "critical", "Relationship sensitivity must be critical");

  const engine = new EvidenceValueEngine();
  const result = engine.evaluateEvidenceValue(state, [hyp], sensitivities);

  expect(result.shouldContinueInvestigation === true, "Should continue investigation when queryable tools exist");
  expect(result.topRecommendedNeed !== undefined, "Must have top recommended need");
  expect(result.topRecommendedNeed?.suggestedTool === "getTransactionContext", "First tool must be getTransactionContext");
  expect(result.topRecommendedNeed?.expectedDecisionImpact === "critical", "Transaction attributes must have critical impact");

  console.log("evidence-value and decision-sensitivity tests passed");
}

runEvidenceValueAndSensitivityTests();
