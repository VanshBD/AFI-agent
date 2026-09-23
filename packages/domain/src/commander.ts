/**
 * AFI Agentic Fraud Investigation — Commander / Investigation Orchestrator
 * Operates purely over structured, verified evidence.
 * Selects controlled tools, validates results, populates evidence ledger, and manages stopping.
 */

import { TigerGraphReadTool } from "../../tigergraph/src/read-tool-contracts.js";
import {
  InvestigationState,
  InvestigationContinuationDecision,
  updateInvestigationState,
} from "./investigation-state.js";
import { EvidenceItem, createEvidenceItem } from "./evidence-ledger.js";
import {
  CONTROLLED_TOOL_REGISTRY,
  ToolExecutionRequest,
  ToolExecutionResult,
  validateToolInvocationRequest,
} from "./tool-registry.js";
import { ModelGateway } from "./model-gateway.js";
import { GraphFinding, GraphHunterAnalyzer } from "./graph-hunter.js";
import { TransactionFinding, TransactionHunterAnalyzer } from "./transaction-hunter.js";
import { DeviceIdentityFinding, DeviceIdentityHunterAnalyzer } from "./device-identity-hunter.js";
import { BehaviorFinding, BehaviorHunterAnalyzer } from "./behavior-hunter.js";
import { CaseMemoryFinding, CaseMemoryHunterAnalyzer } from "./case-memory-hunter.js";
import { Hypothesis } from "./hypotheses.js";

import { DecisionSensitivity, DecisionSensitivityAnalyzer } from "./decision-sensitivity.js";
import { EvidenceValueEngine, EvidenceValueResult } from "./evidence-value.js";
import { AdversarialAnalysisResult, AdversarialAnalyzer } from "./prosecutor-defense.js";
import { PolicyAndNBAEngine, PolicyEvaluationResult } from "./next-best-action.js";

export interface CommanderToolClient {
  executeTool(
    toolName: TigerGraphReadTool,
    params: { txn?: string; cutoff?: string },
    requestId: string
  ): Promise<unknown>;
}

export interface CommanderStepResult {
  readonly updatedState: InvestigationState;
  readonly executedTool?: TigerGraphReadTool;
  readonly newEvidence: readonly EvidenceItem[];
  readonly newFindings: readonly (
    | GraphFinding
    | TransactionFinding
    | DeviceIdentityFinding
    | BehaviorFinding
    | CaseMemoryFinding
  )[];
  readonly updatedHypotheses: readonly Hypothesis[];
  readonly decision: InvestigationContinuationDecision;
  readonly decisionSensitivities?: readonly DecisionSensitivity[];
  readonly evidenceValueResult?: EvidenceValueResult;
  readonly adversarialResult?: AdversarialAnalysisResult;
  readonly policyResult?: PolicyEvaluationResult;
}

export class CommanderOrchestrator {
  private readonly graphHunter: GraphHunterAnalyzer;
  private readonly transactionHunter: TransactionHunterAnalyzer;
  private readonly deviceIdentityHunter: DeviceIdentityHunterAnalyzer;
  private readonly behaviorHunter: BehaviorHunterAnalyzer;
  private readonly caseMemoryHunter: CaseMemoryHunterAnalyzer;
  private readonly decisionSensitivityAnalyzer: DecisionSensitivityAnalyzer;
  private readonly evidenceValueEngine: EvidenceValueEngine;
  private readonly adversarialAnalyzer: AdversarialAnalyzer;
  private readonly policyAndNBAEngine: PolicyAndNBAEngine;

  public constructor(
    private readonly toolClient: CommanderToolClient,
    private readonly modelGateway?: ModelGateway
  ) {
    this.graphHunter = new GraphHunterAnalyzer();
    this.transactionHunter = new TransactionHunterAnalyzer();
    this.deviceIdentityHunter = new DeviceIdentityHunterAnalyzer();
    this.behaviorHunter = new BehaviorHunterAnalyzer();
    this.caseMemoryHunter = new CaseMemoryHunterAnalyzer();
    this.decisionSensitivityAnalyzer = new DecisionSensitivityAnalyzer();
    this.evidenceValueEngine = new EvidenceValueEngine();
    this.adversarialAnalyzer = new AdversarialAnalyzer();
    this.policyAndNBAEngine = new PolicyAndNBAEngine();
  }

