/**
 * AFI Agentic Fraud Investigation — Graph Hunter Contract and Findings
 * Strongly typed, deterministic specialist for graph topological and relationship evidence analysis.
 * Operates purely through existing EvidenceLedger and CONTROLLED_TOOL_REGISTRY.
 */

import { DecisionImpact, InvestigationState, validateIdentifier } from "./investigation-state.js";
import { EvidenceItem } from "./evidence-ledger.js";
import { Hypothesis, updateHypothesis } from "./hypotheses.js";


export type GraphFindingType =
  | "device_linkage"
  | "domain_linkage"
  | "billing_region_linkage"
  | "known_card_linkage"
  | "historical_case_linkage"
  | "graph_isolation"
  | "temporal_denial";

export interface GraphFinding {
  readonly findingId: string;
  readonly hunterName: "GraphHunter";
  readonly findingType: GraphFindingType;
  readonly title: string;
  readonly observation: string;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
  readonly affectedEntities: readonly {
    readonly entityType: string;
    readonly entityId: string;
  }[];
  readonly supportingHypothesisTypes: readonly string[];
  readonly contradictingHypothesisTypes: readonly string[];
  readonly confidenceScore: number; // 0.0 to 1.0 (analytical strength)
  readonly isTemporallyEligible: boolean;
  readonly unresolvedQuestions: readonly string[];
  readonly decisionImpact: DecisionImpact;
  readonly createdAt: string;
}

export class GraphHunterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GraphHunterError";
  }
}

