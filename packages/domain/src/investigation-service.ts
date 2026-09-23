/**
 * AFI Agentic Fraud Investigation — Investigation Service
 * Bridges the pure domain Commander with API consumers (UI, CLI, Benchmark).
 * Executes real Commander steps with deterministic or live TigerGraph tool clients.
 */

import {
  createInvestigationState,
  updateInvestigationState,
  InvestigationState,
} from "./investigation-state.js";
import {
  createHypothesis,
  Hypothesis,
} from "./hypotheses.js";
import {
  CommanderOrchestrator,
  CommanderToolClient,
  CommanderStepResult,
} from "./commander.js";
import { TigerGraphReadTool } from "../../tigergraph/src/read-tool-contracts.js";
import { GraphRagEngine } from "./graph-rag.js";
import { GraphAlgorithmsEngine } from "./graph-algorithms.js";
import { ModelGateway } from "./model-gateway.js";

import { PolicyAndNBAEngine, PolicyEvaluationResult } from "./next-best-action.js";
import { AdversarialAnalysisResult } from "./prosecutor-defense.js";
import { DecisionSensitivity } from "./decision-sensitivity.js";

import { GraphAlgorithmEvidenceResult } from "./graph-algorithms.js";
import { GraphRagSynthesisResult } from "./graph-rag.js";

import { EvidenceItem } from "./evidence-ledger.js";

export interface InvestigationExecutionPayload {
  readonly state: InvestigationState;
  readonly hypotheses: readonly Hypothesis[];
  readonly allEvidence: readonly EvidenceItem[];
  readonly stepResults: readonly CommanderStepResult[];
  readonly allFindings: readonly unknown[];
  readonly graphNodes: readonly { id: string; label: string; type: string }[];
  readonly graphEdges: readonly { source: string; target: string; relationship: string }[];
  readonly algoResult: GraphAlgorithmEvidenceResult;
  readonly ragResult: GraphRagSynthesisResult;
  readonly adversarialResult?: AdversarialAnalysisResult;
  readonly decisionSensitivities?: readonly DecisionSensitivity[];
  readonly policyResult?: PolicyEvaluationResult;
}

export class InvestigationService {
  private readonly graphRagEngine: GraphRagEngine;
  private readonly graphAlgorithmsEngine = new GraphAlgorithmsEngine();
  public readonly policyEngine = new PolicyAndNBAEngine();

  public constructor(
    private readonly toolClient: CommanderToolClient,
    modelGateway?: ModelGateway
  ) {
    this.graphRagEngine = new GraphRagEngine(modelGateway);
  }

