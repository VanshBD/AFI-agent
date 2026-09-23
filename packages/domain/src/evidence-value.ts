/**
 * AFI Agentic Fraud Investigation — Evidence Value Engine
 * Evaluates candidate/requested evidence to answer:
 * "What evidence should we obtain next, and why?"
 * Avoids assuming "more evidence is always good".
 * Considers relevance, hypothesis discrimination, uncertainty reduction, decision impact, availability, and friction.
 */

import { InvestigationState } from "./investigation-state.js";
import { Hypothesis } from "./hypotheses.js";
import { DecisionSensitivity } from "./decision-sensitivity.js";
import { TigerGraphReadTool } from "../../tigergraph/src/read-tool-contracts.js";

export interface EvaluatedEvidenceNeed {
  readonly evidenceType: string;
  readonly reasonRequested: string;
  readonly targetHypothesisIds: readonly string[];
  readonly expectedDecisionImpact: "critical" | "high" | "medium" | "low";
  readonly availability: "immediately_queryable" | "requires_external_system" | "requires_customer_contact" | "unavailable";
  readonly acquisitionFriction: "none" | "low" | "medium" | "high";
  readonly priorityScore: number; // 0.0 to 1.0 structured ranking
  readonly suggestedTool?: TigerGraphReadTool;
  readonly authorizationRequirement: "auto" | "L1" | "L2";
  readonly decisionSensitivityRef?: string;
}

export interface EvidenceValueResult {
  readonly evaluatedNeeds: readonly EvaluatedEvidenceNeed[];
  readonly topRecommendedNeed?: EvaluatedEvidenceNeed;
  readonly shouldContinueInvestigation: boolean;
  readonly stoppingReason?:
    | "sufficient_evidence_exists"
    | "no_high_value_evidence_available"
    | "all_permitted_tools_exhausted"
    | "policy_requires_human_approval";
  readonly rationale: string;
}