  /**
   * Executes a single deterministic investigation step.
   */
  public async executeInvestigationStep(
    state: InvestigationState,
    stepRequestId: string,
    currentHypotheses: readonly Hypothesis[] = []
  ): Promise<CommanderStepResult> {

    // 1. Evaluate whether investigation should stop or continue
    const continuation = this.evaluateContinuation(state);
    if (continuation.action === "STOP") {
      const stoppedState = updateInvestigationState(state, {
        status: continuation.reasonCode === "policy_requires_escalation" ? "escalated" : "completed",
        continuationDecision: continuation,
      });
      return {
        updatedState: stoppedState,
        newEvidence: [],
        newFindings: [],
        updatedHypotheses: currentHypotheses,
        decision: continuation,
      };
    }

    // 2. Select next tool based on current phase and unresolved state
    const toolToCall = this.selectNextTool(state);
    if (!toolToCall) {
      const stopDecision: InvestigationContinuationDecision = {
        action: "STOP",
        reasonCode: "no_permitted_tool_can_reduce_uncertainty",
        rationale: "All permitted tools for available facts have already been executed.",
        evaluatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      };
      const finalized = updateInvestigationState(state, {
        status: "completed",
        continuationDecision: stopDecision,
      });
      return {
        updatedState: finalized,
        newEvidence: [],
        newFindings: [],
        updatedHypotheses: currentHypotheses,
        decision: stopDecision,
      };
    }


    // 3. Validate tool invocation request through Registry
    const toolRequest: ToolExecutionRequest = {
      toolName: toolToCall,
      parameters: {
        txn: state.flaggedTransactionId,
        cutoff: state.investigationCutoff,
      },
      currentPhase: state.currentPhase,
      investigationCutoff: state.investigationCutoff,
    };
    validateToolInvocationRequest(toolRequest);

    // 4. Execute tool
    const rawResult = await this.toolClient.executeTool(
      toolToCall,
      toolRequest.parameters,
      stepRequestId
    );

    // 5. Convert observations into structured EvidenceItems
    const newEvidenceItems = this.extractEvidenceFromToolResult(
      state,
      toolToCall,
      rawResult,
      stepRequestId
    );

    // 6. Specialist Analysis: Run specialists over verified evidence
    const graphAnalysis = this.graphHunter.analyzeGraphEvidence(
       state,
       newEvidenceItems,
       currentHypotheses
     );

    const transactionAnalysis = this.transactionHunter.analyzeTransactionEvidence(
       state,
       newEvidenceItems,
       graphAnalysis.updatedHypotheses
     );

    const deviceIdentityAnalysis = this.deviceIdentityHunter.analyzeDeviceIdentityEvidence(
      state,
      newEvidenceItems,
      transactionAnalysis.updatedHypotheses
    );

    const behaviorAnalysis = this.behaviorHunter.analyzeBehaviorEvidence(
      state,
      newEvidenceItems,
      deviceIdentityAnalysis.updatedHypotheses
    );

    const caseMemoryAnalysis = this.caseMemoryHunter.analyzeCaseMemoryEvidence(
      state,
      newEvidenceItems,
      behaviorAnalysis.updatedHypotheses
    );

    const combinedFindings = [
      ...graphAnalysis.findings,
      ...transactionAnalysis.findings,
      ...deviceIdentityAnalysis.findings,
      ...behaviorAnalysis.findings,
      ...caseMemoryAnalysis.findings,
    ];
    const combinedHypotheses = caseMemoryAnalysis.updatedHypotheses;

    // 7. Milestone 3, 4, 5: Run Decision Sensitivity, Evidence Value, Adversarial, and NBA
    const currentSensitivities = this.decisionSensitivityAnalyzer.analyzeSensitivity(
      state,
      combinedHypotheses,
      newEvidenceItems
    );

    const evidenceValueResult = this.evidenceValueEngine.evaluateEvidenceValue(
      state,
      combinedHypotheses,
      currentSensitivities
    );

    const adversarialResult = this.adversarialAnalyzer.analyze(
      state,
      combinedHypotheses,
      newEvidenceItems
    );

    const policyResult = this.policyAndNBAEngine.evaluateNBA(
      state,
      combinedHypotheses,
      newEvidenceItems,
      currentSensitivities,
      adversarialResult
    );

    // 8. Transition state and phase
    const nextPhase = this.determineNextPhase(state.currentPhase, toolToCall);
    const updatedEvidenceIds = [...state.evidenceIds, ...newEvidenceItems.map((e) => e.evidenceId)];
    const updatedToolCalls = [...state.toolCallIds, `${toolToCall}:${stepRequestId}`];
    const updatedRequestedEvidence = [
      ...state.requestedEvidence,
      ...transactionAnalysis.requestedEvidence,
      ...deviceIdentityAnalysis.requestedEvidence,
      ...behaviorAnalysis.requestedEvidence,
      ...caseMemoryAnalysis.requestedEvidence,
    ];

    const nextState = updateInvestigationState(state, {
      status: policyResult.canExecuteAutomatically ? "investigating" : "awaiting_evidence",
      currentPhase: nextPhase,
      evidenceIds: updatedEvidenceIds,
      toolCallIds: updatedToolCalls,
      unresolvedQuestions: this.updateUnresolvedQuestions(state, toolToCall),
      requestedEvidence: updatedRequestedEvidence,
      contradictions: adversarialResult.detectedContradictions,
      nextBestAction: policyResult.recommendedAction,
    });

    const nextContinuation = this.evaluateContinuation(nextState);

    return {
      updatedState: updateInvestigationState(nextState, {
        continuationDecision: nextContinuation,
      }),
      executedTool: toolToCall,
      newEvidence: newEvidenceItems,
      newFindings: combinedFindings,
      updatedHypotheses: combinedHypotheses,
      decision: nextContinuation,
      decisionSensitivities: currentSensitivities,
      evidenceValueResult,
      adversarialResult,
      policyResult,
    };
  }


