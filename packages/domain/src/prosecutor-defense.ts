/**
 * AFI Agentic Fraud Investigation — Prosecutor, Defense & Contradiction Engine
 * Evaluates verified evidence strictly from adversarial perspectives:
 * PROSECUTOR: "What evidence supports the fraud hypothesis?"
 * DEFENSE: "What evidence weakens the fraud hypothesis or supports an innocent explanation?"
 * CONTRADICTION ENGINE: Explicitly identifies conflicting evidence signals without arbitrary confidence adjustments.
 */

import { InvestigationState, Contradiction } from "./investigation-state.js";
import { Hypothesis } from "./hypotheses.js";
import { EvidenceItem } from "./evidence-ledger.js";

export interface PerspectiveFinding {
  readonly perspective: "prosecutor" | "defense";
  readonly hypothesisId: string;
  readonly argument: string;
  readonly evidenceIds: readonly string[];
  readonly strength: "compelling" | "moderate" | "weak";
  readonly evidenceGaps: readonly string[];
}

export interface AdversarialAnalysisResult {
  readonly prosecutorFindings: readonly PerspectiveFinding[];
  readonly defenseFindings: readonly PerspectiveFinding[];
  readonly detectedContradictions: readonly Contradiction[];
  readonly netAssessment: {
    readonly dominantPerspective: "prosecutor" | "defense" | "balanced_uncertainty";
    readonly primaryRationale: string;
  };
}

