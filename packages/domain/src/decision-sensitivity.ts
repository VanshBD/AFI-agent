/**
 * AFI Agentic Fraud Investigation — Decision Sensitivity Analyzer
 * Answers: "Which unknown fact could change the recommended action?"
 * Connects unknown facts -> affected hypotheses -> current action -> potentially changed actions -> evidence needed.
 */

import { InvestigationState } from "./investigation-state.js";
import { Hypothesis } from "./hypotheses.js";
import { EvidenceItem } from "./evidence-ledger.js";

export type InvestigatedAction =
  | "ALLOW"
  | "BLOCK"
  | "REVIEW";

export interface DecisionSensitivity {
  readonly sensitivityId: string;
  readonly unknownFact: string;
  readonly affectedHypothesisIds: readonly string[];
  readonly currentAction: InvestigatedAction;
  readonly potentiallyChangedActions: readonly InvestigatedAction[];
  readonly evidenceNeeded: string;
  readonly expectedImpact: "critical" | "high" | "medium" | "low";
  readonly rationale: string;
}

export class DecisionSensitivityAnalyzer {
  /**
   * Derives current provisional action from verified evidence and hypotheses.
   */
  public evaluateCurrentAction(
    state: InvestigationState,
    hypotheses: readonly Hypothesis[],
    evidence: readonly EvidenceItem[]
  ): InvestigatedAction {
    // Look at active hypothesis confidence and critical evidence
    const fraudHypotheses = hypotheses.filter(
      (h) => h.type !== "legitimate_activity" && h.status !== "refuted"
    );
    const legitimateHypothesis = hypotheses.find((h) => h.type === "legitimate_activity");

    const maxFraudConfidence = fraudHypotheses.length > 0
      ? Math.max(...fraudHypotheses.map((h) => h.confidenceScore))
      : (state.riskScore ?? 0.5);

    const legConfidence = legitimateHypothesis?.confidenceScore ?? 0.5;

    // Direct high-confidence fraud indicators: known fraud card linked or repeated fraud pattern
    const hasKnownFraudCard = evidence.some(
      (e) => e.entityType === "KnownCard" && e.polarity === "supports"
    );
    const hasEligibleFraudPrecedent = evidence.some(
      (e) => e.entityType === "ClosedCase" && e.polarity === "supports"
    );

    if ((hasKnownFraudCard || hasEligibleFraudPrecedent) && maxFraudConfidence >= 0.75) {
      return "BLOCK";
    }

    if (maxFraudConfidence > 0.65 && maxFraudConfidence > legConfidence) {
      return "BLOCK";
    }

    if (maxFraudConfidence < 0.40 && legConfidence >= 0.60) {
      return "ALLOW";
    }

    // Default when uncertainty exists, contradictions are present, or evidence is partial
    return "REVIEW";
  }

