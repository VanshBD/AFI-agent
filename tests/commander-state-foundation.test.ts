import {
  createInvestigationState,
  updateInvestigationState,
  InvestigationStateError,
} from "../packages/domain/src/investigation-state.js";
import {
  createEvidenceItem,
  EvidenceLedgerError,
} from "../packages/domain/src/evidence-ledger.js";
import {
  createHypothesis,
  HypothesisError,
} from "../packages/domain/src/hypotheses.js";
import {
  CONTROLLED_TOOL_REGISTRY,
  validateToolInvocationRequest,
  ToolRegistryError,
} from "../packages/domain/src/tool-registry.js";
import {
  CommanderOrchestrator,
  CommanderToolClient,
} from "../packages/domain/src/commander.js";
import { TigerGraphReadTool } from "../packages/tigergraph/src/read-tool-contracts.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectThrows<TError extends Error>(
  action: () => unknown,
  errorType: new (...args: any[]) => TError,
  message: string
): void {
  try {
    action();
  } catch (err) {
    expect(err instanceof errorType, `Expected ${errorType.name} but got ${(err as Error).name}: ${(err as Error).message}`);
    return;
  }
  throw new Error(`Expected throw (${message}) but action succeeded`);
}

async function runTests(): Promise<void> {
  const cutoffStr = "2016-12-05 01:55:28";

  // 1. Investigation state validation & creation
  const state = createInvestigationState({
    investigationId: "inv-001",
    triggerId: "HHG-001",
    flaggedTransactionId: "3000001",
    customerId: "C06075",
    cardId: "C06075-K1",
    investigationCutoff: cutoffStr,
    riskScore: 0.85,
  });

  expect(state.investigationId === "inv-001", "Investigation ID retained");
  expect(state.investigationCutoff === cutoffStr, "Cutoff retained");
  expect(state.currentPhase === "triage", "Initial phase is triage");

  // 2. Immutable cutoff invariant
  expectThrows(
    () => updateInvestigationState(state, { investigationCutoff: "2016-12-06 00:00:00" }),
    InvestigationStateError,
    "Mutating investigation cutoff must throw"
  );

  // 3. Evidence creation and separation of observed fact vs model interpretation
  const factEvidence = createEvidenceItem({
    evidenceId: "ev-01",
    investigationId: "inv-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionContext",
    entityType: "Transaction",
    entityId: "3000001",
    observation: "Amount is $50.02 and occurred at 2016-07-02 00:02:21",
    observedAt: "2016-07-02 00:02:21",
    investigationCutoff: cutoffStr,
    polarity: "neutral",
    decisionImpact: "medium",
    provenance: {
      queryOrSourceRef: "getTransactionContext",
      requestId: "req-1",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });
  expect(factEvidence.category === "observed_fact", "Fact evidence category verified");

  // 4. Temporal leakage rejection on evidence
  expectThrows(
    () =>
      createEvidenceItem({
        evidenceId: "ev-future",
        investigationId: "inv-001",
        category: "observed_fact",
        sourceType: "tigergraph_tool",
        toolName: "getTransactionContext",
        entityType: "Transaction",
        entityId: "3000999",
        observation: "Future transaction",
        observedAt: "2016-12-06 00:00:00", // After cutoff!
        investigationCutoff: cutoffStr,
        polarity: "neutral",
        decisionImpact: "high",
        provenance: {
          queryOrSourceRef: "getTransactionContext",
          requestId: "req-2",
          executionTimestamp: "2026-09-22 10:00:00",
        },
      }),
    EvidenceLedgerError,
    "Future evidence item must throw temporal leakage error"
  );

  // 5. Competing hypotheses foundation
  const fraudHypo = createHypothesis({
    hypothesisId: "hypo-1",
    investigationId: "inv-001",
    type: "card_not_present",
    title: "Unusual CNP online purchase",
    description: "Transaction flagged due to risk score",
    decisionRelevance: "Would warrant card block if confirmed",
    confidenceScore: 0.6,
  });

  const legitimateHypo = createHypothesis({
    hypothesisId: "hypo-2",
    investigationId: "inv-001",
    type: "legitimate_activity",
    title: "Authorized purchase by cardholder",
    description: "Normal customer transaction in home region",
    decisionRelevance: "Allows case closure without customer friction",
    confidenceScore: 0.4,
  });

  expect(fraudHypo.type !== legitimateHypo.type, "Competing hypotheses represented");

  // 6. Controlled Tool Registry allowlisting and phase enforcement
  expect("getTransactionContext" in CONTROLLED_TOOL_REGISTRY, "getTransactionContext is registered");
  expect(
    validateToolInvocationRequest({
      toolName: "getTransactionContext",
      parameters: { txn: "3000001", cutoff: cutoffStr },
      currentPhase: "triage",
      investigationCutoff: cutoffStr,
    }).name === "getTransactionContext",
    "Valid tool request accepted"
  );

  // Unregistered tool rejection
  expectThrows(
    () =>
      validateToolInvocationRequest({
        toolName: "arbitraryCustomGSQLQuery",
        parameters: { txn: "3000001", cutoff: cutoffStr },
        currentPhase: "triage",
        investigationCutoff: cutoffStr,
      }),
    ToolRegistryError,
    "Unregistered tool must throw"
  );

  // Phase permission rejection
  expectThrows(
    () =>
      validateToolInvocationRequest({
        toolName: "findRelatedCases", // Only permitted in relationship_expansion / historical_retrospective
        parameters: { txn: "3000001", cutoff: cutoffStr },
        currentPhase: "triage",
        investigationCutoff: cutoffStr,
      }),
    ToolRegistryError,
    "Tool called outside permitted phase must throw"
  );

  // Temporal guard rejection (tool parameter cutoff != investigation cutoff)
  expectThrows(
    () =>
      validateToolInvocationRequest({
        toolName: "getTransactionContext",
        parameters: { txn: "3000001", cutoff: "2016-12-31 23:59:59" },
        currentPhase: "triage",
        investigationCutoff: cutoffStr,
      }),
    ToolRegistryError,
    "Mismatched tool cutoff parameter must throw"
  );

  // 7. Commander Orchestrator Execution Flow
  const mockToolClient: CommanderToolClient = {
    async executeTool(toolName: TigerGraphReadTool, params: { txn?: string; cutoff?: string }, reqId: string) {
      if (toolName === "getTransactionContext") {
        return {
          results: [
            {
              transaction: params.txn,
              card_profiles: [{ card_profile_id: "CP-1", customer_id: "C06075" }],
            },
          ],
        };
      }
      if (toolName === "getTransactionRelationshipContext") {
        return {
          results: [
            {
              transaction: params.txn,
              device_profiles: [{ device_profile_id: "DP-1" }],
              billing_regions: [{ billing_region_id: "BR-1" }],
              known_cards: [],
            },
          ],
        };
      }
      if (toolName === "findRelatedCases") {
        return {
          results: [
            {
              transaction: params.txn,
              eligible_closed_cases: [{ case_id: "CC-0001", outcome: "cleared" }],
              known_cards: [],
            },
          ],
        };
      }
      return { results: [] };
    },
  };

  const commander = new CommanderOrchestrator(mockToolClient);

  // Step 1: Initial step from triage
  const step1 = await commander.executeInvestigationStep(state, "step-1");
  expect(step1.executedTool === "getTransactionContext", "Commander selects getTransactionContext first");
  expect(step1.updatedState.currentPhase === "relationship_expansion", "Phase transitions to relationship_expansion");
  expect(step1.decision.action === "CONTINUE", "Investigation continues after step 1");
  expect(step1.newEvidence.length === 1, "Evidence recorded in ledger");

  // Step 2: Relationship expansion
  const step2 = await commander.executeInvestigationStep(step1.updatedState, "step-2");
  expect(step2.executedTool === "getTransactionRelationshipContext", "Commander selects getTransactionRelationshipContext second");
  expect(step2.updatedState.currentPhase === "historical_retrospective", "Phase transitions to historical_retrospective");

  // Step 3: Historical retrospective
  const step3 = await commander.executeInvestigationStep(step2.updatedState, "step-3");
  expect(step3.executedTool === "findRelatedCases", "Commander selects findRelatedCases third");
  expect(step3.updatedState.currentPhase === "hypothesis_evaluation", "Phase transitions to hypothesis_evaluation");

  // Step 4: Stopping evaluation
  const step4 = await commander.executeInvestigationStep(step3.updatedState, "step-4");
  expect(step4.decision.action === "STOP", "Commander stops when evidence is sufficient");
  expect(step4.updatedState.status === "completed", "Investigation status completed");
  expect(step4.updatedState.investigationCutoff === cutoffStr, "Cutoff remained strictly immutable across all steps");

  // 8. Real TigerGraph Response Parsing & Error Containment
  const realTgToolClient: CommanderToolClient = {
    async executeTool(toolName: TigerGraphReadTool, params: { txn?: string; cutoff?: string }, reqId: string) {
      if (toolName === "getTransactionContext") {
        // Actual TigerGraph Savanna live response shape (nested v_id, v_type, attributes)
        return {
          version: { edition: "enterprise", api: "v2", schema: 1 },
          error: false,
          message: "",
          results: [
            {
              transaction: params.txn,
              card_profiles: [
                {
                  v_id: "CP-69cb3841517044a914ad2b0c",
                  v_type: "CardProfile",
                  attributes: {
                    card_profile_id: "CP-69cb3841517044a914ad2b0c",
                    customer_id: "C06075",
                    card1: "22563",
                    card2: "399.0",
                    card4: "american express",
                  },
                },
              ],
              cutoff: params.cutoff,
            },
          ],
        };
      }
      return { results: [] };
    },
  };

  const realCommander = new CommanderOrchestrator(realTgToolClient);
  const realStep = await realCommander.executeInvestigationStep(state, "real-step-1");
  expect(realStep.newEvidence.length === 1, "Real TigerGraph nested response creates evidence");
  expect(realStep.newEvidence[0].observation.includes("customer C06075"), "Customer ID correctly extracted from live TigerGraph attributes");

  // Future transaction temporal denial response handling
  const temporalDenialClient: CommanderToolClient = {
    async executeTool() {
      return {
        version: { edition: "enterprise", api: "v2", schema: 1 },
        error: false,
        message: "",
        results: [{ status: "future_transaction", transaction: "3000001", cutoff: "2016-07-02 00:02:20" }],
      };
    },
  };
  const denialCommander = new CommanderOrchestrator(temporalDenialClient);
  const denialStep = await denialCommander.executeInvestigationStep(state, "denial-step-1");
  expect(denialStep.newEvidence.length === 1, "Temporal denial creates evidence");
  expect(denialStep.newEvidence[0].polarity === "contradicts", "Temporal denial polarity contradicts");
  expect(denialStep.newEvidence[0].observation.includes("future_transaction"), "Observation notes temporal denial");

  // Malformed / error response handling
  const errorClient: CommanderToolClient = {
    async executeTool() {
      return { error: true, message: "Query timeout or internal error", results: null };
    },
  };
  const errorCommander = new CommanderOrchestrator(errorClient);
  const errorStep = await errorCommander.executeInvestigationStep(state, "error-step-1");
  expect(errorStep.newEvidence.length === 0, "Error response does not fabricate evidence");

  console.log("commander and investigation state foundation tests passed");
}


runTests();

