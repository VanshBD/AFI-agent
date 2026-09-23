/**
 * AFI Agentic Fraud Investigation — Next-Best-Action (NBA), Policy & Authorization Engine
 * Derived from challenge-supported policy rules:
 * Actions:
 *  - allow_transaction
 *  - block_card
 *  - reissue_card
 *  - customer_contact
 *  - file_sar
 *  - close_false_positive
 *  - escalate_to_human_analyst
 *  - request_additional_evidence
 *
 * Authorization Levels:
 *  - AUTO: Safe, reversible actions without irreversible harm (e.g. request evidence, customer contact, monitor, low-risk allow)
 *  - L1: Operational analyst approval required (e.g. card block, temporary hold, escalate to investigation)
 *  - L2: Senior compliance/management approval required (e.g. regulatory filing like SAR, legal/permanent account termination)
 */

import {
  InvestigationState,
  ApprovalRequirement,
  NextBestActionRecommendation,
} from "./investigation-state.js";
import { Hypothesis } from "./hypotheses.js";
import { EvidenceItem } from "./evidence-ledger.js";
import { DecisionSensitivity } from "./decision-sensitivity.js";
import { AdversarialAnalysisResult } from "./prosecutor-defense.js";

export interface PolicyEvaluationResult {
  readonly recommendedAction: NextBestActionRecommendation;
  readonly authorizationLevel: ApprovalRequirement;
  readonly policyRuleTriggered: string;
  readonly canExecuteAutomatically: boolean;
  readonly executionStatus: "executed" | "pending_human_approval" | "deferred";
  readonly auditRationale: string;
}

