/**
 * AFI Agentic Fraud Investigation — Hypotheses Model
 * Supports competing hypotheses, supporting/contradicting evidence links, and uncertainty.
 */

import { validateIdentifier } from "./investigation-state.js";

export type HypothesisType =
  | "legitimate_activity"
  | "card_testing"
  | "card_not_present"
  | "card_not_present_new_device"
  | "out_of_region_use"
  | "account_takeover"
  | "undocumented_pattern";

export type HypothesisStatus =
  | "active"
  | "supported"
  | "refuted"
  | "inconclusive"
  | "superseded";

export interface Hypothesis {
  readonly hypothesisId: string;
  readonly investigationId: string;
  readonly type: HypothesisType;
  readonly title: string;
  readonly description: string;
  readonly supportingEvidenceIds: readonly string[];
  readonly contradictingEvidenceIds: readonly string[];
  readonly unresolvedEvidenceIds: readonly string[];
  readonly confidenceScore: number; // 0.0 to 1.0
  readonly status: HypothesisStatus;
  readonly decisionRelevance: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class HypothesisError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HypothesisError";
  }
}

export function createHypothesis(params: {
  readonly hypothesisId: string;
  readonly investigationId: string;
  readonly type: HypothesisType;
  readonly title: string;
  readonly description: string;
  readonly supportingEvidenceIds?: readonly string[];
  readonly contradictingEvidenceIds?: readonly string[];
  readonly unresolvedEvidenceIds?: readonly string[];
  readonly confidenceScore?: number;
  readonly decisionRelevance: string;
}): Hypothesis {
  validateIdentifier(params.hypothesisId, "hypothesisId");
  validateIdentifier(params.investigationId, "investigationId");

  const confidence = params.confidenceScore ?? 0.5;
  if (confidence < 0 || confidence > 1) {
    throw new HypothesisError("confidenceScore must be between 0.0 and 1.0");
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return Object.freeze({
    hypothesisId: params.hypothesisId,
    investigationId: params.investigationId,
    type: params.type,
    title: params.title.trim(),
    description: params.description.trim(),
    supportingEvidenceIds: Object.freeze(params.supportingEvidenceIds ? [...params.supportingEvidenceIds] : []),
    contradictingEvidenceIds: Object.freeze(params.contradictingEvidenceIds ? [...params.contradictingEvidenceIds] : []),
    unresolvedEvidenceIds: Object.freeze(params.unresolvedEvidenceIds ? [...params.unresolvedEvidenceIds] : []),
    confidenceScore: confidence,
    status: "active",
    decisionRelevance: params.decisionRelevance.trim(),
    createdAt: now,
    updatedAt: now,
  });
}

export function updateHypothesis(
  hypothesis: Hypothesis,
  updates: Partial<Omit<Hypothesis, "hypothesisId" | "investigationId" | "createdAt">>
): Hypothesis {
  const confidence = updates.confidenceScore ?? hypothesis.confidenceScore;
  if (confidence < 0 || confidence > 1) {
    throw new HypothesisError("confidenceScore must be between 0.0 and 1.0");
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return Object.freeze({
    ...hypothesis,
    ...updates,
    hypothesisId: hypothesis.hypothesisId,
    investigationId: hypothesis.investigationId,
    createdAt: hypothesis.createdAt,
    supportingEvidenceIds: Object.freeze(
      updates.supportingEvidenceIds
        ? Array.from(new Set(updates.supportingEvidenceIds))
        : hypothesis.supportingEvidenceIds
    ),
    contradictingEvidenceIds: Object.freeze(
      updates.contradictingEvidenceIds
        ? Array.from(new Set(updates.contradictingEvidenceIds))
        : hypothesis.contradictingEvidenceIds
    ),
    unresolvedEvidenceIds: Object.freeze(
      updates.unresolvedEvidenceIds
        ? Array.from(new Set(updates.unresolvedEvidenceIds))
        : hypothesis.unresolvedEvidenceIds
    ),
    confidenceScore: confidence,
    updatedAt: now,
  });
}

