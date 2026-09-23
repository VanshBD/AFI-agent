/**
 * AFI Agentic Fraud Investigation — Case Memory Hunter Test Suite
 * Asserts all 12 required test criteria (A-L):
 * A. historical case eligibility
 * B. strict closed_at < cutoff
 * C. pre-closure case exclusion
 * D. post-closure case inclusion
 * E. known historical fraud precedent
 * F. historical cleared precedent
 * G. same-entity ambiguity
 * H. no automatic current-fraud conclusion
 * I. evidence provenance
 * J. hypothesis linking
 * K. arbitrary GSQL rejection
 * L. Commander integration
 * Uses verified historical fixtures: 3000183 / CC-0005.
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
  CaseMemoryHunterAnalyzer,
  createCaseMemoryFinding,
  CaseMemoryHunterError,
} from "../packages/domain/src/case-memory-hunter.js";
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

async function runCaseMemoryHunterTests(): Promise<void> {
  const analyzer = new CaseMemoryHunterAnalyzer();
  const baseCutoff = "2016-07-04 02:10:21";

  // A. Historical case eligibility / valid state
  const validState = createInvestigationState({
    investigationId: "inv-cm-001",
    triggerId: "HHG-005",
    flaggedTransactionId: "3000183",
    customerId: "C08945",
    cardId: "C08945-K2",
    investigationCutoff: baseCutoff,
  });
  expect(validState.investigationId === "inv-cm-001", "A: Valid state accepted");

  // B. Strict closed_at < cutoff & C. Pre-closure case exclusion
  // In EvidenceLedger, a ClosedCase with observedAt >= cutoff must throw (strict <)
  expectThrows(
    () =>
      createEvidenceItem({
        evidenceId: "ev-cm-leak",
        investigationId: "inv-cm-001",
        category: "observed_fact",
        sourceType: "tigergraph_tool",
        toolName: "findRelatedCases",
        entityType: "ClosedCase",
        entityId: "CC-FUTURE",
        observation: "Closed case",
        observedAt: baseCutoff, // Equal to cutoff is LEAKAGE for closed cases (< required)
        investigationCutoff: baseCutoff,
        polarity: "neutral",
        decisionImpact: "high",
        provenance: {
          queryOrSourceRef: "findRelatedCases",
          requestId: "req-cm-leak",
          executionTimestamp: "2026-09-22 10:00:00",
        },
      }),
    EvidenceLedgerError,
    "B/C: ClosedCase with closed_at >= cutoff must throw EvidenceLedgerError"
  );

  // D. Post-closure case inclusion (CC-0005 closed 2016-07-04 02:10:20 < baseCutoff 2016-07-04 02:10:21)
  const validClosedCaseEv = createEvidenceItem({
    evidenceId: "ev-cc-0005",
    investigationId: "inv-cm-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "findRelatedCases",
    entityType: "ClosedCase",
    entityId: "CC-0005",
    observation: "Identified 1 historically eligible closed cases prior to cutoff. outcomes: [confirmed_fraud]. patterns: [out_of_region_use].",
    observedAt: "2016-07-04 02:10:20", // strictly < cutoff
    investigationCutoff: baseCutoff,
    polarity: "supports",
    decisionImpact: "high",
    provenance: {
      queryOrSourceRef: "findRelatedCases",
      requestId: "req-cc-0005",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });
  expect(validClosedCaseEv.isTemporallyEligible, "D: Valid closed case prior to cutoff is eligible");

  // E. Known historical fraud precedent (fixture 3000183 / CC-0005)
  const hypoOOR = createHypothesis({
    hypothesisId: "hypo-oor",
    investigationId: "inv-cm-001",
    type: "out_of_region_use",
    title: "Out of Region Fraud",
    description: "Geographic mismatch fraud",
    confidenceScore: 0.5,
    decisionRelevance: "High",
  });

  const fraudRes = analyzer.analyzeCaseMemoryEvidence(validState, [validClosedCaseEv], [hypoOOR]);
  const fraudFinding = fraudRes.findings.find((f) => f.findingType === "historical_fraud_precedent");
  expect(fraudFinding !== undefined, "E: Historical fraud precedent finding created");

  // G. Same-entity ambiguity & H. No automatic current-fraud conclusion
  expect(Boolean(fraudFinding?.rationale.includes("past fraud on an entity does NOT prove the current transaction is fraudulent")), "G/H: Semantic boundary enforced (past fraud != current fraud)");
  const updatedHypoOOR = fraudRes.updatedHypotheses.find((h) => h.hypothesisId === "hypo-oor");
  expect(updatedHypoOOR?.status === "active", "H: Hypothesis remains active, not confirmed fraud");
  expect(updatedHypoOOR?.confidenceScore === 0.5, "H: Confidence score unchanged (no arbitrary drift)");

  // F. Historical cleared precedent
  const clearedCaseEv = createEvidenceItem({
    evidenceId: "ev-cc-cleared",
    investigationId: "inv-cm-001",
    category: "observed_fact",
    sourceType: "tigergraph_tool",
    toolName: "findRelatedCases",
    entityType: "ClosedCase",
    entityId: "CC-0001",
    observation: "Identified 1 historically eligible closed cases prior to cutoff. outcomes: [cleared].",
    observedAt: "2016-07-01 12:00:00",
    investigationCutoff: baseCutoff,
    polarity: "neutral",
    decisionImpact: "medium",
    provenance: {
      queryOrSourceRef: "findRelatedCases",
      requestId: "req-cc-cleared",
      executionTimestamp: "2026-09-22 10:00:00",
    },
  });

  const hypoLegit = createHypothesis({
    hypothesisId: "hypo-legit",
    investigationId: "inv-cm-001",
    type: "legitimate_activity",
    title: "Legitimate Activity",
    description: "Benign cardholder behavior",
    confidenceScore: 0.5,
    decisionRelevance: "High",
  });

  const clearedRes = analyzer.analyzeCaseMemoryEvidence(validState, [clearedCaseEv], [hypoLegit]);
  const clearedFinding = clearedRes.findings.find((f) => f.findingType === "historical_cleared_precedent");
  expect(clearedFinding !== undefined, "F: Historical cleared precedent finding created");
  expect(Boolean(clearedFinding?.rationale.includes("does NOT guarantee the current transaction is legitimate")), "F/H: Cleared precedent does not guarantee current legitimacy");

  // I. Evidence provenance required
  expectThrows(
    () =>
      createCaseMemoryFinding({
        findingId: "fnd-cm-no-ev",
        findingType: "historical_fraud_precedent",
        title: "Missing Evidence Finding",
        observation: "Past fraud",
        rationale: "Past fraud rationale",
        evidenceIds: [], // Empty must throw
        affectedEntities: [{ entityType: "ClosedCase", entityId: "CC-0005" }],
        confidenceScore: 0.8,
        isTemporallyEligible: true,
        decisionImpact: "high",
      }),
    CaseMemoryHunterError,
    "I: Finding without evidenceIds throws CaseMemoryHunterError"
  );

  // J. Hypothesis linking (evidence ID appended)
  expect(Boolean(updatedHypoOOR?.supportingEvidenceIds.includes("ev-cc-0005")), "J: Evidence ID linked to hypothesis");

  // K. Arbitrary GSQL rejection
  expectThrows(
    () =>
      validateToolInvocationRequest({
        toolName: "SELECT * FROM ClosedCase WHERE outcome = 'confirmed_fraud';",
        parameters: { txn: "3000183", cutoff: baseCutoff },
        currentPhase: "historical_retrospective",
        investigationCutoff: baseCutoff,
      }),
    ToolRegistryError,
    "K: Arbitrary GSQL rejected by ToolRegistry"
  );

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
              billing_regions: [{ billing_region_id: "BR-1" }],
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
              eligible_closed_cases: [{ case_id: "CC-0005", outcome: "confirmed_fraud", closed_at: "2016-07-04 02:10:20" }],
              fraud_patterns: [{ pattern_id: "out_of_region_use" }],
              known_cards: [{ card_id: "C08945-K2" }],
            },
          ],
        };
      }
      return { results: [] };
    },
  };

  const commander = new CommanderOrchestrator(mockToolClient);
  const s1 = await commander.executeInvestigationStep(validState, "step-cm-1", [hypoOOR]);
  const s2 = await commander.executeInvestigationStep(s1.updatedState, "step-cm-2", s1.updatedHypotheses);
  const s3 = await commander.executeInvestigationStep(s2.updatedState, "step-cm-3", s2.updatedHypotheses);

  expect(s3.executedTool === "findRelatedCases", "L: Commander executes findRelatedCases in step 3");
  expect(s3.newFindings.some((f) => f.hunterName === "CaseMemoryHunter"), "L: CaseMemoryHunter findings present in step result");
  expect(s3.newFindings.some((f) => f.hunterName === "GraphHunter"), "L: GraphHunter findings coexist");

  console.log("case-memory-hunter foundation tests passed");
}

runCaseMemoryHunterTests();