export function createGraphFinding(params: {
  readonly findingId: string;
  readonly findingType: GraphFindingType;
  readonly title: string;
  readonly observation: string;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
  readonly affectedEntities: readonly {
    readonly entityType: string;
    readonly entityId: string;
  }[];
  readonly supportingHypothesisTypes?: readonly string[];
  readonly contradictingHypothesisTypes?: readonly string[];
  readonly confidenceScore: number;
  readonly isTemporallyEligible: boolean;
  readonly unresolvedQuestions?: readonly string[];
  readonly decisionImpact: DecisionImpact;
}): GraphFinding {
  validateIdentifier(params.findingId, "findingId");

  if (!params.observation.trim()) {
    throw new GraphHunterError("Finding observation cannot be empty");
  }
  if (!params.rationale.trim()) {
    throw new GraphHunterError("Finding rationale cannot be empty");
  }
  if (params.confidenceScore < 0 || params.confidenceScore > 1) {
    throw new GraphHunterError("confidenceScore must be between 0.0 and 1.0");
  }
  if (params.evidenceIds.length === 0) {
    throw new GraphHunterError("Graph finding must reference at least one verified EvidenceItem ID");
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return Object.freeze({
    findingId: params.findingId,
    hunterName: "GraphHunter",
    findingType: params.findingType,
    title: params.title.trim(),
    observation: params.observation.trim(),
    rationale: params.rationale.trim(),
    evidenceIds: Object.freeze(Array.from(new Set(params.evidenceIds))),
    affectedEntities: Object.freeze(params.affectedEntities.map((e) => Object.freeze({ ...e }))),
    supportingHypothesisTypes: Object.freeze(
      params.supportingHypothesisTypes ? Array.from(new Set(params.supportingHypothesisTypes)) : []
    ),
    contradictingHypothesisTypes: Object.freeze(
      params.contradictingHypothesisTypes ? Array.from(new Set(params.contradictingHypothesisTypes)) : []
    ),
    confidenceScore: params.confidenceScore,
    isTemporallyEligible: params.isTemporallyEligible,
    unresolvedQuestions: Object.freeze(
      params.unresolvedQuestions ? Array.from(new Set(params.unresolvedQuestions)) : []
    ),
    decisionImpact: params.decisionImpact,
    createdAt: now,
  });
}

export interface GraphHunterAnalysisResult {
  readonly findings: readonly GraphFinding[];
  readonly updatedHypotheses: readonly Hypothesis[];
  readonly newEvidenceItems: readonly EvidenceItem[];
}

export class GraphHunterAnalyzer {
  /**
   * Performs deterministic graph topological and relationship analysis on verified evidence items.
   */
  public analyzeGraphEvidence(
    state: InvestigationState,
    evidenceItems: readonly EvidenceItem[],
    currentHypotheses: readonly Hypothesis[] = []
  ): GraphHunterAnalysisResult {
    // Enforce temporal safety: reject analysis if state has been tampered
    if (!state.investigationCutoff) {
      throw new GraphHunterError("Missing investigationCutoff in investigation state");
    }

    const findings: GraphFinding[] = [];
    const newEvidence: EvidenceItem[] = [];
    let updatedHypotheses = [...currentHypotheses];

    // Filter to only verified, temporally eligible evidence from the Evidence Ledger
    const eligibleEvidence = evidenceItems.filter((e) => e.isTemporallyEligible);

    for (const item of eligibleEvidence) {
      // 1. Transaction Temporal Denial Finding
      // Semantics: Indicates data availability at cutoff, NOT guilt or innocence of transaction
      if (item.observation.includes("future_transaction")) {
        findings.push(
          createGraphFinding({
            findingId: `fnd-${state.investigationId}-future-denial`,
            findingType: "temporal_denial",
            title: "Transaction Post-Dates Investigation Cutoff",
            observation: item.observation,
            rationale: "TigerGraph temporal predicate rejected transaction as post-dating cutoff. Evidence is unavailable at this cutoff.",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: item.entityType, entityId: item.entityId }],
            supportingHypothesisTypes: [],
            contradictingHypothesisTypes: [],
            confidenceScore: 1.0, // Absolute certainty regarding temporal boundary restriction
            isTemporallyEligible: true,
            unresolvedQuestions: ["Transaction occurred after current cutoff; review case opening timestamp."],
            decisionImpact: "high",
          })
        );
        continue;
      }

      // 2. Relationship Analysis (Devices, Email Domains, Billing Regions, KnownCards)
      if (item.toolName === "getTransactionRelationshipContext") {
        // KnownCard Linkage
        // Semantics: Structural precedent exists in a prior closed case; warrants investigation of card-not-present or out-of-region theories, but does NOT prove fraud on its own.
        if (item.observation.includes("historically eligible known cards")) {
          const match = item.observation.match(/(\d+)\s+historically eligible known cards/);
          const count = match ? parseInt(match[1], 10) : 0;

          if (count > 0) {
            const finding = createGraphFinding({
              findingId: `fnd-${state.investigationId}-known-card`,
              findingType: "known_card_linkage",
              title: "Associated Known Card Discovered in Prior Closed Cases",
              observation: `Transaction is linked through prior closed cases to ${count} confirmed business card(s).`,
              rationale: "Card identity established through historically closed cases prior to cutoff. Warrants checking historical card outcome.",
              evidenceIds: [item.evidenceId],
              affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
              supportingHypothesisTypes: ["card_not_present", "card_testing", "out_of_region_use"],
              contradictingHypothesisTypes: [],
              confidenceScore: 0.7,
              isTemporallyEligible: true,
              unresolvedQuestions: ["What was the closure outcome of the prior case associated with this KnownCard?"],
              decisionImpact: "high",
            });
            findings.push(finding);
            updatedHypotheses = this.linkFindingToHypotheses(finding, updatedHypotheses);
          }
        }

        // Billing Region Linkage
        // Semantics: Topological linkage to a billing region node. Does NOT prove out-of-region use without home region comparison.
        const billingMatch = item.observation.match(/(\d+)\s+billing regions/);
        const deviceMatch = item.observation.match(/(\d+)\s+linked devices/);
        const billingCount = billingMatch ? parseInt(billingMatch[1], 10) : 0;
        const deviceCount = deviceMatch ? parseInt(deviceMatch[1], 10) : 0;

        if (billingCount > 0) {
          findings.push(
            createGraphFinding({
              findingId: `fnd-${state.investigationId}-billing-region`,
              findingType: "billing_region_linkage",
              title: "Verified Billing Region Topological Link",
              observation: `Transaction resolved to ${billingCount} verified billing region node(s).`,
              rationale: "Topological edge BILLED_IN connects transaction to geographic billing node. Comparison against customer home region required to determine if out-of-region.",
              evidenceIds: [item.evidenceId],
              affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
              supportingHypothesisTypes: ["legitimate_activity", "out_of_region_use"],
              contradictingHypothesisTypes: [],
              confidenceScore: 0.6,
              isTemporallyEligible: true,
              unresolvedQuestions: ["Does the billed region match the cardholder's primary/historical billing region?"],
              decisionImpact: "medium",
            })
          );
        }

        // Graph Isolation
        // Semantics: Absence of returned relationships indicates sparse graph data or in-person activity; does NOT imply innocence or fraud.
        if (deviceCount === 0 && billingCount === 0) {
          findings.push(
            createGraphFinding({
              findingId: `fnd-${state.investigationId}-isolated`,
              findingType: "graph_isolation",
              title: "No Linked Device or Billing Region Relationships Returned",
              observation: "Transaction exhibits no linked devices or billing regions in current query scope.",
              rationale: "Absence of returned relationships is neutral context (e.g. in-person purchase); it is not evidence of absence of fraud or innocence.",
              evidenceIds: [item.evidenceId],
              affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
              supportingHypothesisTypes: [],
              contradictingHypothesisTypes: [],
              confidenceScore: 0.4,
              isTemporallyEligible: true,
              unresolvedQuestions: ["Is transaction channel in-person (W) or online with missing identity telemetry?"],
              decisionImpact: "low",
            })
          );
        }
      }

      // 3. Historical Case Retrospective Analysis
      // Semantics: Historical precedent from prior closed cases provides valuable pattern context, but does not automatically prove or clear current transaction.
      if (item.toolName === "findRelatedCases") {
        const caseMatch = item.observation.match(/(\d+)\s+historically eligible closed cases/);
        const caseCount = caseMatch ? parseInt(caseMatch[1], 10) : 0;

        if (caseCount > 0) {
          const finding = createGraphFinding({
            findingId: `fnd-${state.investigationId}-hist-cases`,
            findingType: "historical_case_linkage",
            title: "Historical Closed Case Precedent Available",
            observation: `Retrieved ${caseCount} closed cases sharing card or transaction entities that closed strictly before cutoff.`,
            rationale: "Prior investigation records under temporal integrity provide pattern hypotheses to evaluate.",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: item.entityType, entityId: item.entityId }],
            supportingHypothesisTypes: ["out_of_region_use", "card_not_present", "card_testing"],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.75,
            isTemporallyEligible: true,
            unresolvedQuestions: ["Does current transaction pattern match the confirmed pattern in historical cases?"],
            decisionImpact: "high",
          });
          findings.push(finding);
          updatedHypotheses = this.linkFindingToHypotheses(finding, updatedHypotheses);
        } else {
          findings.push(
            createGraphFinding({
              findingId: `fnd-${state.investigationId}-no-prior-cases`,
              findingType: "historical_case_linkage",
              title: "No Prior Closed Case Precedent",
              observation: "No historical closed cases found for this transaction prior to cutoff.",
              rationale: "Absence of prior case history is neutral baseline information.",
              evidenceIds: [item.evidenceId],
              affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
              supportingHypothesisTypes: [],
              contradictingHypothesisTypes: [],
              confidenceScore: 0.3,
              isTemporallyEligible: true,
              decisionImpact: "low",
            })
          );
        }
      }
    }

    return {
      findings: Object.freeze(findings),
      updatedHypotheses: Object.freeze(updatedHypotheses),
      newEvidenceItems: Object.freeze(newEvidence),
    };
  }

  /**
   * Links relevant finding evidence to hypotheses without imposing premature numerical certainty.
   * Numerical scoring is deferred to the Evidence Value Engine.
   */
  private linkFindingToHypotheses(
    finding: GraphFinding,
    hypotheses: readonly Hypothesis[]
  ): Hypothesis[] {
    return hypotheses.map((hypo) => {
      // If hypothesis type is supported by finding
      if (finding.supportingHypothesisTypes.includes(hypo.type)) {
        return updateHypothesis(hypo, {
          supportingEvidenceIds: [...hypo.supportingEvidenceIds, ...finding.evidenceIds],
        });
      }
      // If hypothesis type is contradicted by finding
      if (finding.contradictingHypothesisTypes.includes(hypo.type)) {
        return updateHypothesis(hypo, {
          contradictingEvidenceIds: [...hypo.contradictingEvidenceIds, ...finding.evidenceIds],
        });
      }
      return hypo;
    });
  }
}