export class EvidenceValueEngine {
  /**
   * Evaluates all requested evidence and sensitivities to produce a prioritized queue.
   */
  public evaluateEvidenceValue(
    state: InvestigationState,
    hypotheses: readonly Hypothesis[],
    sensitivities: readonly DecisionSensitivity[]
  ): EvidenceValueResult {
    const executedTools = new Set(state.toolCallIds.map((t) => t.split(":")[0]));
    const needs: EvaluatedEvidenceNeed[] = [];

    // 1. Evaluate unexecuted TigerGraph read tools
    if (!executedTools.has("getTransactionContext")) {
      needs.push({
        evidenceType: "FlaggedTransactionAttributes",
        reasonRequested: "Baseline amount, timestamp, channel, merchant, and billing region needed to establish transaction facts.",
        targetHypothesisIds: hypotheses.map((h) => h.hypothesisId),
        expectedDecisionImpact: "critical",
        availability: "immediately_queryable",
        acquisitionFriction: "none",
        priorityScore: 0.95,
        suggestedTool: "getTransactionContext",
        authorizationRequirement: "auto",
      });
    }

    if (!executedTools.has("getTransactionRelationshipContext")) {
      const sensitivity = sensitivities.find((s) => s.evidenceNeeded === "getTransactionRelationshipContext");
      needs.push({
        evidenceType: "GraphRelationshipContext",
        reasonRequested: "Identifies device sharing, IP subnets, and historical known card connections across graph entities.",
        targetHypothesisIds: sensitivity?.affectedHypothesisIds ?? hypotheses.map((h) => h.hypothesisId),
        expectedDecisionImpact: "critical",
        availability: "immediately_queryable",
        acquisitionFriction: "none",
        priorityScore: 0.90,
        suggestedTool: "getTransactionRelationshipContext",
        authorizationRequirement: "auto",
        decisionSensitivityRef: sensitivity?.sensitivityId,
      });
    }

    if (!executedTools.has("findRelatedCases")) {
      const sensitivity = sensitivities.find((s) => s.evidenceNeeded === "findRelatedCases");
      needs.push({
        evidenceType: "HistoricalClosedCaseMemory",
        reasonRequested: "Retrieves precedent closed fraud cases and established MO patterns strictly prior to cutoff.",
        targetHypothesisIds: sensitivity?.affectedHypothesisIds ?? hypotheses.map((h) => h.hypothesisId),
        expectedDecisionImpact: "high",
        availability: "immediately_queryable",
        acquisitionFriction: "none",
        priorityScore: 0.85,
        suggestedTool: "findRelatedCases",
        authorizationRequirement: "auto",
        decisionSensitivityRef: sensitivity?.sensitivityId,
      });
    }

    // 2. Evaluate specialist-requested gaps from state.requestedEvidence
    for (const req of state.requestedEvidence) {
      const reqLower = req.toLowerCase();

      if (reqLower.includes("customer contact") || reqLower.includes("cardholder confirmation")) {
        needs.push({
          evidenceType: "CardholderConfirmation",
          reasonRequested: req,
          targetHypothesisIds: hypotheses.map((h) => h.hypothesisId),
          expectedDecisionImpact: "critical",
          availability: "requires_customer_contact",
          acquisitionFriction: "high",
          priorityScore: 0.70, // High impact but high customer friction
          authorizationRequirement: "auto",
        });
      } else if (reqLower.includes("baseline") || reqLower.includes("velocity") || reqLower.includes("spend")) {
        needs.push({
          evidenceType: "CustomerHistoricalSpendBaseline",
          reasonRequested: req,
          targetHypothesisIds: hypotheses.map((h) => h.hypothesisId),
          expectedDecisionImpact: "medium",
          availability: "requires_external_system",
          acquisitionFriction: "low",
          priorityScore: 0.60,
          authorizationRequirement: "auto",
        });
      } else {
        needs.push({
          evidenceType: "ExternalSystemEvidence",
          reasonRequested: req,
          targetHypothesisIds: hypotheses.map((h) => h.hypothesisId),
          expectedDecisionImpact: "low",
          availability: "unavailable",
          acquisitionFriction: "medium",
          priorityScore: 0.30,
          authorizationRequirement: "L1",
        });
      }
    }

    // Sort by priorityScore descending
    const sortedNeeds = [...needs].sort((a, b) => b.priorityScore - a.priorityScore);
    const topNeed = sortedNeeds[0];

    // Determine stopping condition
    const queryableNeed = sortedNeeds.find(
      (n) => n.availability === "immediately_queryable" && n.suggestedTool
    );

    if (queryableNeed) {
      return {
        evaluatedNeeds: Object.freeze(sortedNeeds),
        topRecommendedNeed: queryableNeed,
        shouldContinueInvestigation: true,
        rationale: `Executable tool ${queryableNeed.suggestedTool} has priority score ${queryableNeed.priorityScore.toFixed(2)} to reduce critical uncertainty.`,
      };
    }

    // If no queryable tool remains in TigerGraph
    const highValueExternal = sortedNeeds.find(
      (n) => (n.expectedDecisionImpact === "critical" || n.expectedDecisionImpact === "high") &&
             n.availability !== "unavailable"
    );

    if (highValueExternal) {
      return {
        evaluatedNeeds: Object.freeze(sortedNeeds),
        topRecommendedNeed: highValueExternal,
        shouldContinueInvestigation: false,
        stoppingReason: "all_permitted_tools_exhausted",
        rationale: `All permitted TigerGraph queries executed. Next highest-value evidence (${highValueExternal.evidenceType}) requires external system or cardholder contact.`,
      };
    }

    return {
      evaluatedNeeds: Object.freeze(sortedNeeds),
      shouldContinueInvestigation: false,
      stoppingReason: "sufficient_evidence_exists",
      rationale: "All queryable facts collected; remaining evidence needs have low decision impact or are unavailable.",
    };
  }
}
