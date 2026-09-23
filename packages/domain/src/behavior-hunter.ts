/**
 * AFI Agentic Fraud Investigation — Behavior Hunter Contract and Findings
 * Strongly typed, deterministic specialist for behavioral evidence analysis.
 * Analyzes verified behavioral signals (channel consistency, amount context, repeat relationship patterns).
 * Strictly forbids fabricated baselines or synthetic velocity history; represents missing baseline
 * as unresolved questions and requested evidence.
 */

import { DecisionImpact, InvestigationState, validateIdentifier } from "./investigation-state.js";
import { EvidenceItem } from "./evidence-ledger.js";
import { Hypothesis, updateHypothesis } from "./hypotheses.js";

export type BehaviorFindingType =
  | "channel_consistency"
  | "amount_behavior_context"
  | "baseline_history_gap"
  | "relationship_repetition"
  | "temporal_denial";

export interface BehaviorFinding {
  readonly findingId: string;
  readonly hunterName: "BehaviorHunter";
  readonly findingType: BehaviorFindingType;
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
  readonly confidenceScore: number; // 0.0 to 1.0 (analytical certainty of observation)
  readonly isTemporallyEligible: boolean;
  readonly unresolvedQuestions: readonly string[];
  readonly decisionImpact: DecisionImpact;
  readonly createdAt: string;
}

export class BehaviorHunterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BehaviorHunterError";
  }
}

