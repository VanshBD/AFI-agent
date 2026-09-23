/**
 * AFI Agentic Fraud Investigation — Device / Identity Hunter Contract and Findings
 * Strongly typed, deterministic specialist for device and identity evidence analysis.
 * Analyzes verified identity relationships: DeviceProfile, email domains, known cards, customer identity.
 * Strictly adheres to observed facts, avoids assuming device-sharing or email mismatches equal fraud,
 * and links findings to hypotheses without arbitrary confidence deltas.
 */

import { DecisionImpact, InvestigationState, validateIdentifier } from "./investigation-state.js";
import { EvidenceItem } from "./evidence-ledger.js";
import { Hypothesis, updateHypothesis } from "./hypotheses.js";

export type DeviceIdentityFindingType =
  | "device_linkage"
  | "sparse_identity_telemetry"
  | "email_domain_context"
  | "known_card_identity"
  | "shared_device_ambiguity"
  | "temporal_denial";

export interface DeviceIdentityFinding {
  readonly findingId: string;
  readonly hunterName: "DeviceIdentityHunter";
  readonly findingType: DeviceIdentityFindingType;
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

export class DeviceIdentityHunterError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DeviceIdentityHunterError";
  }
}

export function createDeviceIdentityFinding(params: {
  readonly findingId: string;
  readonly findingType: DeviceIdentityFindingType;
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
}): DeviceIdentityFinding {
  validateIdentifier(params.findingId, "findingId");

  if (!params.observation.trim()) {
    throw new DeviceIdentityHunterError("Finding observation cannot be empty");
  }
  if (!params.rationale.trim()) {
    throw new DeviceIdentityHunterError("Finding rationale cannot be empty");
  }
  if (params.confidenceScore < 0 || params.confidenceScore > 1) {
    throw new DeviceIdentityHunterError("confidenceScore must be between 0.0 and 1.0");
  }
  if (params.evidenceIds.length === 0) {
    throw new DeviceIdentityHunterError("Device/Identity finding must reference at least one verified EvidenceItem ID");
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  return Object.freeze({
    findingId: params.findingId,
    hunterName: "DeviceIdentityHunter",
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

export interface DeviceIdentityAnalysisResult {
  readonly findings: readonly DeviceIdentityFinding[];
  readonly updatedHypotheses: readonly Hypothesis[];
  readonly newEvidenceItems: readonly EvidenceItem[];
  readonly requestedEvidence: readonly string[];
}

export class DeviceIdentityHunterAnalyzer {
  /**
   * Performs deterministic device and identity analysis on verified evidence items.
   * Enforces semantic boundary:
   * OBSERVED FACT -> IDENTITY INTERPRETATION -> HYPOTHESIS IMPACT
   */
  public analyzeDeviceIdentityEvidence(
    state: InvestigationState,
    evidenceItems: readonly EvidenceItem[],
    currentHypotheses: readonly Hypothesis[] = []
  ): DeviceIdentityAnalysisResult {
    if (!state.investigationCutoff) {
      throw new DeviceIdentityHunterError("Missing investigationCutoff in investigation state");
    }

    const findings: DeviceIdentityFinding[] = [];
    const newEvidence: EvidenceItem[] = [];
    const requestedEvidence: string[] = [];
    let updatedHypotheses = [...currentHypotheses];

    const eligibleEvidence = evidenceItems.filter((e) => e.isTemporallyEligible);

    for (const item of eligibleEvidence) {
      // 1. Temporal Denial
      if (item.observation.includes("future_transaction")) {
        findings.push(
          createDeviceIdentityFinding({
            findingId: `fnd-${state.investigationId}-id-future-denial`,
            findingType: "temporal_denial",
            title: "Identity Evidence Post-Dates Cutoff",
            observation: item.observation,
            rationale: "TigerGraph temporal predicate rejected transaction as future relative to cutoff. Identity attributes cannot be evaluated.",
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

      // 2. Relationship Evidence (Devices, Email Domains, Known Cards)
      if (item.toolName === "getTransactionRelationshipContext") {
        const deviceMatch = item.observation.match(/(\d+)\s+linked devices/);
        const knownCardMatch = item.observation.match(/(\d+)\s+historically eligible known cards/);
        const purchaserMatch = item.observation.match(/purchaser_domains:\s*(\d+)/);
        const recipientMatch = item.observation.match(/recipient_domains:\s*(\d+)/);

        const deviceCount = deviceMatch ? parseInt(deviceMatch[1], 10) : 0;
        const knownCardCount = knownCardMatch ? parseInt(knownCardMatch[1], 10) : 0;
        const purchaserCount = purchaserMatch ? parseInt(purchaserMatch[1], 10) : 0;
        const recipientCount = recipientMatch ? parseInt(recipientMatch[1], 10) : 0;

        // A. Device Linkage vs Sparse Identity Telemetry
        if (deviceCount > 0) {
          const deviceFinding = createDeviceIdentityFinding({
            findingId: `fnd-${state.investigationId}-device-link`,
            findingType: "device_linkage",
            title: "Verified Device Profile Associated with Transaction",
            observation: `Transaction resolved to ${deviceCount} linked DeviceProfile node(s).`,
            rationale: "Presence of a normalized device profile provides browser/OS/hardware fingerprint context. A linked device is not inherently trusted or malicious without historical device binding comparison.",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
            supportingHypothesisTypes: ["card_not_present", "card_not_present_new_device"],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.8,
            isTemporallyEligible: true,
            unresolvedQuestions: ["Has this customer used this exact DeviceProfile in prior pre-cutoff transactions?"],
            decisionImpact: "medium",
          });
          findings.push(deviceFinding);
          updatedHypotheses = this.linkFindingToHypotheses(deviceFinding, updatedHypotheses);
        } else {
          // Sparse identity telemetry (per DATA_DICTIONARY: identity exists only for subset of online activity)
          const sparseFinding = createDeviceIdentityFinding({
            findingId: `fnd-${state.investigationId}-sparse-telemetry`,
            findingType: "sparse_identity_telemetry",
            title: "Sparse Identity Telemetry (No Device Profile Linked)",
            observation: "No linked DeviceProfile returned for this transaction in graph relationship query.",
            rationale: "Identity table records exist only for a subset of online activity. Lack of device telemetry does NOT prove fraud or legitimacy.",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
            supportingHypothesisTypes: [],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.6,
            isTemporallyEligible: true,
            unresolvedQuestions: ["Is the missing device profile due to in-person purchase or missing online identity collection?"],
            decisionImpact: "low",
          });
          findings.push(sparseFinding);
          requestedEvidence.push("customer_device_binding_history");
        }

        // B. Email Domain Context
        if (purchaserCount > 0 || recipientCount > 0) {
          const emailFinding = createDeviceIdentityFinding({
            findingId: `fnd-${state.investigationId}-email-context`,
            findingType: "email_domain_context",
            title: "Email Domain Topological Relationships Observed",
            observation: `Observed ${purchaserCount} purchaser email domain(s) and ${recipientCount} recipient email domain(s).`,
            rationale: "Email domains establish communication endpoint context. Differing domains or free/webmail domains are common in legitimate commerce and do not automatically prove account takeover.",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
            supportingHypothesisTypes: ["card_not_present", "legitimate_activity"],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.7,
            isTemporallyEligible: true,
            unresolvedQuestions: ["Does the purchaser email domain match the customer's registered profile domain?"],
            decisionImpact: "medium",
          });
          findings.push(emailFinding);
          updatedHypotheses = this.linkFindingToHypotheses(emailFinding, updatedHypotheses);
        }

        // C. Known Card Identity Consistency
        if (knownCardCount > 0) {
          const knownCardFinding = createDeviceIdentityFinding({
            findingId: `fnd-${state.investigationId}-known-card-id`,
            findingType: "known_card_identity",
            title: "Known Card Business Identity Link Identified",
            observation: `Associated with ${knownCardCount} historically eligible business card ID(s) from prior cases.`,
            rationale: "Supplied business card ID aligns observed card profile with historical enterprise card identity. Warrants examining whether card was compromised in past episodes.",
            evidenceIds: [item.evidenceId],
            affectedEntities: [{ entityType: "Transaction", entityId: state.flaggedTransactionId }],
            supportingHypothesisTypes: ["card_not_present", "out_of_region_use"],
            contradictingHypothesisTypes: [],
            confidenceScore: 0.75,
            isTemporallyEligible: true,
            unresolvedQuestions: ["Was the known card previously reported compromised in an earlier closed case?"],
            decisionImpact: "high",
          });
          findings.push(knownCardFinding);
          updatedHypotheses = this.linkFindingToHypotheses(knownCardFinding, updatedHypotheses);
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
    finding: DeviceIdentityFinding,
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
