/**
 * AFI Agentic Fraud Investigation — Core Investigation State and Enums
 * Strictly typed, runtime validated, temporal boundary safe.
 */

export type InvestigationStatus =
  | "initialized"
  | "investigating"
  | "awaiting_evidence"
  | "escalated"
  | "completed";

export type InvestigationPhase =
  | "triage"
  | "initial_fact_gathering"
  | "relationship_expansion"
  | "historical_retrospective"
  | "hypothesis_evaluation"
  | "decision_and_nba";

export type DecisionImpact = "high" | "medium" | "low" | "none";

export type ApprovalRequirement = "auto" | "L1" | "L2";

export interface InvestigationContinuationDecision {
  readonly action: "CONTINUE" | "STOP";
  readonly reasonCode:
    | "required_evidence_missing"
    | "unresolved_decision_critical_question"
    | "no_permitted_tool_can_reduce_uncertainty"
    | "sufficient_evidence_exists"
    | "policy_requires_escalation"
    | "evidence_no_longer_decision_relevant";
  readonly rationale: string;
  readonly evaluatedAt: string;
}

export interface NextBestActionRecommendation {
  readonly recommendationId: string;
  readonly actionType:
    | "block_card"
    | "reissue_card"
    | "customer_contact"
    | "file_sar"
    | "close_false_positive"
    | "escalate_to_human_analyst"
    | "request_additional_evidence";
  readonly description: string;
  readonly approvalRequired: ApprovalRequirement;
  readonly rationale: string;
  readonly confidence: number;
}

export interface Contradiction {
  readonly contradictionId: string;
  readonly description: string;
  readonly conflictingEvidenceIds: readonly string[];
  readonly resolutionStatus: "unresolved" | "explained" | "dismissed";
  readonly resolutionRationale?: string;
}

export interface InvestigationState {
  readonly investigationId: string;
  readonly triggerId: string;
  readonly flaggedTransactionId: string;
  readonly customerId: string;
  readonly cardId: string;
  readonly investigationCutoff: string; // ISO / SQL datetime format: YYYY-MM-DD HH:MM:SS
  readonly status: InvestigationStatus;
  readonly currentPhase: InvestigationPhase;
  readonly riskScore?: number;
  readonly unresolvedQuestions: readonly string[];
  readonly requestedEvidence: readonly string[];
  readonly contradictions: readonly Contradiction[];
  readonly evidenceIds: readonly string[];
  readonly hypothesisIds: readonly string[];
  readonly toolCallIds: readonly string[];
  readonly nextBestAction?: NextBestActionRecommendation;
  readonly continuationDecision?: InvestigationContinuationDecision;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const SQL_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;

export class InvestigationStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvestigationStateError";
  }
}

export function validateSqlDatetime(dt: string, fieldName = "timestamp"): string {
  if (!SQL_DATETIME.test(dt)) {
    throw new InvestigationStateError(`Invalid ${fieldName}: must match YYYY-MM-DD HH:MM:SS format`);
  }
  const parsed = new Date(`${dt.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19).replace("T", " ") !== dt) {
    throw new InvestigationStateError(`Invalid calendar value for ${fieldName}: ${dt}`);
  }
  return dt;
}

export function validateIdentifier(id: string, fieldName = "id"): string {
  if (!IDENTIFIER.test(id)) {
    throw new InvestigationStateError(`Invalid ${fieldName}: must be alphanumeric (1-128 chars)`);
  }
  return id;
}

/**
 * Creates an immutable-cutoff initial investigation state.
 */
export function createInvestigationState(params: {
  readonly investigationId: string;
  readonly triggerId: string;
  readonly flaggedTransactionId: string;
  readonly customerId: string;
  readonly cardId: string;
  readonly investigationCutoff: string;
  readonly riskScore?: number;
  readonly initialUnresolvedQuestions?: readonly string[];
}): InvestigationState {
  validateIdentifier(params.investigationId, "investigationId");
  validateIdentifier(params.triggerId, "triggerId");
  validateIdentifier(params.flaggedTransactionId, "flaggedTransactionId");
  validateIdentifier(params.customerId, "customerId");
  validateIdentifier(params.cardId, "cardId");
  const validCutoff = validateSqlDatetime(params.investigationCutoff, "investigationCutoff");

  if (params.riskScore !== undefined && (params.riskScore < 0 || params.riskScore > 1)) {
    throw new InvestigationStateError("riskScore must be between 0 and 1");
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return Object.freeze({
    investigationId: params.investigationId,
    triggerId: params.triggerId,
    flaggedTransactionId: params.flaggedTransactionId,
    customerId: params.customerId,
    cardId: params.cardId,
    investigationCutoff: validCutoff,
    status: "initialized",
    currentPhase: "triage",
    riskScore: params.riskScore,
    unresolvedQuestions: Object.freeze(params.initialUnresolvedQuestions ? [...params.initialUnresolvedQuestions] : ["Verify flagged transaction attributes and baseline customer profile"]),
    requestedEvidence: Object.freeze([]),
    contradictions: Object.freeze([]),
    evidenceIds: Object.freeze([]),
    hypothesisIds: Object.freeze([]),
    toolCallIds: Object.freeze([]),
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Updates state while guaranteeing immutable cutoff invariant.
 */
export function updateInvestigationState(
  state: InvestigationState,
  updates: Partial<Omit<InvestigationState, "investigationId" | "investigationCutoff" | "createdAt">> & {
    readonly investigationCutoff?: string;
  }
): InvestigationState {
  if (updates.investigationCutoff !== undefined && updates.investigationCutoff !== state.investigationCutoff) {
    throw new InvestigationStateError(
      `Illegal attempt to mutate immutable investigationCutoff from ${state.investigationCutoff} to ${updates.investigationCutoff}`
    );
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return Object.freeze({
    ...state,
    ...updates,
    investigationId: state.investigationId,
    investigationCutoff: state.investigationCutoff,
    createdAt: state.createdAt,
    unresolvedQuestions: Object.freeze(updates.unresolvedQuestions ? Array.from(new Set(updates.unresolvedQuestions)) : state.unresolvedQuestions),
    requestedEvidence: Object.freeze(updates.requestedEvidence ? Array.from(new Set(updates.requestedEvidence)) : state.requestedEvidence),
    contradictions: Object.freeze(updates.contradictions ? [...updates.contradictions] : state.contradictions),
    evidenceIds: Object.freeze(updates.evidenceIds ? Array.from(new Set(updates.evidenceIds)) : state.evidenceIds),
    hypothesisIds: Object.freeze(updates.hypothesisIds ? Array.from(new Set(updates.hypothesisIds)) : state.hypothesisIds),
    toolCallIds: Object.freeze(updates.toolCallIds ? Array.from(new Set(updates.toolCallIds)) : state.toolCallIds),
    updatedAt: now,
  });
}