  public async runFullInvestigation(params: {
    caseId: string;
    flaggedTxnId: string;
    customerId: string;
    cardId: string;
    cutoff: string;
    riskScore?: number;
    triggerText?: string;
    triggerType?: string;
    triggerAmount?: number;
  }): Promise<InvestigationExecutionPayload> {
    const commander = new CommanderOrchestrator(this.toolClient);

    let state = createInvestigationState({
      investigationId: `inv-${params.caseId}`,
      triggerId: params.triggerType ? `${params.caseId}-${params.triggerType}` : params.caseId,
      flaggedTransactionId: params.flaggedTxnId,
      customerId: params.customerId,
      cardId: params.cardId,
      investigationCutoff: params.cutoff,
      riskScore: params.riskScore,
      initialUnresolvedQuestions: params.triggerText ? [params.triggerText] : undefined,
    });

    let hypotheses: readonly Hypothesis[] = [
      createHypothesis({
        hypothesisId: `hyp-${params.caseId}-legit`,
        investigationId: state.investigationId,
        type: "legitimate_activity",
        title: "Legitimate Cardholder Activity",
        description: "Transaction authorized by legitimate customer",
        confidenceScore: 0.5,
        decisionRelevance: "Baseline benign hypothesis",
      }),
      createHypothesis({
        hypothesisId: `hyp-${params.caseId}-fraud`,
        investigationId: state.investigationId,
        type: "card_not_present",
        title: "Unauthorized Fraudulent Activity",
        description: "Compromise or unauthorized transaction",
        confidenceScore: params.riskScore ? (params.riskScore >= 0.7 ? 0.7 : 0.5) : 0.5,
        decisionRelevance: "Potential fraud requiring mitigation",
      }),
      createHypothesis({
        hypothesisId: `hyp-${params.caseId}-oor`,
        investigationId: state.investigationId,
        type: "out_of_region_use",
        title: "Out of Region Card Misuse",
        description: "Transaction in unfamiliar geographic region",
        confidenceScore: 0.5,
        decisionRelevance: "Geographic disparity evaluation",
      }),
    ];

    const stepResults: CommanderStepResult[] = [];
    const allFindings: unknown[] = [];
    let steps = 0;

    while (state.status !== "completed" && steps < 5) {
      steps++;
      const stepRes = await commander.executeInvestigationStep(
        state,
        `srv-req-${params.caseId}-${steps}`,
        hypotheses
      );
      state = stepRes.updatedState;
      hypotheses = stepRes.updatedHypotheses;
      stepResults.push(stepRes);
      allFindings.push(...stepRes.newFindings);

      if (stepRes.decision.action === "STOP") {
        break;
      }
    }

    // Graph Algorithms Analysis (Phase 7: Degree Centrality, Ring Risk, Precedent Similarity)
    const allEvidence = stepResults.flatMap((s) => s.newEvidence);
    const relatedCases = allEvidence
      .filter((e) => e.entityType === "ClosedCase" && e.entityId !== "none")
      .map((e) => ({ caseId: e.entityId, outcome: "fraud", pattern: "known_fraud" }));
    const knownCards = allEvidence
      .filter((e) => e.entityType === "KnownCard" && e.entityId !== "none")
      .map((e) => e.entityId);
    const deviceProfiles = allEvidence
      .filter((e) => e.entityType === "DeviceProfile" && e.entityId !== "none")
      .map((e) => e.entityId);
    const emailDomains = allEvidence
      .filter((e) => e.entityType === "EmailDomain" && e.entityId !== "none")
      .map((e) => e.entityId);
    const billingRegions = allEvidence
      .filter((e) => e.entityType === "BillingRegion" && e.entityId !== "none")
      .map((e) => e.entityId);

    const algoResult = this.graphAlgorithmsEngine.evaluateGraphAlgorithms(
      state,
      {
        transactionId: params.flaggedTxnId,
        cardId: params.cardId,
        deviceProfiles,
        emailDomains,
        billingRegions,
        relatedClosedCases: relatedCases,
        knownCards,
      },
      `algo-req-${params.caseId}`
    );

    // Graph-Grounded RAG (Phase 6: Grounded Synthesis over live subgraph facts)
    const ragResult = await this.graphRagEngine.synthesizeGraphContext(
      state,
      {
        transactionId: params.flaggedTxnId,
        customerId: params.customerId,
        cardId: params.cardId,
        cutoff: params.cutoff,
        linkedDevices: deviceProfiles,
        linkedEmailDomains: emailDomains,
        linkedBillingRegions: billingRegions,
        relatedClosedCases: relatedCases.map((c) => ({
          caseId: c.caseId,
          outcome: c.outcome,
          pattern: c.pattern,
          closedAt: params.cutoff,
        })),
        directGraphEvidence: allEvidence.map((e) => e.observation),
      },
      `rag-req-${params.caseId}`
    );

    const lastCommanderStep = stepResults[stepResults.length - 1];
    const lastPolicy = lastCommanderStep?.policyResult;
    const isEscalated = lastPolicy ? !lastPolicy.canExecuteAutomatically : false;

    state = updateInvestigationState(state, {
      status: isEscalated ? "escalated" : "completed",
      currentPhase: "decision_and_nba",
      evidenceIds: [
        ...state.evidenceIds,
        algoResult.evidenceItem.evidenceId,
        ragResult.evidenceItem.evidenceId,
      ],
      continuationDecision: {
        action: "STOP",
        reasonCode: "sufficient_evidence_exists",
        rationale: "All primary graph and historical fact-gathering phases are complete.",
        evaluatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
      },
    });

    // Append algorithm & GraphRAG evidence to stepResults for full ledger integration
    const enrichedStepResults: CommanderStepResult[] = [
      ...stepResults,
      {
        updatedState: state,
        executedTool: "findRelatedCases",
        newEvidence: [algoResult.evidenceItem, ragResult.evidenceItem],
        newFindings: [
          {
            type: "graph_algorithm_metrics",
            centrality: algoResult.degreeCentrality,
            ringRisk: algoResult.ringSuspicionScore,
            similarity: algoResult.similarityScore,
          } as any,
          {
            type: "graph_rag_synthesis",
            analysis: ragResult.synthesizedAnalysis,
            typology: ragResult.groundedTypologyAssessment,
          } as any,
        ],
        updatedHypotheses: hypotheses,
        decision: {
          action: "STOP",
          reasonCode: "sufficient_evidence_exists",
          rationale: "Graph algorithms and GraphRAG synthesis completed.",
          evaluatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
        },
        decisionSensitivities: lastCommanderStep?.decisionSensitivities,
        evidenceValueResult: lastCommanderStep?.evidenceValueResult,
        adversarialResult: lastCommanderStep?.adversarialResult,
        policyResult: lastCommanderStep?.policyResult,
      },
    ];

    allFindings.push(
      { type: "graph_algorithms", result: algoResult },
      { type: "graph_rag", result: ragResult }
    );

    // Extract real graph topology from executed tools and evidence
    const nodesMap = new Map<string, { id: string; label: string; type: string }>();
    const edgesList: { source: string; target: string; relationship: string }[] = [];

    // Always add primary root entities
    nodesMap.set(params.customerId, { id: params.customerId, label: `Customer ${params.customerId}`, type: "Customer" });
    nodesMap.set(params.cardId, { id: params.cardId, label: `Card ${params.cardId}`, type: "CardProfile" });
    nodesMap.set(params.flaggedTxnId, { id: params.flaggedTxnId, label: `Txn ${params.flaggedTxnId}`, type: "Transaction" });

    edgesList.push({ source: params.customerId, target: params.cardId, relationship: "OWNS" });
    edgesList.push({ source: params.cardId, target: params.flaggedTxnId, relationship: "MADE" });

    for (const step of enrichedStepResults) {
      for (const ev of step.newEvidence) {
        if (ev.entityType === "KnownCard" && ev.entityId !== "none") {
          nodesMap.set(ev.entityId, { id: ev.entityId, label: `KnownCard ${ev.entityId}`, type: "KnownCard" });
          edgesList.push({ source: params.flaggedTxnId, target: ev.entityId, relationship: "ON_KNOWN_CARD" });
        } else if (ev.entityType === "ClosedCase" && ev.entityId !== "none") {
          nodesMap.set(ev.entityId, { id: ev.entityId, label: `ClosedCase ${ev.entityId}`, type: "ClosedCase" });
          edgesList.push({ source: ev.entityId, target: params.flaggedTxnId, relationship: "INVOLVES" });
        } else if (ev.entityType === "DeviceProfile" && ev.entityId !== "none") {
          nodesMap.set(ev.entityId, { id: ev.entityId, label: `Device ${ev.entityId}`, type: "DeviceProfile" });
          edgesList.push({ source: params.flaggedTxnId, target: ev.entityId, relationship: "FROM_DEVICE" });
        } else if (ev.entityType === "EmailDomain" && ev.entityId !== "none") {
          nodesMap.set(ev.entityId, { id: ev.entityId, label: `Email ${ev.entityId}`, type: "EmailDomain" });
          edgesList.push({ source: params.flaggedTxnId, target: ev.entityId, relationship: "PURCHASER_EMAIL" });
        } else if (ev.entityType === "BillingRegion" && ev.entityId !== "none") {
          nodesMap.set(ev.entityId, { id: ev.entityId, label: `Region ${ev.entityId}`, type: "BillingRegion" });
          edgesList.push({ source: params.flaggedTxnId, target: ev.entityId, relationship: "BILLED_IN" });
        }
      }
    }

    return {
      state,
      hypotheses,
      allEvidence: enrichedStepResults.flatMap((s) => s.newEvidence),
      stepResults: enrichedStepResults,
      allFindings,
      graphNodes: Array.from(nodesMap.values()),
      graphEdges: edgesList,
      algoResult,
      ragResult,
      adversarialResult: lastCommanderStep?.adversarialResult,
      decisionSensitivities: lastCommanderStep?.decisionSensitivities,
      policyResult: lastCommanderStep?.policyResult,
    };
  }
}
