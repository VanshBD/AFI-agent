/**
 * AFI Agentic Fraud Investigation — Device / Identity Hunter Test Suite
 * Asserts all 12 required test criteria (A-L) and verifies identity/device telemetry handling.
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
  DeviceIdentityHunterAnalyzer,
  createDeviceIdentityFinding,
  DeviceIdentityHunterError,
} from "../packages/domain/src/device-identity-hunter.js";
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

async function runDeviceIdentityHunterTests(): Promise<void> {
  const analyzer = new DeviceIdentityHunterAnalyzer();
  const baseCutoff = "2016-07-04 02:10:21";

  // A. Typed state
  const validState = createInvestigationState({
    investigationId: "inv-did-001",
    triggerId: "HHG-005",
    flaggedTransactionId: "3000183",
    customerId: "C08945",
    cardId: "C08945-K2",
    investigationCutoff: baseCutoff,
  });
  expect(validState.investigationId === "inv-did-001", "A: Typed state accepted");

  // B. Controlled tool usage via registry
  const toolDef = validateToolInvocationRequest({
    toolName: "getTransactionRelationshipContext",
    parameters: { txn: "3000183", cutoff: baseCutoff },
    currentPhase: "relationship_expansion",
    investigationCutoff: baseCutoff,
  });
  expect(toolDef.name === "getTransactionRelationshipContext" && toolDef.isReadOnly, "B: Uses registered read tool");

  // C. Evidence IDs required
  expectThrows(
    () =>
      createDeviceIdentityFinding({
        findingId: "fnd-did-no-ev",
        findingType: "device_linkage",
        title: "Missing Evidence",
        observation: "Linked to device DP-1",
        rationale: "Device rationale",
        evidenceIds: [], // Empty must throw
        affectedEntities: [{ entityType: "Transaction", entityId: "3000183" }],
        confidenceScore: 0.8,
        isTemporallyEligible: true,
        decisionImpact: "medium",
      }),
    DeviceIdentityHunterError,
    "C: Finding without evidence IDs must throw"
  );

  // D. Cutoff preservation in state
  expect(validState.investigationCutoff === baseCutoff, "D: Immutable cutoff preserved in state");

  // E. Future evidence rejection
  expectThrows(
    () =>
      createEvidenceItem({
        evidenceId: "ev-future-did-fail",
        investigationId: "inv-did-001",
        category: "observed_fact",
        sourceType: "tigergraph_tool",
        toolName: "getTransactionRelationshipContext",
        entityType: "Transaction",
        entityId: "3000183",
        observation: "Future relationship",
        observedAt: "2016-07-05 00:00:00", // After cutoff
        investigationCutoff: baseCutoff,
        polarity: "neutral",
        decisionImpact: "medium",
        provenance: {
          queryOrSourceRef: "getTransactionRelationshipContext",
          requestId: "req-f-did",
          executionTimestamp: "2026-09-22 10:00:00",
        },
      }),
    EvidenceLedgerError,
    "E: Future observedAt rejected by EvidenceLedger"
  );

  // Future transaction yields temporal_denial finding without supporting fraud
  const futureEv = createEvidenceItem({
    evidenceId: "ev-future-denial-did",
    investigationId: "inv-did-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionRelationshipContext",
    entityType: "Transaction",
    entityId: "3000001",
    observation: "Transaction 3000001 rejected as future_transaction relative to cutoff 2016-07-02 00:02:20.",
    investigationCutoff: "2016-07-02 00:02:20",
    polarity: "contradicts",
    decisionImpact: "high",
    provenance: {
      queryOrSourceRef: "getTransactionRelationshipContext",
      requestId: "req-f2",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });
  const futureResult = analyzer.analyzeDeviceIdentityEvidence(validState, [futureEv]);
  expect(futureResult.findings[0].findingType === "temporal_denial", "E: Future transaction creates temporal_denial");
  expect(futureResult.findings[0].supportingHypothesisTypes.length === 0, "E: Denial does not support fraud");

  // F. No arbitrary GSQL
  expectThrows(
    () =>
      validateToolInvocationRequest({
        toolName: "INTERPRET QUERY () { DROP VERTEX DeviceProfile; }",
        parameters: { txn: "3000183", cutoff: baseCutoff },
        currentPhase: "relationship_expansion",
        investigationCutoff: baseCutoff,
      }),
    ToolRegistryError,
    "F: Arbitrary GSQL rejected by ToolRegistry"
  );

  // G. Device linkage interpretation (Device linked does NOT equal automatic fraud)
  const deviceEvidence = createEvidenceItem({
    evidenceId: "ev-device-linked",
    investigationId: "inv-did-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionRelationshipContext",
    entityType: "Transaction",
    entityId: "3000183",
    observation: "Observed 1 linked devices, 1 billing regions, and 0 historically eligible known cards. purchaser_domains: 1, recipient_domains: 1.",
    investigationCutoff: baseCutoff,
    polarity: "neutral",
    decisionImpact: "medium",
    provenance: {
      queryOrSourceRef: "getTransactionRelationshipContext",
      requestId: "req-dev",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });

  const hypoCNP = createHypothesis({
    hypothesisId: "hypo-cnp",
    investigationId: "inv-did-001",
    type: "card_not_present",
    title: "Card Not Present Fraud",
    description: "Unauthorized remote purchase",
    confidenceScore: 0.5,
    decisionRelevance: "High",
  });

  const deviceRes = analyzer.analyzeDeviceIdentityEvidence(validState, [deviceEvidence], [hypoCNP]);
  const devFinding = deviceRes.findings.find((f) => f.findingType === "device_linkage");
  expect(devFinding !== undefined, "G: Device linkage finding generated");
  expect(Boolean(devFinding?.rationale.includes("not inherently trusted or malicious")), "G: Device linkage respects semantic boundary");
  expect(deviceRes.updatedHypotheses[0].confidenceScore === 0.5, "G: Confidence score unchanged (no numerical drift)");

  // H. Sparse identity telemetry (0 devices does NOT equal legitimate)
  const sparseEvidence = createEvidenceItem({
    evidenceId: "ev-sparse-id",
    investigationId: "inv-did-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionRelationshipContext",
    entityType: "Transaction",
    entityId: "3000183",
    observation: "Observed 0 linked devices, 1 billing regions, and 0 historically eligible known cards.",
    investigationCutoff: baseCutoff,
    polarity: "neutral",
    decisionImpact: "low",
    provenance: {
      queryOrSourceRef: "getTransactionRelationshipContext",
      requestId: "req-sp",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });

  const sparseRes = analyzer.analyzeDeviceIdentityEvidence(validState, [sparseEvidence], [hypoCNP]);
  const sparseFinding = sparseRes.findings.find((f) => f.findingType === "sparse_identity_telemetry");
  expect(sparseFinding !== undefined, "H: Sparse identity telemetry finding generated");
  expect(Boolean(sparseFinding?.rationale.includes("does NOT prove fraud or legitimacy")), "H: Sparse telemetry is neutral");
  expect(sparseRes.requestedEvidence.includes("customer_device_binding_history"), "H: Requested evidence includes binding history");

  // I. Shared device ambiguity / Known card identity
  const knownCardEv = createEvidenceItem({
    evidenceId: "ev-known-card-id",
    investigationId: "inv-did-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "getTransactionRelationshipContext",
    entityType: "Transaction",
    entityId: "3000183",
    observation: "Observed 1 linked devices, 1 billing regions, and 1 historically eligible known cards. purchaser_domains: 1, recipient_domains: 1.",
    investigationCutoff: baseCutoff,
    polarity: "supports",
    decisionImpact: "high",
    provenance: {
      queryOrSourceRef: "getTransactionRelationshipContext",
      requestId: "req-kc",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });
  const kcRes = analyzer.analyzeDeviceIdentityEvidence(validState, [knownCardEv], [hypoCNP]);
  const kcFinding = kcRes.findings.find((f) => f.findingType === "known_card_identity");
  expect(kcFinding !== undefined, "I: Known card identity finding created");
  expect(kcFinding?.unresolvedQuestions.length! > 0, "I: Unresolved question regarding past compromise created");

  // J. Email/identity ambiguity (Email domains present does NOT prove account takeover automatically)
  const emailFinding = kcRes.findings.find((f) => f.findingType === "email_domain_context");
  expect(emailFinding !== undefined, "J: Email domain context finding created");
  expect(Boolean(emailFinding?.rationale.includes("do not automatically prove account takeover")), "J: Email mismatch respects semantic boundary");

  // K. Hypothesis linking without arbitrary score changes
  const updatedCNP = kcRes.updatedHypotheses.find((h) => h.hypothesisId === "hypo-cnp");
  expect(Boolean(updatedCNP?.supportingEvidenceIds.includes("ev-known-card-id")), "K: Evidence ID linked to supporting list");
  expect(updatedCNP?.confidenceScore === 0.5, "K: Confidence score strictly unchanged");

  // L. Commander integration
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
      if (toolName === "getTransactionRelationshipContext") {
        return {
          results: [
            {
              transaction: "3000183",
              device_profiles: [{ device_profile_id: "DP-1" }],
              billing_regions: [{ billing_region_id: "BR-220.0|87.0" }],
              purchaser_email_domains: [{ domain: "aol.com" }],
              recipient_email_domains: [],
              known_cards: [{ card_id: "C08945-K2" }],
            },
          ],
        };
      }
      return { results: [] };
    },
  };

  const commander = new CommanderOrchestrator(mockToolClient);
  const step1 = await commander.executeInvestigationStep(validState, "step-1", [hypoCNP]);
  const step2 = await commander.executeInvestigationStep(step1.updatedState, "step-2", step1.updatedHypotheses);
  expect(step2.executedTool === "getTransactionRelationshipContext", "L: Commander executes step 2");
  expect(step2.newFindings.some((f) => f.hunterName === "DeviceIdentityHunter"), "L: DeviceIdentityHunter findings present in step result");
  expect(step2.newFindings.some((f) => f.hunterName === "GraphHunter"), "L: GraphHunter findings coexist");

  console.log("device-identity-hunter foundation tests passed");
}

runDeviceIdentityHunterTests();