export class AdversarialAnalyzer {
  /**
   * Conducts prosecutor and defense analysis over verified evidence and flags contradictions.
   */
  public analyze(
    state: InvestigationState,
    hypotheses: readonly Hypothesis[],
    evidence: readonly EvidenceItem[]
  ): AdversarialAnalysisResult {
    const prosecutorFindings: PerspectiveFinding[] = [];
    const defenseFindings: PerspectiveFinding[] = [];
    const contradictions: Contradiction[] = [];

    const fraudHypotheses = hypotheses.filter((h) => h.type !== "legitimate_activity");
    const legitimateHypothesis = hypotheses.find((h) => h.type === "legitimate_activity");

    // 1. PROSECUTOR ANALYSIS
    for (const fHyp of fraudHypotheses) {
      const supportingEvidence = evidence.filter(
        (e) =>
          (e.polarity === "supports" && e.relevantHypothesisIds.includes(fHyp.hypothesisId)) ||
          (e.category === "observed_fact" && (
            (fHyp.type === "out_of_region_use" && e.observation.toLowerCase().includes("billing region mismatch")) ||
            (fHyp.type === "card_not_present" && e.observation.toLowerCase().includes("online channel")) ||
            (fHyp.type === "card_testing" && e.observation.toLowerCase().includes("low transaction amount"))
          ))
      );

      const highRiskScoreEv = evidence.find(
        (e) => e.observation.toLowerCase().includes("risk_score") && (state.riskScore ?? 0) >= 0.70
      );
      const knownCardEv = evidence.find(
        (e) => e.entityType === "KnownCard" || e.observation.toLowerCase().includes("known card")
      );
      const precedentCaseEv = evidence.find(
        (e) => e.entityType === "ClosedCase" && e.polarity === "supports"
      );

      const proseEvIds = Array.from(new Set([
        ...supportingEvidence.map((e) => e.evidenceId),
        ...(highRiskScoreEv ? [highRiskScoreEv.evidenceId] : []),
        ...(knownCardEv ? [knownCardEv.evidenceId] : []),
        ...(precedentCaseEv ? [precedentCaseEv.evidenceId] : []),
      ]));

      const evidenceGaps: string[] = [];
      if (!evidence.some((e) => e.entityType === "DeviceProfile")) {
        evidenceGaps.push("DeviceProfile linking verification");
      }
      if (!precedentCaseEv) {
        evidenceGaps.push("Direct historical case recurrence");
      }

      if (proseEvIds.length > 0) {
        prosecutorFindings.push(
          Object.freeze({
            perspective: "prosecutor",
            hypothesisId: fHyp.hypothesisId,
            argument: `Observed ${proseEvIds.length} empirical facts supporting ${fHyp.type}: ${fHyp.title}.`,
            evidenceIds: Object.freeze(proseEvIds),
            strength: (knownCardEv || precedentCaseEv) ? "compelling" : (highRiskScoreEv ? "moderate" : "weak"),
            evidenceGaps: Object.freeze(evidenceGaps),
          })
        );
      }
    }

    // 2. DEFENSE ANALYSIS
    const innocentEvidence = evidence.filter(
      (e) =>
        e.polarity === "contradicts" ||
        (legitimateHypothesis && e.relevantHypothesisIds.includes(legitimateHypothesis.hypothesisId)) ||
        (e.category === "observed_fact" && (
          e.observation.toLowerCase().includes("0 linked devices") ||
          e.observation.toLowerCase().includes("0 known cards") ||
          e.observation.toLowerCase().includes("0 historically eligible closed cases") ||
          e.observation.toLowerCase().includes("channel matches customer baseline")
        ))
    );

    const normalRiskEv = (state.riskScore !== undefined && state.riskScore < 0.60)
      ? evidence.find((e) => e.observation.toLowerCase().includes("risk_score"))
      : undefined;

    const noCompromiseEv = evidence.find((e) =>
      e.observation.toLowerCase().includes("0 historically eligible known cards") ||
      e.observation.toLowerCase().includes("0 linked devices")
    );

    const defenseEvIds = Array.from(new Set([
      ...innocentEvidence.map((e) => e.evidenceId),
      ...(normalRiskEv ? [normalRiskEv.evidenceId] : []),
      ...(noCompromiseEv ? [noCompromiseEv.evidenceId] : []),
    ]));

    const defenseGaps: string[] = [];
    if (!evidence.some((e) => e.observation.toLowerCase().includes("baseline"))) {
      defenseGaps.push("Customer multi-month spend baseline not available");
    }

    defenseFindings.push(
      Object.freeze({
        perspective: "defense",
        hypothesisId: legitimateHypothesis?.hypothesisId ?? "hyp-legitimate",
        argument: defenseEvIds.length > 0
          ? `Identified ${defenseEvIds.length} facts weakening fraud hypothesis: absence of compromised card links, uncorroborated single-signal alerts, or consistent channel.`
          : "Insufficient corroboration exists for fraud; high model score without graph compromise represents potential model false-positive.",
        evidenceIds: Object.freeze(defenseEvIds),
        strength: (noCompromiseEv && normalRiskEv) ? "compelling" : (defenseEvIds.length > 0 ? "moderate" : "weak"),
        evidenceGaps: Object.freeze(defenseGaps),
      })
    );

    // 3. CONTRADICTION ENGINE
    // Case A: High model risk score (> 0.70) but graph shows 0 known cards and 0 closed fraud cases
    if ((state.riskScore ?? 0) >= 0.70 && noCompromiseEv) {
      const riskEv = evidence.find((e) => e.observation.toLowerCase().includes("risk_score"));
      contradictions.push(
        Object.freeze({
          contradictionId: `contra-${state.investigationId}-risk-vs-graph`,
          description: `Model risk score is elevated (${state.riskScore}), yet graph relationships demonstrate zero prior compromise or known fraudulent cards.`,
          conflictingEvidenceIds: Object.freeze([
            ...(riskEv ? [riskEv.evidenceId] : []),
            noCompromiseEv.evidenceId,
          ]),
          resolutionStatus: "unresolved",
          resolutionRationale: "Requires customer contact or spend baseline to resolve model-vs-graph divergence.",
        })
      );
    }

    // Case B: Customer report of fraud but transaction occurred on authorized known card and known region
    const customerReportEv = evidence.find((e) => e.observation.toLowerCase().includes("customer message"));
    const matchingRegionEv = evidence.find((e) => e.observation.toLowerCase().includes("billing region matches"));
    if (customerReportEv && matchingRegionEv) {
      contradictions.push(
        Object.freeze({
          contradictionId: `contra-${state.investigationId}-report-vs-region`,
          description: "Customer reported transaction as unrecognized, but billing region perfectly matches customer home profile.",
          conflictingEvidenceIds: Object.freeze([customerReportEv.evidenceId, matchingRegionEv.evidenceId]),
          resolutionStatus: "unresolved",
          resolutionRationale: "Friendly fraud or family member use versus credential compromise.",
        })
      );
    }

    // 4. NET ASSESSMENT
    const prosecutorCompelling = prosecutorFindings.some((f) => f.strength === "compelling");
    const defenseCompelling = defenseFindings.some((f) => f.strength === "compelling");

    let dominantPerspective: "prosecutor" | "defense" | "balanced_uncertainty" = "balanced_uncertainty";
    let primaryRationale = "Balanced evidence signals with active contradictions; human review or additional verification required.";

    if (prosecutorCompelling && !defenseCompelling) {
      dominantPerspective = "prosecutor";
      primaryRationale = "Compelling empirical fraud indicators (e.g. compromised card or confirmed fraud precedent) outweigh defense arguments.";
    } else if (defenseCompelling && !prosecutorCompelling) {
      dominantPerspective = "defense";
      primaryRationale = "Clean graph topology and lack of precedent support innocent or false-positive explanation.";
    }

    return Object.freeze({
      prosecutorFindings: Object.freeze(prosecutorFindings),
      defenseFindings: Object.freeze(defenseFindings),
      detectedContradictions: Object.freeze(contradictions),
      netAssessment: Object.freeze({
        dominantPerspective,
        primaryRationale,
      }),
    });
  }
}