  /**
   * Deterministic tool selection strategy enforcing dependency order.
   */
  private selectNextTool(state: InvestigationState): TigerGraphReadTool | undefined {
    const executedTools = new Set(state.toolCallIds.map((id) => id.split(":")[0]));

    // Step 1: In triage/initial fact gathering, fetch direct transaction facts first
    if (!executedTools.has("getTransactionContext")) {
      return "getTransactionContext";
    }

    // Step 2: Expand to identity/device/network relationships
    if (!executedTools.has("getTransactionRelationshipContext")) {
      return "getTransactionRelationshipContext";
    }

    // Step 3: Expand to historical retrospective memory
    if (!executedTools.has("findRelatedCases")) {
      return "findRelatedCases";
    }

    return undefined;
  }

  private determineNextPhase(
    currentPhase: InvestigationState["currentPhase"],
    justExecuted: TigerGraphReadTool
  ): InvestigationState["currentPhase"] {
    if (justExecuted === "getTransactionContext") {
      return "relationship_expansion";
    }
    if (justExecuted === "getTransactionRelationshipContext") {
      return "historical_retrospective";
    }
    if (justExecuted === "findRelatedCases") {
      return "hypothesis_evaluation";
    }
    return currentPhase;
  }

  private updateUnresolvedQuestions(
    state: InvestigationState,
    justExecuted: TigerGraphReadTool
  ): readonly string[] {
    const remaining = [...state.unresolvedQuestions];
    if (justExecuted === "getTransactionContext") {
      const idx = remaining.findIndex((q) => q.toLowerCase().includes("flagged transaction"));
      if (idx !== -1) remaining.splice(idx, 1);
      remaining.push("Investigate device and network relationship fingerprints");
    } else if (justExecuted === "getTransactionRelationshipContext") {
      const idx = remaining.findIndex((q) => q.toLowerCase().includes("relationship"));
      if (idx !== -1) remaining.splice(idx, 1);
      remaining.push("Compare against historical closed cases and known fraud patterns");
    } else if (justExecuted === "findRelatedCases") {
      const idx = remaining.findIndex((q) => q.toLowerCase().includes("historical"));
      if (idx !== -1) remaining.splice(idx, 1);
      remaining.push("Evaluate competing fraud vs false-positive hypotheses");
    }
    return remaining;
  }

