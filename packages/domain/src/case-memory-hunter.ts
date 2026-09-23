/**
 * AFI Agentic Fraud Investigation — Case Memory Hunter Contract and Findings
 * Strongly typed, deterministic specialist for retrospective closed-case memory analysis.
 * Operates strictly on historical closed cases with closed_at < investigationCutoff.
 * Strict semantic boundary:
 * Historical case similarity != current fraud.
 * A prior confirmed fraud does not prove current fraud; a prior cleared case does not prove current legitimacy.
 */

import { DecisionImpact, InvestigationState, validateIdentifier } from "./investigation-state.js";
import { EvidenceItem } from "./evidence-ledger.js";
import { Hypothesis, updateHypothesis } from "./hypotheses.js";

export type CaseMemoryFindingType =
  | "historical_fraud_precedent"
  | "historical_cleared_precedent"
  | "historical_pattern_recurrence"
  | "no_historical_precedent"
  | "temporal_denial";

export interface CaseMemoryFinding {
  readonly findingId: string;
  readonly hunterName: "CaseMemoryHunter";
  readonly findingType: CaseMemoryFindingType;
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
  readonly confidenceScore: number; // 0.0 to 1.0 (analytical certainty of historical match)
  readonly isTemporallyEligible: boolean;
  readonly unresolvedQuestions: readonly string[];
  readonly decisionImpact: DecisionImpact;
  readonly createdAt: string;
}

export class CaseMemoryHunterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CaseMemoryHunterError";
  }
}