  /**
   * Analyzes which missing or unknown facts could change the current action.
   */
  public analyzeSensitivity(
    state: InvestigationState,
    hypotheses: readonly Hypothesis[],
    evidence: readonly EvidenceItem[]
  ): readonly DecisionSensitivity[] {
    const currentAction = this.evaluateCurrentAction(state, hypotheses, evidence);
    const sensitivities: DecisionSensitivity[] = [];

    const executedTools = new Set(state.toolCallIds.map((t) => t.split(":")[0]));
    const fraudHypotheses = hypotheses.filter((h) => h.type !== "legitimate_activity");
    const fraudHypothesisIds = fraudHypotheses.map((h) => h.hypothesisId);

    // 1. If relationship context has not been gathered yet
    if (!executedTools.has("getTransactionRelationshipContext")) {
      const potentiallyChangedActions: readonly InvestigatedAction[] = currentAction === "ALLOW"
        ? ["REVIEW", "BLOCK"]
        : ["ALLOW", "BLOCK"];
      sensitivities.push(
        Object.freeze({
          sensitivityId: `sens-${state.investigationId}-relationships`,
          unknownFact: "Shared device, IP network, and historical known-card linkage",
          affectedHypothesisIds: Object.freeze(fraudHypothesisIds),
          currentAction,
          potentiallyChangedActions,
          evidenceNeeded: "getTransactionRelationshipContext",
          expectedImpact: "critical",
          rationale: "Uncovering shared devices or compromised cards can immediately shift an ALLOW to BLOCK, or confirm lack of linkage.",
        })
      );
    }

    // 2. If historical cases / memory have not been checked
    if (!executedTools.has("findRelatedCases")) {
      const potentiallyChangedActions: readonly InvestigatedAction[] = currentAction === "BLOCK"
        ? ["REVIEW"]
        : ["BLOCK", "REVIEW"];
      sensitivities.push(
        Object.freeze({
          sensitivityId: `sens-${state.investigationId}-case-memory`,
          unknownFact: "Historical closed fraud cases or recurring MO patterns for customer/card",
          affectedHypothesisIds: Object.freeze(fraudHypothesisIds),
          currentAction,
          potentiallyChangedActions,
          evidenceNeeded: "findRelatedCases",
          expectedImpact: "high",
          rationale: "Closed case precedents prove recurring fraud patterns, whereas absence of precedent weakens organized fraud hypotheses.",
        })
      );
    }

    // 3. Behavioral baseline gap: missing customer historical average transaction amounts
    const hasBehaviorGap = state.requestedEvidence.some((req) =>
      req.toLowerCase().includes("historical average transaction amount") ||
      req.toLowerCase().includes("behavior")
    );
    if (hasBehaviorGap) {
      const potentiallyChangedActions: readonly InvestigatedAction[] = currentAction === "BLOCK"
        ? ["REVIEW", "ALLOW"]
        : ["BLOCK", "REVIEW"];
      sensitivities.push(
        Object.freeze({
          sensitivityId: `sens-${state.investigationId}-behavior-baseline`,
          unknownFact: "Pre-cutoff customer historical mean transaction amount and standard deviation",
          affectedHypothesisIds: Object.freeze(hypotheses.map((h) => h.hypothesisId)),
          currentAction,
          potentiallyChangedActions,
          evidenceNeeded: "Customer pre-cutoff transaction history ledger",
          expectedImpact: "high",
          rationale: "If amount $X is within 1 std-dev of legitimate customer history, fraud hypothesis confidence drops, shifting BLOCK to REVIEW or ALLOW.",
        })
      );
    }

    // 4. Multi-card identity gap: cards linked to same device
    const hasDeviceGap = state.requestedEvidence.some((req) =>
      req.toLowerCase().includes("device") || req.toLowerCase().includes("ip subnet")
    );
    if (hasDeviceGap) {
      const potentiallyChangedActions: readonly InvestigatedAction[] = currentAction === "ALLOW"
        ? ["BLOCK"]
        : ["ALLOW"];
      sensitivities.push(
        Object.freeze({
          sensitivityId: `sens-${state.investigationId}-device-cards`,
          unknownFact: "Count of distinct cards transacting from same DeviceProfile prior to cutoff",
          affectedHypothesisIds: Object.freeze(fraudHypothesisIds),
          currentAction,
          potentiallyChangedActions,
          evidenceNeeded: "DeviceProfile card association query",
          expectedImpact: "high",
          rationale: "If device is shared across >5 distinct cards, card testing or ATO is confirmed (BLOCK). If uniquely customer's device, ATO is weakened.",
        })
      );
    }

    // 5. If current action is REVIEW and no tools remain, check customer confirmation
    if (currentAction === "REVIEW" && sensitivities.length === 0) {
      const potentiallyChangedActions: readonly InvestigatedAction[] = ["ALLOW", "BLOCK"];
      sensitivities.push(
        Object.freeze({
          sensitivityId: `sens-${state.investigationId}-customer-verification`,
          unknownFact: "Direct cardholder confirmation of transaction authorization",
          affectedHypothesisIds: Object.freeze(hypotheses.map((h) => h.hypothesisId)),
          currentAction: "REVIEW",
          potentiallyChangedActions,
          evidenceNeeded: "Out-of-band cardholder confirmation (SMS / push verification)",
          expectedImpact: "critical",
          rationale: "Cardholder confirmation directly resolves legitimate authorization vs true fraud, changing REVIEW to either ALLOW or BLOCK.",
        })
      );
    }

    return Object.freeze(sensitivities);
  }
}
