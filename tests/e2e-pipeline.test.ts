import {
  createInvestigationState,
} from "../packages/domain/src/investigation-state.js";
import {
  createHypothesis,
} from "../packages/domain/src/hypotheses.js";
import {
  CommanderOrchestrator,
  CommanderToolClient,
} from "../packages/domain/src/commander.js";
import { TigerGraphReadTool } from "../packages/tigergraph/src/read-tool-contracts.js";
import { DeterministicTestModelGateway } from "../packages/domain/src/model-gateway.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function runE2EPipelineTests(): Promise<void> {
  const baseCutoff = "2016-07-04 02:10:21";

  // Mock full end-to-end multi-phase query client with real fixture data
  const mockToolClient: CommanderToolClient = {
    async executeTool(toolName: TigerGraphReadTool, params: { txn?: string; cutoff?: string }, reqId: string) {
      if (toolName === "getTransactionContext") {
        return {
          results: [
            {
              transaction: {
                transaction_id: "3000183",
                amount: 39.92,
                channel: "online",
                risk_score: 0.72,
              },
              card_profiles: [{ card_profile_id: "CP-69cb3841517044a914ad2b0c", customer_id: "C08945" }],
            },
          ],
        };
      }
      if (toolName === "getTransactionRelationshipContext") {
        return {
          results: [
            {
              transaction: "3000183",
              device_profiles: [{ device_profile_id: "DP-94937a4e260ee98b6678e653" }],
              billing_regions: [{ billing_region_id: "BR-220.0|87.0" }],
              purchaser_email_domains: [{ domain: "aol.com" }],
              recipient_email_domains: [],
              known_cards: [{ card_id: "C08945-K2" }],
            },
          ],
        };
      }
      if (toolName === "findRelatedCases") {
        return {
          results: [
            {
              transaction: "3000183",
              eligible_closed_cases: [
                {
                  case_id: "CC-0005",
                  outcome: "confirmed_fraud",
                  closed_at: "2016-07-04 02:10:20",
                },
              ],
              fraud_patterns: [{ pattern_id: "out_of_region_use" }],
              known_cards: [{ card_id: "C08945-K2" }],
            },
          ],
        };
      }
      return { results: [] };
    },
  };

  const modelGateway = new DeterministicTestModelGateway(() => ({
    summary: "Investigation complete with verified historical fraud match.",
  }));

  const commander = new CommanderOrchestrator(mockToolClient, modelGateway);

  const state = createInvestigationState({
    investigationId: "inv-e2e-1",
    triggerId: "HHG-005",
    flaggedTransactionId: "3000183",
    customerId: "C08945",
    cardId: "C08945-K2",
    investigationCutoff: baseCutoff,
    riskScore: 0.72,
  });

  const hypLegit = createHypothesis({
    hypothesisId: "hyp-e2e-legit",
    investigationId: "inv-e2e-1",
    type: "legitimate_activity",
    title: "Legitimate Activity",
    description: "Benign user spending",
    confidenceScore: 0.5,
    decisionRelevance: "High",
  });

  const hypOOR = createHypothesis({
    hypothesisId: "hyp-e2e-oor",
    investigationId: "inv-e2e-1",
    type: "out_of_region_use",
    title: "Out of Region Fraud",
    description: "Geographic mismatch fraud",
    confidenceScore: 0.5,
    decisionRelevance: "High",
  });

  let hypotheses = [hypLegit, hypOOR];

  // Run Step 1: getTransactionContext
  const step1 = await commander.executeInvestigationStep(state, "req-1", hypotheses);
  expect(step1.executedTool === "getTransactionContext", "Step 1 executes getTransactionContext");
  hypotheses = [...step1.updatedHypotheses];

  // Run Step 2: getTransactionRelationshipContext
  const step2 = await commander.executeInvestigationStep(step1.updatedState, "req-2", hypotheses);
  expect(step2.executedTool === "getTransactionRelationshipContext", "Step 2 executes getTransactionRelationshipContext");
  hypotheses = [...step2.updatedHypotheses];

  // Run Step 3: findRelatedCases
  const step3 = await commander.executeInvestigationStep(step2.updatedState, "req-3", hypotheses);
  expect(step3.executedTool === "findRelatedCases", "Step 3 executes findRelatedCases");
  expect(step3.decision.action === "STOP", "Commander correctly terminates when graph phases complete");
  expect(step3.decision.reasonCode === "sufficient_evidence_exists", "Correct terminal reason");

  // Verify Milestone 3: Decision Sensitivities and Evidence Value
  expect(step3.decisionSensitivities !== undefined, "Decision sensitivities produced");
  expect(step3.evidenceValueResult !== undefined, "Evidence value evaluated");

  // Verify Milestone 4: Adversarial perspective findings
  expect(step3.adversarialResult !== undefined, "Adversarial result populated");
  expect(step3.adversarialResult?.prosecutorFindings.length! > 0, "Prosecutor findings identified");
  expect(step3.adversarialResult?.defenseFindings.length! > 0, "Defense findings identified");

  // Verify Milestone 5: Next-Best-Action and Policy Routing
  expect(step3.policyResult !== undefined, "Policy result evaluated");
  expect(step3.policyResult?.recommendedAction.actionType === "block_card", "Recommends block_card on confirmed fraud precedent");
  expect(step3.policyResult?.authorizationLevel === "L1", "Requires L1 authorization for block_card");
  expect(step3.policyResult?.canExecuteAutomatically === false, "Does NOT auto-execute block without human approval");

  console.log("end-to-end investigation pipeline tests passed");
}

runE2EPipelineTests();