export class PolicyAndNBAEngine {
  /**
   * Generates structured Next-Best-Action and evaluates policy authorization routing.
   */
  public evaluateNBA(
    state: InvestigationState,
    hypotheses: readonly Hypothesis[],
    evidence: readonly EvidenceItem[],
    sensitivities: readonly DecisionSensitivity[],
    adversarial: AdversarialAnalysisResult
  ): PolicyEvaluationResult {
    const executedTools = new Set(state.toolCallIds.map((t) => t.split(":")[0]));
    const hasUnresolvedContradictions = adversarial.detectedContradictions.some(
      (c) => c.resolutionStatus === "unresolved"
    );

    const hasKnownFraudCard = evidence.some(
      (e) => e.entityType === "KnownCard" && e.polarity === "supports"
    );
    const hasPrecedentFraudCase = evidence.some(
      (e) => e.entityType === "ClosedCase" && e.polarity === "supports"
    );

    const fraudHypotheses = hypotheses.filter((h) => h.type !== "legitimate_activity");
    const maxFraudConfidence = fraudHypotheses.length > 0
      ? Math.max(...fraudHypotheses.map((h) => h.confidenceScore))
      : (state.riskScore ?? 0.5);

    const isCustomerReport = state.triggerId.toLowerCase().includes("report") ||
      evidence.some((e) => e.observation.toLowerCase().includes("customer message"));

    // 1. RULE 1: Direct Confirmed Fraud (KnownCard compromised in graph OR closed fraud precedent)
    if (hasKnownFraudCard || hasPrecedentFraudCase) {
      const rec: NextBestActionRecommendation = {
        recommendationId: `nba-${state.investigationId}-block-card`,
        actionType: "block_card",
        description: `Block card ${state.cardId} immediately due to verified linkage to confirmed historical fraud or compromised known card.`,
        approvalRequired: "L1",
        rationale: `Graph evidence confirmed historical compromise (${hasKnownFraudCard ? "KnownCard" : "ClosedCase"}). Card blocking requires L1 operational analyst approval before cardholder termination.`,
        confidence: 0.90,
      };

      return {
        recommendedAction: rec,
        authorizationLevel: "L1",
        policyRuleTriggered: "POL-CRITICAL-GRAPH-COMPROMISE",
        canExecuteAutomatically: false, // Consequential action requires human approval
        executionStatus: "pending_human_approval",
        auditRationale: "Consequential blocking action requires L1 authorization under AFI safety policy.",
      };
    }

    // 2. RULE 2: Customer Dispute / Report -> Out-of-band contact or cardholder confirmation
    if (isCustomerReport) {
      if (hasUnresolvedContradictions) {
        const rec: NextBestActionRecommendation = {
          recommendationId: `nba-${state.investigationId}-cust-contact`,
          actionType: "customer_contact",
          description: `Initiate interactive customer verification for transaction ${state.flaggedTransactionId} to clarify dispute details.`,
          approvalRequired: "auto",
          rationale: "Customer dispute has unresolved contradictions against geographical baseline. Automated SMS/push verification requested.",
          confidence: 0.75,
        };

        return {
          recommendedAction: rec,
          authorizationLevel: "auto",
          policyRuleTriggered: "POL-CUSTOMER-DISPUTE-VERIFY",
          canExecuteAutomatically: true,
          executionStatus: "executed",
          auditRationale: "Customer outreach is non-destructive and authorized for AUTO execution.",
        };
      }
    }

    // 3. RULE 3: Elevated Risk with Unresolved Contradictions -> Escalate to human analyst
    if (hasUnresolvedContradictions || (state.riskScore ?? 0) >= 0.75) {
      const rec: NextBestActionRecommendation = {
        recommendationId: `nba-${state.investigationId}-escalate`,
        actionType: "escalate_to_human_analyst",
        description: `Escalate investigation of transaction ${state.flaggedTransactionId} to L1 fraud analyst due to conflicting signals between risk score and graph topology.`,
        approvalRequired: "L1",
        rationale: "Model risk score indicates fraud, but graph topology is uncompromised. Analyst review required to prevent wrongful customer decline.",
        confidence: 0.70,
      };

      return {
        recommendedAction: rec,
        authorizationLevel: "L1",
        policyRuleTriggered: "POL-CONTRADICTION-ESCALATION",
        canExecuteAutomatically: false,
        executionStatus: "pending_human_approval",
        auditRationale: "Contradiction resolution requires L1 analyst inspection.",
      };
    }

    // 4. RULE 4: Clean graph, normal risk (< 0.60), no fraud precedents -> Close false positive
    if ((state.riskScore ?? 0) < 0.60 && !hasKnownFraudCard && !hasPrecedentFraudCase) {
      const rec: NextBestActionRecommendation = {
        recommendationId: `nba-${state.investigationId}-close-fp`,
        actionType: "close_false_positive",
        description: `Close investigation for transaction ${state.flaggedTransactionId} as false positive.`,
        approvalRequired: "auto",
        rationale: "Low risk score, clean graph relationships, and zero precedent cases substantiate legitimate cardholder activity.",
        confidence: 0.85,
      };

      return {
        recommendedAction: rec,
        authorizationLevel: "auto",
        policyRuleTriggered: "POL-FALSE-POSITIVE-DISMISSAL",
        canExecuteAutomatically: true,
        executionStatus: "executed",
        auditRationale: "Standard benign transaction closure is authorized for AUTO execution.",
      };
    }

    // 5. Default Fallback -> Request additional evidence / analyst review
    const rec: NextBestActionRecommendation = {
      recommendationId: `nba-${state.investigationId}-req-evidence`,
      actionType: "request_additional_evidence",
      description: `Request additional customer transaction history and merchant verification for card ${state.cardId}.`,
      approvalRequired: "auto",
      rationale: "Evidence remains inconclusive; additional data needed for terminal classification.",
      confidence: 0.60,
    };

    return {
      recommendedAction: rec,
      authorizationLevel: "auto",
      policyRuleTriggered: "POL-GATHER-MORE-EVIDENCE",
      canExecuteAutomatically: true,
      executionStatus: "executed",
      auditRationale: "Requesting additional data is a non-destructive AUTO action.",
    };
  }