export function createCaseMemoryFinding(params: {
  readonly findingId: string;
  readonly findingType: CaseMemoryFindingType;
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
}): CaseMemoryFinding {
  validateIdentifier(params.findingId, "findingId");

  if (!params.observation.trim()) {
    throw new CaseMemoryHunterError("Finding observation cannot be empty");
  }
  if (!params.rationale.trim()) {
    throw new CaseMemoryHunterError("Finding rationale cannot be empty");
  }
  if (params.confidenceScore < 0 || params.confidenceScore > 1) {
    throw new CaseMemoryHunterError("confidenceScore must be between 0.0 and 1.0");
  }
  if (params.evidenceIds.length === 0) {
    throw new CaseMemoryHunterError("Case Memory finding must reference at least one verified EvidenceItem ID");
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return Object.freeze({
    findingId: params.findingId,
    hunterName: "CaseMemoryHunter",
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

export interface CaseMemoryHunterAnalysisResult {
  readonly findings: readonly CaseMemoryFinding[];
  readonly updatedHypotheses: readonly Hypothesis[];
  readonly newEvidenceItems: readonly EvidenceItem[];
  readonly requestedEvidence: readonly string[];
}

export class CaseMemoryHunterAnalyzer {
  /**
   * Performs deterministic historical case precedent analysis.
   * Preserves strict semantic boundary:
   * OBSERVED FACT (closed cases before cutoff) -> HISTORICAL INTERPRETATION -> HYPOTHESIS IMPACT
   * A prior confirmed fraud does NOT equal current fraud; a prior cleared case does NOT equal current legitimate.
   */
  public analyzeCaseMemoryEvidence(
    state: InvestigationState,
    evidenceItems: readonly EvidenceItem[],
    currentHypotheses: readonly Hypothesis[] = []
  ): CaseMemoryHunterAnalysisResult {
    if (!state.investigationCutoff) {
      throw new CaseMemoryHunterError("Missing investigationCutoff in investigation state");
    }

    const findings: CaseMemoryFinding[] = [];
    const newEvidence: EvidenceItem[] = [];
    const requestedEvidence: string[] = [];
    let updatedHypotheses = [...currentHypotheses];

    const eligibleEvidence = evidenceItems.filter((e) => e.isTemporallyEligible);

    for (const item of eligibleEvidence) {
      // 1. Temporal Denial
      if (item.observation.includes("future_transaction")) {
        findings.push(
          createCaseMemoryFinding({
            findingId: `fnd-${state.investigationId}-cm-future-denial`,
            findingType: "temporal_denial",
            title: "Historical Memory Post-Dates Cutoff",
            observation: item.observation,
            rationale: "TigerGraph temporal predicate rejected transaction as future relative to cutoff. Historical case memory cannot be retrieved.",
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

      // 2. Historical Case Analysis from findRelatedCases
      if (item.toolName === "findRelatedCases") {
        const countMatch = item.observation.match(/(\d+)\s+historically eligible closed cases/);
        const caseCount = countMatch ? parseInt(countMatch[1], 10) : 0;

        if (caseCount === 0) {
          findings.push(
            createCaseMemoryFinding({
              findingId: `fnd-${state.investigationId}-cm-no-precedent`,
              findingType: "no_historical_precedent",
              title: "No Historical Closed Cases Identified",
              observation: "No prior closed cases sharing card or transaction entities found before cutoff.",
              rationale: "Entity has no documented prior investigation record under temporal integrity. Absence of prior record is neutral baseline.",
              evidenceIds: [item.evidenceId],
              affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
              supportingHypothesisTypes: [],
              contradictingHypothesisTypes: [],
              confidenceScore: 0.8,
              isTemporallyEligible: true,
              decisionImpact: "low",
            })
          );
          continue;
        }

        const hasConfirmedFraud = item.observation.toLowerCase().includes("confirmed_fraud");
        const hasCleared = item.observation.toLowerCase().includes("cleared");

        // A. Historical Confirmed Fraud Precedent
        if (hasConfirmedFraud) {
          const fraudFinding = createCaseMemoryFinding({
            findingId: `fnd-${state.investigationId}-cm-fraud-precedent`,
            findingType: "historical_fraud_precedent",
            title: "Prior Confirmed Fraud Investigation Identified",
            observation: `Entity was involved in prior closed case(s) resolved with 'confirmed_fraud' outcome before cutoff.`,
            rationale: "Historical fraud outcome provides contextual precedent of past compromise. Crucially, past fraud on an entity does NOT prove the current transaction is fraudulent (same-entity ambiguity).",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: item.entityType, entityId: item.entityId }],
            supportingHypothesisTypes: ["card_not_present", "out_of_region_use"],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.85,
            isTemporallyEligible: true,
            unresolvedQuestions: [
              "Does the current transaction exhibit the same MO (channel, amount, location) as the historical confirmed fraud?"
            ],
            decisionImpact: "high",
          });
          findings.push(fraudFinding);
          updatedHypotheses = this.linkFindingToHypotheses(fraudFinding, updatedHypotheses);
        }

        // B. Historical Cleared Precedent
        if (hasCleared) {
          const clearedFinding = createCaseMemoryFinding({
            findingId: `fnd-${state.investigationId}-cm-cleared-precedent`,
            findingType: "historical_cleared_precedent",
            title: "Prior Cleared/Legitimate Investigation Identified",
            observation: `Entity was involved in prior closed case(s) resolved with 'cleared' outcome before cutoff.`,
            rationale: "Historical cleared outcome indicates past alerts were determined to be benign. Crucially, a past cleared outcome does NOT guarantee the current transaction is legitimate.",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: item.entityType, entityId: item.entityId }],
            supportingHypothesisTypes: ["legitimate_activity"],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.85,
            isTemporallyEligible: true,
            unresolvedQuestions: [
              "Why was the historical case cleared, and does the same rationale apply to the current alert?"
            ],
            decisionImpact: "medium",
          });
          findings.push(clearedFinding);
          updatedHypotheses = this.linkFindingToHypotheses(clearedFinding, updatedHypotheses);
        }

        // C. Pattern Recurrence
        const patternMatch = item.observation.match(/patterns:\s*\[([^\]]+)\]/i);
        if (patternMatch) {
          const patterns = patternMatch[1];
          const patternFinding = createCaseMemoryFinding({
            findingId: `fnd-${state.investigationId}-cm-pattern`,
            findingType: "historical_pattern_recurrence",
            title: `Historical Pattern Precedent (${patterns.trim()})`,
            observation: `Prior closed cases classified under patterns: [${patterns.trim()}].`,
            rationale: `Historical pattern taxonomy links entity to known typology (${patterns.trim()}). Pattern relevance guides hypothesis testing but requires corroborating current facts.`,
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: item.entityType, entityId: item.entityId }],
            supportingHypothesisTypes: ["card_not_present", "out_of_region_use", "undocumented_pattern"],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.8,
            isTemporallyEligible: true,
            unresolvedQuestions: [`Does the current incident conform to the '${patterns.trim()}' typology?`],
            decisionImpact: "high",
          });
          findings.push(patternFinding);
          updatedHypotheses = this.linkFindingToHypotheses(patternFinding, updatedHypotheses);
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
    finding: CaseMemoryFinding,
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
