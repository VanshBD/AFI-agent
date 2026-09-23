/**
 * AFI Agentic Fraud Investigation — Transaction Hunter Contract and Findings
 * Strongly typed, deterministic specialist for transaction-level evidence analysis.
 * Analyzes transaction attributes (amount, timestamp, channel, product code, risk score).
 * Strictly adheres to observed facts, avoids fake velocity, and links findings to hypotheses.
 */

import { DecisionImpact, InvestigationState, validateIdentifier } from "./investigation-state.js";
import { EvidenceItem } from "./evidence-ledger.js";
import { Hypothesis, updateHypothesis } from "./hypotheses.js";

export type TransactionFindingType =
  | "amount_context"
  | "channel_context"
  | "risk_signal_context"
  | "velocity_evidence_gap"
  | "temporal_denial";

export interface TransactionFinding {
  readonly findingId: string;
  readonly hunterName: "TransactionHunter";
  readonly findingType: TransactionFindingType;
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

export class TransactionHunterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TransactionHunterError";
  }
}

export function createTransactionFinding(params: {
  readonly findingId: string;
  readonly findingType: TransactionFindingType;
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
}): TransactionFinding {
  validateIdentifier(params.findingId, "findingId");

  if (!params.observation.trim()) {
    throw new TransactionHunterError("Finding observation cannot be empty");
  }
  if (!params.rationale.trim()) {
    throw new TransactionHunterError("Finding rationale cannot be empty");
  }
  if (params.confidenceScore < 0 || params.confidenceScore > 1) {
    throw new TransactionHunterError("confidenceScore must be between 0.0 and 1.0");
  }
  if (params.evidenceIds.length === 0) {
    throw new TransactionHunterError("Transaction finding must reference at least one verified EvidenceItem ID");
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return Object.freeze({
    findingId: params.findingId,
    hunterName: "TransactionHunter",
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

export interface TransactionHunterAnalysisResult {
  readonly findings: readonly TransactionFinding[];
  readonly updatedHypotheses: readonly Hypothesis[];
  readonly newEvidenceItems: readonly EvidenceItem[];
  readonly requestedEvidence: readonly string[];
}

export class TransactionHunterAnalyzer {
  /**
   * Performs deterministic transaction-level analysis on verified evidence items.
   * Preserves semantic boundaries:
   * OBSERVED FACT -> STRUCTURAL/TRANSACTIONAL INTERPRETATION -> HYPOTHESIS IMPACT
   */
  public analyzeTransactionEvidence(
    state: InvestigationState,
    evidenceItems: readonly EvidenceItem[],
    currentHypotheses: readonly Hypothesis[] = []
  ): TransactionHunterAnalysisResult {
    if (!state.investigationCutoff) {
      throw new TransactionHunterError("Missing investigationCutoff in investigation state");
    }

    const findings: TransactionFinding[] = [];
    const newEvidence: EvidenceItem[] = [];
    const requestedEvidence: string[] = [];
    let updatedHypotheses = [...currentHypotheses];

    // Filter to only verified, temporally eligible evidence from the Evidence Ledger
    const eligibleEvidence = evidenceItems.filter((e) => e.isTemporallyEligible);

    for (const item of eligibleEvidence) {
      // 1. Transaction Temporal Denial Finding
      if (item.observation.includes("future_transaction")) {
        findings.push(
          createTransactionFinding({
            findingId: `fnd-${state.investigationId}-tx-future-denial`,
            findingType: "temporal_denial",
            title: "Transaction Post-Dates Investigation Cutoff",
            observation: item.observation,
            rationale: "TigerGraph temporal predicate rejected transaction as future relative to cutoff. Transaction data is temporally unavailable.",
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

      // 2. Transaction Context Analysis (Amount, Channel, Risk Score, Product Code)
      if (item.toolName === "getTransactionContext" && item.entityType === "Transaction") {
        // Extract amount if present in observation or structured evidence
        const amountMatch = item.observation.match(/amount\s*[:=]\s*\$?([\d.]+)/i);
        const channelMatch = item.observation.match(/channel\s*[:=]\s*([a-zA-Z_]+)/i);
        const riskMatch = item.observation.match(/risk_score\s*[:=]\s*([\d.]+)/i);

        // A. Amount Context
        if (amountMatch) {
          const amount = parseFloat(amountMatch[1]);
          const isHighAmount = amount > 1000.0;
          const isLowAmount = amount < 15.0;

          const amountObservation = `Transaction amount is $${amount.toFixed(2)}.`;
          let amountRationale = "";
          let supportingHypotheses: string[] = [];
          let unresolved: string[] = [];

          if (isHighAmount) {
            amountRationale = "Amount exceeds typical transaction thresholds ($1000.00). High value warrants scrutiny but does not inherently constitute fraud without corroborating signals.";
            supportingHypotheses = ["card_not_present", "undocumented_pattern"];
            unresolved = ["Is this transaction amount typical for this cardholder's baseline history?"];
          } else if (isLowAmount) {
            amountRationale = "Amount is nominal (<$15.00). In card-testing scenarios, low amounts can represent initial authorizations, but low amounts are also common in legitimate daily spending.";
            supportingHypotheses = ["card_testing", "legitimate_activity"];
            unresolved = ["Were there subsequent larger authorizations following this nominal amount?"];
          } else {
            amountRationale = "Amount falls within typical consumer purchasing ranges ($15.00 - $1000.00). Normal amount is neutral and does not guarantee legitimacy on its own.";
            supportingHypotheses = ["legitimate_activity"];
            unresolved = ["Does this amount match customer's spending patterns?"];
          }

          const amountFinding = createTransactionFinding({
            findingId: `fnd-${state.investigationId}-tx-amount`,
            findingType: "amount_context",
            title: `Transaction Amount Evaluation ($${amount.toFixed(2)})`,
            observation: amountObservation,
            rationale: amountRationale,
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
            supportingHypothesisTypes: supportingHypotheses,
            contradictingHypothesisTypes: [],
            confidenceScore: 0.8,
            isTemporallyEligible: true,
            unresolvedQuestions: unresolved,
            decisionImpact: isHighAmount ? "medium" : "low",
          });
          findings.push(amountFinding);
          updatedHypotheses = this.linkFindingToHypotheses(amountFinding, updatedHypotheses);
        }

        // B. Channel Context (Online vs In-Person)
        if (channelMatch) {
          const channel = channelMatch[1].toLowerCase();
          const isOnline = channel === "online";
          const channelObservation = `Transaction channel identified as '${channel}'.`;
          const channelRationale = isOnline
            ? "Online channel (card-not-present) carries intrinsic exposure to remote credential misuse and automated card testing compared to physical POS."
            : "In-person channel requires physical card presentation or near-field token at a point of sale.";

          const channelFinding = createTransactionFinding({
            findingId: `fnd-${state.investigationId}-tx-channel`,
            findingType: "channel_context",
            title: `Transaction Channel Context (${channel})`,
            observation: channelObservation,
            rationale: channelRationale,
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
            supportingHypothesisTypes: isOnline ? ["card_not_present", "card_testing"] : ["legitimate_activity"],
            contradictingHypothesisTypes: isOnline ? [] : ["card_not_present"],
            confidenceScore: 0.9,
            isTemporallyEligible: true,
            unresolvedQuestions: isOnline
              ? ["Was the online transaction accompanied by device and browser telemetry?"]
              : ["Was the card physically swiped/dipped or manually keyed?"],
            decisionImpact: "medium",
          });
          findings.push(channelFinding);
          updatedHypotheses = this.linkFindingToHypotheses(channelFinding, updatedHypotheses);
        }

        // C. Risk Signal Context (Alerting input only, never ground truth)
        if (riskMatch) {
          const riskScore = parseFloat(riskMatch[1]);
          const riskObservation = `Model alerting risk score observed as ${riskScore.toFixed(2)}.`;
          const riskRationale = "Risk score is an upstream alerting model score, not ground truth fraud confirmation. It indicates reason for investigation triage but cannot serve as final outcome evidence.";

          const riskFinding = createTransactionFinding({
            findingId: `fnd-${state.investigationId}-tx-risk`,
            findingType: "risk_signal_context",
            title: `Upstream Risk Score Alert (${riskScore.toFixed(2)})`,
            observation: riskObservation,
            rationale: riskRationale,
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
            supportingHypothesisTypes: riskScore >= 0.5 ? ["card_not_present", "out_of_region_use"] : ["legitimate_activity"],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.7,
            isTemporallyEligible: true,
            unresolvedQuestions: ["What specific features triggered the upstream risk scoring model?"],
            decisionImpact: riskScore >= 0.5 ? "high" : "low",
          });
          findings.push(riskFinding);
          updatedHypotheses = this.linkFindingToHypotheses(riskFinding, updatedHypotheses);
        }

        // D. Anti-Fake Velocity: Check for missing transaction window / velocity evidence
        // The current TigerGraph tool getTransactionContext returns single-transaction attributes,
        // NOT surrounding time-series velocity windows (e.g. 5 txns in 10 mins).
        // Per instructions: DO NOT invent fake velocity. Represent as an unresolved question / requested evidence.
        const velocityFinding = createTransactionFinding({
          findingId: `fnd-${state.investigationId}-tx-velocity-gap`,
          findingType: "velocity_evidence_gap",
          title: "Surrounding Transaction Velocity Window Unavailable",
          observation: "Current tool query (getTransactionContext) does not provide time-series transaction window surrounding flagged transaction.",
          rationale: "Velocity calculation (rapid successive authorizations or card testing bursts) cannot be computed without surrounding temporal transaction history. Cannot fabricate historical timestamps.",
          evidenceIds: [item.evidenceId],
          affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
          supportingHypothesisTypes: [],
          contradictingHypothesisTypes: [],
          confidenceScore: 1.0, // Absolute certainty that velocity data is absent from current evidence
          isTemporallyEligible: true,
          unresolvedQuestions: [
            "What were the timestamps, amounts, and channels of transactions immediately preceding and following this transaction within a 24-hour window?"
          ],
          decisionImpact: "medium",
        });
        findings.push(velocityFinding);
        requestedEvidence.push("surrounding_transaction_velocity_window");
      }
    }

    return {
      findings: Object.freeze(findings),
      updatedHypotheses: Object.freeze(updatedHypotheses),
      newEvidenceItems: Object.freeze(newEvidence),
      requestedEvidence: Object.freeze(requestedEvidence),
    };
  }

  /**
   * Links relevant finding evidence to hypotheses without imposing arbitrary numerical certainty drift.
   */
  private linkFindingToHypotheses(
    finding: TransactionFinding,
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