  /**
   * Evaluates explicit continuation rules.
   */
  private evaluateContinuation(state: InvestigationState): InvestigationContinuationDecision {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    if (state.currentPhase === "hypothesis_evaluation" || state.currentPhase === "decision_and_nba") {
      return {
        action: "STOP",
        reasonCode: "sufficient_evidence_exists",
        rationale: "All primary graph and historical fact-gathering phases are complete.",
        evaluatedAt: now,
      };
    }

    if (state.toolCallIds.length >= 5) {
      return {
        action: "STOP",
        reasonCode: "no_permitted_tool_can_reduce_uncertainty",
        rationale: "Maximum tool execution budget for foundation milestone reached.",
        evaluatedAt: now,
      };
    }

    return {
      action: "CONTINUE",
      reasonCode: "required_evidence_missing",
      rationale: "Additional investigative facts needed to resolve initial triage questions.",
      evaluatedAt: now,
    };
  }

  /**
   * Converts raw tool responses into validated EvidenceItems.
   */
  private extractEvidenceFromToolResult(
    state: InvestigationState,
    toolName: TigerGraphReadTool,
    rawResult: unknown,
    requestId: string
  ): readonly EvidenceItem[] {
    const items: EvidenceItem[] = [];
    const executionTimestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
    const parsed = rawResult as {
      results?: readonly Record<string, unknown>[];
      error?: boolean;
      message?: string;
    };

    if (!parsed || parsed.error || !parsed.results || parsed.results.length === 0) {
      return items;
    }

    const firstResult = parsed.results[0];
    if (!firstResult) {
      return items;
    }

    // Explicit check for GSQL temporal denial
    if (firstResult["status"] === "future_transaction") {
      items.push(
        createEvidenceItem({
          evidenceId: `ev-${state.investigationId}-${toolName}-future`,
          investigationId: state.investigationId,
          category: "observed_fact",
          sourceType: "tigergraph_tool",
          toolName,
          entityType: "Transaction",
          entityId: state.flaggedTransactionId,
          observation: `Transaction ${state.flaggedTransactionId} rejected as future_transaction relative to cutoff ${state.investigationCutoff}.`,
          investigationCutoff: state.investigationCutoff,
          polarity: "contradicts",
          decisionImpact: "high",
          provenance: {
            queryOrSourceRef: toolName,
            requestId,
            executionTimestamp,
          },
        })
      );
      return items;
    }

    if (toolName === "getTransactionContext") {
      const cardProfiles = (firstResult["card_profiles"] as readonly Record<string, unknown>[]) ?? [];
      const customerId = cardProfiles.length > 0 && cardProfiles[0]["attributes"]
        ? (cardProfiles[0]["attributes"] as Record<string, unknown>)["customer_id"] as string
        : cardProfiles.length > 0
        ? (cardProfiles[0] as Record<string, unknown>)["customer_id"] as string
        : "unknown";

      const txnRaw = (firstResult["transaction"] as Record<string, unknown>) ?? {};
      const txnAttributes = (txnRaw["attributes"] as Record<string, unknown>) ?? txnRaw;
      const amount = txnAttributes["amount"] !== undefined ? Number(txnAttributes["amount"]) : undefined;
      const channel = txnAttributes["channel"] !== undefined ? String(txnAttributes["channel"]) : undefined;
      const riskScore = txnAttributes["risk_score"] !== undefined ? Number(txnAttributes["risk_score"]) : undefined;

      let txnDetail = `Transaction ${state.flaggedTransactionId} verified in graph for customer ${customerId} with ${cardProfiles.length} associated card profiles.`;
      if (amount !== undefined) {
        txnDetail += ` amount: $${amount.toFixed(2)}`;
      }
      if (channel !== undefined) {
        txnDetail += ` channel: ${channel}`;
      }
      if (riskScore !== undefined) {
        txnDetail += ` risk_score: ${riskScore.toFixed(2)}`;
      }

      items.push(
        createEvidenceItem({
          evidenceId: `ev-${state.investigationId}-txn`,
          investigationId: state.investigationId,
          category: "observed_fact",
          sourceType: "tigergraph_tool",
          toolName,
          entityType: "Transaction",
          entityId: state.flaggedTransactionId,
          observation: txnDetail,
          investigationCutoff: state.investigationCutoff,
          polarity: "neutral",
          decisionImpact: "medium",
          provenance: {
            queryOrSourceRef: toolName,
            requestId,
            executionTimestamp,
          },
        })
      );
    } else if (toolName === "getTransactionRelationshipContext") {
      const knownCards = (firstResult["known_cards"] as readonly unknown[]) ?? [];
      const billingRegions = (firstResult["billing_regions"] as readonly unknown[]) ?? [];
      const devices = (firstResult["device_profiles"] as readonly unknown[]) ?? [];
      const purchaserDomains = (firstResult["purchaser_email_domains"] as readonly unknown[]) ?? [];
      const recipientDomains = (firstResult["recipient_email_domains"] as readonly unknown[]) ?? [];

      let relObservation = `Observed ${devices.length} linked devices, ${billingRegions.length} billing regions, and ${knownCards.length} historically eligible known cards.`;
      if (purchaserDomains.length > 0 || recipientDomains.length > 0) {
        relObservation += ` purchaser_domains: ${purchaserDomains.length}, recipient_domains: ${recipientDomains.length}.`;
      }

      items.push(
        createEvidenceItem({
          evidenceId: `ev-${state.investigationId}-rel`,
          investigationId: state.investigationId,
          category: "observed_fact",
          sourceType: "tigergraph_tool",
          toolName,
          entityType: "Transaction",
          entityId: state.flaggedTransactionId,
          observation: relObservation,
          investigationCutoff: state.investigationCutoff,
          polarity: knownCards.length > 0 ? "supports" : "neutral",
          decisionImpact: "high",
          provenance: {
            queryOrSourceRef: toolName,
            requestId,
            executionTimestamp,
          },
        })
      );

      for (const d of devices) {
        const devId = typeof d === "string" ? d : (d as any)?.device_profile_id ?? (d as any)?.v_id ?? "device";
        const safeDev = String(devId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 16);
        items.push(
          createEvidenceItem({
            evidenceId: `ev-${state.investigationId}-dev-${safeDev}`,
            investigationId: state.investigationId,
            category: "observed_fact",
            sourceType: "tigergraph_tool",
            toolName,
            entityType: "DeviceProfile",
            entityId: String(devId),
            observation: `Device profile linked to transaction: ${devId}`,
            investigationCutoff: state.investigationCutoff,
            polarity: "neutral",
            decisionImpact: "medium",
            provenance: { queryOrSourceRef: toolName, requestId, executionTimestamp },
          })
        );
      }

      for (const r of billingRegions) {
        const regId = typeof r === "string" ? r : (r as any)?.billing_region_id ?? (r as any)?.v_id ?? "region";
        const safeReg = String(regId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 16);
        items.push(
          createEvidenceItem({
            evidenceId: `ev-${state.investigationId}-reg-${safeReg}`,
            investigationId: state.investigationId,
            category: "observed_fact",
            sourceType: "tigergraph_tool",
            toolName,
            entityType: "BillingRegion",
            entityId: String(regId),
            observation: `Billing region linked to transaction: ${regId}`,
            investigationCutoff: state.investigationCutoff,
            polarity: "neutral",
            decisionImpact: "medium",
            provenance: { queryOrSourceRef: toolName, requestId, executionTimestamp },
          })
        );
      }

      for (const k of knownCards) {
        const cardId = typeof k === "string" ? k : (k as any)?.card_id ?? (k as any)?.v_id ?? "card";
        const safeCard = String(cardId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 16);
        items.push(
          createEvidenceItem({
            evidenceId: `ev-${state.investigationId}-card-${safeCard}`,
            investigationId: state.investigationId,
            category: "observed_fact",
            sourceType: "tigergraph_tool",
            toolName,
            entityType: "KnownCard",
            entityId: String(cardId),
            observation: `Historically compromised known card linked: ${cardId}`,
            investigationCutoff: state.investigationCutoff,
            polarity: "supports",
            decisionImpact: "high",
            provenance: { queryOrSourceRef: toolName, requestId, executionTimestamp },
          })
        );
      }
    } else if (toolName === "findRelatedCases") {
      const eligibleCases = (firstResult["eligible_closed_cases"] as readonly Record<string, unknown>[]) ?? [];
      const patterns = (firstResult["fraud_patterns"] as readonly Record<string, unknown>[]) ?? [];
      const knownCards = (firstResult["known_cards"] as readonly unknown[]) ?? [];

      let caseDetail = `Identified ${eligibleCases.length} historically eligible closed cases prior to cutoff.`;
      if (eligibleCases.length > 0) {
        const outcomes = eligibleCases.map((c) => (c["attributes"] ? (c["attributes"] as Record<string, unknown>)["outcome"] : c["outcome"])).filter(Boolean);
        if (outcomes.length > 0) {
          caseDetail += ` outcomes: [${outcomes.join(", ")}].`;
        }
        if (patterns.length > 0) {
          const patternNames = patterns.map((p) => p["pattern_id"] ?? (p["attributes"] ? (p["attributes"] as Record<string, unknown>)["pattern_id"] : undefined)).filter(Boolean);
          if (patternNames.length > 0) {
            caseDetail += ` patterns: [${patternNames.join(", ")}].`;
          }
        }
      }

      items.push(
        createEvidenceItem({
          evidenceId: `ev-${state.investigationId}-cases`,
          investigationId: state.investigationId,
          category: "observed_fact",
          sourceType: "tigergraph_tool",
          toolName,
          entityType: "ClosedCase",
          entityId: eligibleCases.length > 0 ? (eligibleCases[0]["case_id"] as string) : "none",
          observation: caseDetail,
          investigationCutoff: state.investigationCutoff,
          polarity: eligibleCases.length > 0 ? "supports" : "neutral",
          decisionImpact: "high",
          provenance: {
            queryOrSourceRef: toolName,
            requestId,
            executionTimestamp,
          },
        })
      );

      for (const c of eligibleCases) {
        const cId = c["case_id"] ?? (c["attributes"] ? (c["attributes"] as any)["case_id"] : undefined);
        const outcome = c["outcome"] ?? (c["attributes"] ? (c["attributes"] as any)["outcome"] : undefined);
        if (cId) {
          const safeCase = String(cId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 16);
          items.push(
            createEvidenceItem({
              evidenceId: `ev-${state.investigationId}-case-${safeCase}`,
              investigationId: state.investigationId,
              category: "observed_fact",
              sourceType: "tigergraph_tool",
              toolName,
              entityType: "ClosedCase",
              entityId: String(cId),
              observation: `Historically closed precedent case: ${cId} (outcome: ${outcome ?? "unknown"})`,
              investigationCutoff: state.investigationCutoff,
              polarity: outcome === "confirmed_fraud" ? "supports" : "contradicts",
              decisionImpact: "high",
              provenance: { queryOrSourceRef: toolName, requestId, executionTimestamp },
            })
          );
        }
      }
    }

    return items;
  }
}
