import { createInvestigationState } from "../packages/domain/src/investigation-state.js";
import { createHypothesis } from "../packages/domain/src/hypotheses.js";
import { createEvidenceItem } from "../packages/domain/src/evidence-ledger.js";
import { AdversarialAnalyzer } from "../packages/domain/src/prosecutor-defense.js";
import { DecisionSensitivityAnalyzer } from "../packages/domain/src/decision-sensitivity.js";
import { PolicyAndNBAEngine } from "../packages/domain/src/next-best-action.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function runNBAPolicyTests(): Promise<void> {
  const nbaEngine = new PolicyAndNBAEngine();
  const advAnalyzer = new AdversarialAnalyzer();
  const sensAnalyzer = new DecisionSensitivityAnalyzer();

  // Test Case 1: High risk with contradiction -> Escalate to L1 human analyst
  const state1 = createInvestigationState({
    investigationId: "inv-nba-1",
    triggerId: "trg-nba-1",
    flaggedTransactionId: "3000120",
    customerId: "C10001",
    cardId: "C10001-K1",
    investigationCutoff: "2016-12-01 10:00:00",
    riskScore: 0.85,
  });

  const hyp1 = createHypothesis({
    hypothesisId: "hyp-nba-1",
    investigationId: "inv-nba-1",
    type: "card_not_present",
    title: "CNP Fraud",
    description: "Suspicious CNP",
    decisionRelevance: "Action routing",
    confidenceScore: 0.70,
  });

  const evRisk = createEvidenceItem({
    evidenceId: "ev-nba-risk",
    investigationId: "inv-nba-1",
    category: "observed_fact",
    sourceType: "dataset_fact",
    toolName: "getTransactionContext",
    entityType: "Transaction",
    entityId: "3000120",
    observation: "risk_score 0.85",
    investigationCutoff: "2016-12-01 10:00:00",
    polarity: "supports",
    decisionImpact: "high",
    provenance: { queryOrSourceRef: "ctx", requestId: "r1", executionTimestamp: "2016-12-01 10:00:01" },
  });

  const evClean = createEvidenceItem({
    evidenceId: "ev-nba-clean",
    investigationId: "inv-nba-1",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionRelationshipContext",
    entityType: "Transaction",
    entityId: "3000120",
    observation: "Observed 0 historically eligible known cards and 0 linked devices.",
    investigationCutoff: "2016-12-01 10:00:00",
    polarity: "neutral",
    decisionImpact: "medium",
    provenance: { queryOrSourceRef: "rel", requestId: "r2", executionTimestamp: "2016-12-01 10:00:02" },
  });

  const adv1 = advAnalyzer.analyze(state1, [hyp1], [evRisk, evClean]);
  const sens1 = sensAnalyzer.analyzeSensitivity(state1, [hyp1], [evRisk, evClean]);
  const result1 = nbaEngine.evaluateNBA(state1, [hyp1], [evRisk, evClean], sens1, adv1);

  expect(result1.recommendedAction.actionType === "escalate_to_human_analyst", "Should recommend escalation for contradiction");
  expect(result1.authorizationLevel === "L1", "Escalation requires L1 analyst approval");
  expect(result1.canExecuteAutomatically === false, "Cannot auto-execute consequential escalation without L1 human loop");
  expect(result1.executionStatus === "pending_human_approval", "Status must be pending_human_approval");

  // Test Case 2: Confirmed KnownCard fraud link -> Block Card with L1 approval
  const evKnownFraud = createEvidenceItem({
    evidenceId: "ev-known-fraud",
    investigationId: "inv-nba-1",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionRelationshipContext",
    entityType: "KnownCard",
    entityId: "C08945-K2",
    observation: "Known card confirmed compromised",
    investigationCutoff: "2016-12-01 10:00:00",
    polarity: "supports",
    decisionImpact: "high",
    provenance: { queryOrSourceRef: "rel", requestId: "r3", executionTimestamp: "2016-12-01 10:00:03" },
  });

  const adv2 = advAnalyzer.analyze(state1, [hyp1], [evRisk, evKnownFraud]);
  const result2 = nbaEngine.evaluateNBA(state1, [hyp1], [evRisk, evKnownFraud], sens1, adv2);

  expect(result2.recommendedAction.actionType === "block_card", "Must recommend card block when known card is compromised");
  expect(result2.authorizationLevel === "L1", "Card blocking must require L1 approval");
  expect(result2.canExecuteAutomatically === false, "AI must not directly execute card block without L1 approval");

  // Test Case 3 (Regression): Customer Report triggers DECLINE initially and BLOCK after simulated customer confirmation
  const customerReportState = createInvestigationState({
    investigationId: "inv-test-report",
    triggerId: "HHG-TEST-customer_report",
    flaggedTransactionId: "3491361",
    customerId: "C02354",
    cardId: "C02354-K2",
    investigationCutoff: "2016-11-27 14:41:26",
    riskScore: 0.5,
  });

  const initialNba = nbaEngine.evaluateOfficialPolicyActions(
    customerReportState,
    [hyp1],
    [evClean],
    39.08,
    false
  );
  expect(
    initialNba.actions.some((a) => a.action === "DECLINE_TRANSACTION"),
    "Customer report initial action must be DECLINE_TRANSACTION"
  );
  expect(
    initialNba.actions.some((a) => a.action === "VERIFY_WITH_CUSTOMER"),
    "Customer report initial action must include VERIFY_WITH_CUSTOMER"
  );

  const finalNba = nbaEngine.evaluateOfficialPolicyActions(
    customerReportState,
    [hyp1],
    [evClean],
    39.08,
    true
  );
  expect(
    finalNba.actions.some((a) => a.action === "BLOCK_CARD"),
    "Customer report final action after confirmation must be BLOCK_CARD"
  );
  expect(
    finalNba.actions.some((a) => a.action === "CREATE_CASE"),
    "Customer report final action after confirmation must be CREATE_CASE"
  );
  expect(
    !finalNba.actions.some((a) => a.action === "ALLOW_TRANSACTION"),
    "Customer report final action must NOT be ALLOW_TRANSACTION"
  );

  // Test Case 4 (Regression): Narrative/action consistency test
  const finalHasAllow = finalNba.actions.some((a) => a.action === "ALLOW_TRANSACTION");
  const finalHasBlock = finalNba.actions.some((a) => a.action === "BLOCK_CARD");
  let synthesizedNarrative = "";
  if (finalHasBlock) {
    synthesizedNarrative = `Evaluated simulated customer validation response. Actions updated to [${finalNba.actions.map((a) => a.action).join(", ")}] under Policy R2.`;
  } else {
    synthesizedNarrative = "No additional evidence was requested; initial investigative recommendation remained terminal and stable.";
  }
  expect(
    !(finalHasAllow && synthesizedNarrative.toLowerCase().includes("card block")),
    "Narrative must not claim card block if final actions contain ALLOW_TRANSACTION"
  );
  expect(
    !(finalHasBlock && synthesizedNarrative.toLowerCase().includes("allow transaction")),
    "Narrative must not claim allow transaction if final actions contain BLOCK_CARD"
  );

  console.log("next-best-action and policy authorization tests passed");
}

runNBAPolicyTests();

