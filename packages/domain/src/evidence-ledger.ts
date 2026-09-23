/**
 * AFI Agentic Fraud Investigation — Evidence Ledger Model
 * Differentiates strictly between OBSERVED FACT and MODEL INTERPRETATION.
 * Retains complete provenance, tool identity, cutoff, and temporal eligibility.
 */

import { DecisionImpact, validateIdentifier, validateSqlDatetime } from "./investigation-state.js";

export type EvidenceCategory = "observed_fact" | "model_interpretation";

export type EvidenceSourceType = "tigergraph_tool" | "dataset_fact" | "model_synthesis";

export type EvidencePolarity = "supports" | "contradicts" | "neutral" | "unresolved";

export interface EvidenceItem {
  readonly evidenceId: string;
  readonly investigationId: string;
  readonly category: EvidenceCategory; // "observed_fact" vs "model_interpretation"
  readonly sourceType: EvidenceSourceType;
  readonly toolName: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly observation: string;
  readonly observedAt?: string; // Datetime if known from source entity
  readonly investigationCutoff: string;
  readonly isTemporallyEligible: boolean;
  readonly polarity: EvidencePolarity;
  readonly relevantHypothesisIds: readonly string[];
  readonly decisionImpact: DecisionImpact;
  readonly provenance: {
    readonly queryOrSourceRef: string;
    readonly requestId: string;
    readonly executionTimestamp: string;
  };
  readonly toolOrModelVersion?: string;
  readonly createdAt: string;
}

export class EvidenceLedgerError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EvidenceLedgerError";
  }
}

export function createEvidenceItem(params: {
  readonly evidenceId: string;
  readonly investigationId: string;
  readonly category: EvidenceCategory;
  readonly sourceType: EvidenceSourceType;
  readonly toolName: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly observation: string;
  readonly observedAt?: string;
  readonly investigationCutoff: string;
  readonly polarity: EvidencePolarity;
  readonly relevantHypothesisIds?: readonly string[];
  readonly decisionImpact: DecisionImpact;
  readonly provenance: {
    readonly queryOrSourceRef: string;
    readonly requestId: string;
    readonly executionTimestamp: string;
  };
  readonly toolOrModelVersion?: string;
}): EvidenceItem {
  validateIdentifier(params.evidenceId, "evidenceId");
  validateIdentifier(params.investigationId, "investigationId");
  const validCutoff = validateSqlDatetime(params.investigationCutoff, "investigationCutoff");

  if (!params.observation.trim()) {
    throw new EvidenceLedgerError("Observation text cannot be empty");
  }

  // Check temporal eligibility
  let isTemporallyEligible = true;
  if (params.observedAt) {
    const validObserved = validateSqlDatetime(params.observedAt, "observedAt");
    const obsTime = new Date(`${validObserved.replace(" ", "T")}Z`).getTime();
    const cutTime = new Date(`${validCutoff.replace(" ", "T")}Z`).getTime();

    // If it's a closed case retrospective, must be strictly before cutoff (<)
    // If it's a transaction/device event, must be on or before cutoff (<=)
    if (params.entityType.toLowerCase() === "closedcase") {
      isTemporallyEligible = obsTime < cutTime;
    } else {
      isTemporallyEligible = obsTime <= cutTime;
    }

    if (!isTemporallyEligible) {
      throw new EvidenceLedgerError(
        `Temporal leakage violation: entity ${params.entityId} timestamp (${params.observedAt}) violates cutoff (${params.investigationCutoff})`
      );
    }
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return Object.freeze({
    evidenceId: params.evidenceId,
    investigationId: params.investigationId,
    category: params.category,
    sourceType: params.sourceType,
    toolName: params.toolName,
    entityType: params.entityType,
    entityId: params.entityId,
    observation: params.observation,
    observedAt: params.observedAt,
    investigationCutoff: validCutoff,
    isTemporallyEligible,
    polarity: params.polarity,
    relevantHypothesisIds: Object.freeze(params.relevantHypothesisIds ? [...params.relevantHypothesisIds] : []),
    decisionImpact: params.decisionImpact,
    provenance: Object.freeze({ ...params.provenance }),
    toolOrModelVersion: params.toolOrModelVersion,
    createdAt: now,
  });
}