export function createBehaviorFinding(params: {
  readonly findingId: string;
  readonly findingType: BehaviorFindingType;
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
}): BehaviorFinding {
  validateIdentifier(params.findingId, "findingId");

  if (!params.observation.trim()) {
    throw new BehaviorHunterError("Finding observation cannot be empty");
  }
  if (!params.rationale.trim()) {
    throw new BehaviorHunterError("Finding rationale cannot be empty");
  }
  if (params.confidenceScore < 0 || params.confidenceScore > 1) {
    throw new BehaviorHunterError("confidenceScore must be between 0.0 and 1.0");
  }
  if (params.evidenceIds.length === 0) {
    throw new BehaviorHunterError("Behavior finding must reference at least one verified EvidenceItem ID");
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return Object.freeze({
    findingId: params.findingId,
    hunterName: "BehaviorHunter",
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

export interface BehaviorHunterAnalysisResult {
  readonly findings: readonly BehaviorFinding[];
  readonly updatedHypotheses: readonly Hypothesis[];
  readonly newEvidenceItems: readonly EvidenceItem[];
  readonly requestedEvidence: readonly string[];
}

export class BehaviorHunterAnalyzer {
  /**
   * Performs deterministic behavioral analysis over verified evidence.
   * Enforces semantic boundary:
   * OBSERVED FACT -> BEHAVIORAL INTERPRETATION -> HYPOTHESIS IMPACT
   * Strictly avoids fabricating behavioral history or inferring an unverified baseline.
   */
  public analyzeBehaviorEvidence(
    state: InvestigationState,
    evidenceItems: readonly EvidenceItem[],
    currentHypotheses: readonly Hypothesis[] = []
  ): BehaviorHunterAnalysisResult {
    if (!state.investigationCutoff) {
      throw new BehaviorHunterError("Missing investigationCutoff in investigation state");
    }

    const findings: BehaviorFinding[] = [];
    const newEvidence: EvidenceItem[] = [];
    const requestedEvidence: string[] = [];
    let updatedHypotheses = [...currentHypotheses];

    const eligibleEvidence = evidenceItems.filter((e) => e.isTemporallyEligible);

    for (const item of eligibleEvidence) {
      // 1. Temporal Denial
      if (item.observation.includes("future_transaction")) {
        findings.push(
          createBehaviorFinding({
            findingId: `fnd-${state.investigationId}-beh-future-denial`,
            findingType: "temporal_denial",
            title: "Behavior Evidence Post-Dates Cutoff",
            observation: item.observation,
            rationale: "TigerGraph temporal predicate rejected transaction as future relative to cutoff. Behavioral baseline cannot be computed.",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: item.entityType, entityId: item.entityId }],
            supportingHypothesisTypes: [],
            contradictingHypothesisTypes: [],
            confidenceScore: 1.0,
            isTemporallyEligible: true,
            unresolvedQuestions: ["Transaction occurred after current cutoff; review case opening timestamp."],
            decisionImpact: "high",
          })
        );
        continue;
      }

      // 2. Transaction Context Behavioral Evaluation
      if (item.toolName === "getTransactionContext" && item.entityType === "Transaction") {
        const channelMatch = item.observation.match(/channel\s*[:=]\s*([a-zA-Z_]+)/i);
        const amountMatch = item.observation.match(/amount\s*[:=]\s*\$?([\d.]+)/i);

        // A. Channel Behavioral Context
        if (channelMatch) {
          const channel = channelMatch[1].toLowerCase();
          const channelFinding = createBehaviorFinding({
            findingId: `fnd-${state.investigationId}-beh-channel`,
            findingType: "channel_consistency",
            title: `Observed Channel Modality (${channel})`,
            observation: `Transaction executed via '${channel}' channel modality.`,
            rationale: `Channel indicates customer interaction modality (${channel}). Comparing against cardholder's historical channel affinity requires baseline history tool.`,
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
            supportingHypothesisTypes: channel === "online" ? ["card_not_present"] : ["legitimate_activity"],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.8,
            isTemporallyEligible: true,
            unresolvedQuestions: [`Is '${channel}' the habitual channel used by customer ${state.customerId}?`],
            decisionImpact: "medium",
          });
          findings.push(channelFinding);
          updatedHypotheses = this.linkFindingToHypotheses(channelFinding, updatedHypotheses);
        }

        // B. Amount Behavioral Context
        if (amountMatch) {
          const amount = parseFloat(amountMatch[1]);
          const amountFinding = createBehaviorFinding({
            findingId: `fnd-${state.investigationId}-beh-amount`,
            findingType: "amount_behavior_context",
            title: `Observed Expenditure Amount ($${amount.toFixed(2)})`,
            observation: `Transaction expenditure is $${amount.toFixed(2)}.`,
            rationale: "Absolute expenditure amount observed. Establishing whether this represents an anomalous deviation requires historical spending distribution baseline.",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
            supportingHypothesisTypes: [],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.7,
            isTemporallyEligible: true,
            unresolvedQuestions: [`What is the historical mean and variance of purchase amounts for customer ${state.customerId}?`],
            decisionImpact: "medium",
          });
          findings.push(amountFinding);
        }

        // C. Explicit Baseline Gap Detection (Anti-Fabrication Rule)
        // No baseline timeline is returned by getTransactionContext.
        // We MUST NOT fabricate a prior mean, typical spending pattern, or velocity baseline.
        const baselineGap = createBehaviorFinding({
          findingId: `fnd-${state.investigationId}-beh-baseline-gap`,
          findingType: "baseline_history_gap",
          title: "Customer Historical Behavioral Baseline Unavailable",
          observation: "Current graph evidence does not include pre-cutoff historical transaction sequence for customer.",
          rationale: "Behavioral anomaly detection requires comparing current event against verified prior transaction distribution. Fabricating an assumed baseline is strictly prohibited.",
          evidenceIds: [item.evidenceId],
          affectedEntities: [{ entityType: "Customer", entityId: state.customerId }],
          supportingHypothesisTypes: [],
          contradictingHypothesisTypes: [],
          confidenceScore: 1.0, // Absolute certainty that baseline data is currently absent
          isTemporallyEligible: true,
          unresolvedQuestions: [
            `What is customer ${state.customerId}'s 90-day pre-cutoff transaction history, typical channels, and regular merchant/region profile?`
          ],
          decisionImpact: "high",
        });
        findings.push(baselineGap);
        requestedEvidence.push("customer_pre_cutoff_behavioral_timeline");
      }

      // 3. Repeat Relationship Patterns (from getTransactionRelationshipContext)
      if (item.toolName === "getTransactionRelationshipContext") {
        const knownCardMatch = item.observation.match(/(\d+)\s+historically eligible known cards/);
        const knownCardCount = knownCardMatch ? parseInt(knownCardMatch[1], 10) : 0;

        if (knownCardCount > 0) {
          const repeatFinding = createBehaviorFinding({
            findingId: `fnd-${state.investigationId}-beh-repeat-card`,
            findingType: "relationship_repetition",
            title: "Repeated Historical Entity Relationship Identified",
            observation: `Entity recurs across historical case network (${knownCardCount} confirmed KnownCard instances).`,
            rationale: "Presence in multiple historically closed records establishes recurring identity usage across episodes. Does not prove current fraud or innocence.",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
            supportingHypothesisTypes: ["card_not_present", "out_of_region_use"],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.75,
            isTemporallyEligible: true,
            unresolvedQuestions: ["Are current transaction attributes consistent with the behavior documented in prior cases?"],
            decisionImpact: "high",
          });
          findings.push(repeatFinding);
          updatedHypotheses = this.linkFindingToHypotheses(repeatFinding, updatedHypotheses);
        }
      }
    }

    return {
      findings: Object.freeze(findings),
      updatedHypotheses: Object.freeze(updatedHypotheses),
      newEvidenceItems: Object.freeze(newEvidence),
      requestedEvidence: Object.freeze(requestedEvidence),
    };
  }

  private linkFindingToHypotheses(
    finding: BehaviorFinding,
    hypotheses: readonly Hypothesis[]
  ): Hypothesis[] {
    return hypotheses.map((hypo) => {
      if (finding.supportingHypothesisTypes.includes(hypo.type)) {
        return updateHypothesis(hypo, {
          supportingEvidenceIds: [...hypo.supportingEvidenceIds, ...finding.evidenceIds],
        });
      }
      if (finding.contradictingHypothesisTypes.includes(hypo.type)) {
        return updateHypothesis(hypo, {
          contradictingEvidenceIds: [...hypo.contradictingEvidenceIds, ...finding.evidenceIds],
        });
      }
      return hypo;
    });
  }
}