  /**
   * Challenge-mandated official action representation.
   * Maps internal recommendations and investigation state to the exact 14 official policy actions and routes.
   */
  public evaluateOfficialPolicyActions(
    state: InvestigationState,
    hypotheses: readonly Hypothesis[],
    evidence: readonly EvidenceItem[],
    exposureUsd: number,
    additionalEvidenceReceived = false
  ): {
    actions: Array<{ action: string; route: "auto" | "L1" | "L2"; reason: string }>;
    sarRequired: boolean;
    sarReason: string;
  } {
    const actions: Array<{ action: string; route: "auto" | "L1" | "L2"; reason: string }> = [];
    const hasKnownFraudCard = evidence.some((e) => e.entityType === "KnownCard" && e.polarity === "supports");
    const hasPrecedentFraudCase = evidence.some((e) => e.entityType === "ClosedCase" && e.polarity === "supports");
    const isCustomerReport = state.triggerId.toLowerCase().includes("report") ||
      evidence.some((e) => e.observation.toLowerCase().includes("customer message"));
    const riskScore = state.riskScore ?? 0.5;

    // Evaluate primary hypothesis
    const fraudHypotheses = hypotheses.filter((h) => h.type !== "legitimate_activity");
    const maxFraudConfidence = fraudHypotheses.length > 0
      ? Math.max(...fraudHypotheses.map((h) => h.confidenceScore))
      : riskScore;

    let sarRequired = false;
    let sarReason = "";

    if (!additionalEvidenceReceived) {
      // INITIAL PHASE (Before additional customer verification / step-up auth)
      if (hasKnownFraudCard || hasPrecedentFraudCase) {
        // Direct graph compromise confirmed
        const blockRoute = exposureUsd > 2500 ? "L2" : "L1";
        actions.push({ action: "BLOCK_CARD", route: blockRoute, reason: "R2: confirmed compromise in graph topology" });
        actions.push({ action: "CREATE_CASE", route: "auto", reason: "R2: internal fraud case record" });
        if (exposureUsd > 1000 || hasKnownFraudCard) {
          actions.push({ action: "FILE_REPORT", route: "L2", reason: "R2: confirmed unauthorized use with linked compromise or exposure > $1,000" });
          sarRequired = true;
          sarReason = "R2: confirmed unauthorized use linked to compromised card entities in knowledge graph";
        }
        actions.push({ action: "MONITOR_CONNECTED_CARDS", route: "auto", reason: "R6: monitor connected payment profiles sharing graph origin" });
      } else if (isCustomerReport) {
        // Customer reported transaction: initial action is verify dispute details and decline authorization
        actions.push({ action: "DECLINE_TRANSACTION", route: "L1", reason: "R1/R2: customer dispute reported, decline pending authorization" });
        actions.push({ action: "VERIFY_WITH_CUSTOMER", route: "auto", reason: "R1: verify dispute details and card possession before terminal blocking" });
        actions.push({ action: "CREATE_CASE", route: "auto", reason: "R7: open case for disputed transaction" });
      } else if (riskScore >= 0.70) {
        // Elevated statistical risk score on single signal
        actions.push({ action: "DECLINE_TRANSACTION", route: "L1", reason: "R1: elevated model risk score, decline authorization pending verification" });
        actions.push({ action: "VERIFY_WITH_CUSTOMER", route: "auto", reason: "R1: probability on single model signal, verify before permanent blocking" });
        actions.push({ action: "MONITOR_CARD", route: "auto", reason: "R4: monitor card activity for 72 hours" });
      } else {
        // Low risk score, benign profile
        actions.push({ action: "ALLOW_TRANSACTION", route: "auto", reason: "R1/R3: benign transaction within normal risk baseline" });
        actions.push({ action: "CLOSE_NO_FRAUD", route: "auto", reason: "R3: verified legitimate activity, alert cleared" });
      }
    } else {
      // FINAL PHASE (After simulated additional evidence / customer response)
      if (isCustomerReport || hasKnownFraudCard || hasPrecedentFraudCase || (riskScore >= 0.70 && maxFraudConfidence >= 0.65)) {
        // Customer denial confirmed or high fraud probability confirmed
        const blockRoute = exposureUsd > 2500 ? "L2" : "L1";
        actions.push({ action: "BLOCK_CARD", route: blockRoute, reason: `R2: unauthorized activity confirmed; exposure $${exposureUsd.toFixed(2)} ${exposureUsd > 2500 ? "exceeds $2,500" : "is under $2,500"}` });
        actions.push({ action: "CREATE_CASE", route: "auto", reason: "R2: internal fraud case record preserved in graph" });
        if (exposureUsd > 1000 || hasKnownFraudCard || (riskScore >= 0.85 && exposureUsd > 250)) {
          actions.push({ action: "FILE_REPORT", route: "L2", reason: "R2/R6: confirmed unauthorized use with high exposure or shared device links" });
          sarRequired = true;
          sarReason = `R2: confirmed fraud episode with exposure $${exposureUsd.toFixed(2)}`;
        }
        actions.push({ action: "MONITOR_CONNECTED_CARDS", route: "auto", reason: "R6: put connected cards under monitoring" });
      } else {
        // Customer confirmed or legitimate transaction confirmed
        actions.push({ action: "ALLOW_TRANSACTION", route: "auto", reason: "R3: customer confirmed transaction authorized" });
        actions.push({ action: "CLOSE_NO_FRAUD", route: "auto", reason: "R3: customer confirmation received; alert closed as legitimate" });
      }
    }

    return { actions, sarRequired, sarReason };
  }
}

