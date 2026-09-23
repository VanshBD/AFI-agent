/**
 * AFI Agentic Fraud Investigation — Controlled Tool Registry
 * Strictly wraps allowlisted, read-only TigerGraph queries.
 * Prevents arbitrary GSQL generation or execution.
 */

import { TigerGraphReadTool, validateTransactionReadInput } from "../../tigergraph/src/read-tool-contracts.js";
import { InvestigationPhase } from "./investigation-state.js";

export interface ToolDefinition {
  readonly name: TigerGraphReadTool;
  readonly description: string;
  readonly permittedPhases: readonly InvestigationPhase[];
  readonly requiredParameters: readonly string[];
  readonly isReadOnly: true;
}

export const CONTROLLED_TOOL_REGISTRY: Readonly<Record<TigerGraphReadTool, ToolDefinition>> = Object.freeze({
  getTransactionContext: Object.freeze({
    name: "getTransactionContext",
    description: "Fetches transaction facts, card profile, customer ID, and basic timestamps.",
    permittedPhases: Object.freeze<readonly InvestigationPhase[]>(["triage", "initial_fact_gathering"]),
    requiredParameters: Object.freeze(["txn", "cutoff"]),
    isReadOnly: true,
  }),
  getTransactionRelationshipContext: Object.freeze({
    name: "getTransactionRelationshipContext",
    description: "Expands transaction to linked device profile, email domains, billing region, and case-derived known cards.",
    permittedPhases: Object.freeze<readonly InvestigationPhase[]>(["initial_fact_gathering", "relationship_expansion"]),
    requiredParameters: Object.freeze(["txn", "cutoff"]),
    isReadOnly: true,
  }),
  findRelatedCases: Object.freeze({
    name: "findRelatedCases",
    description: "Retrieves historically eligible closed cases (closed before cutoff), prior fraud patterns, and known cards.",
    permittedPhases: Object.freeze<readonly InvestigationPhase[]>(["relationship_expansion", "historical_retrospective", "hypothesis_evaluation"]),
    requiredParameters: Object.freeze(["txn", "cutoff"]),
    isReadOnly: true,
  }),
  getGraphValidationCounts: Object.freeze({
    name: "getGraphValidationCounts",
    description: "Diagnostic query returning exact vertex and edge aggregate counts across the graph.",
    permittedPhases: Object.freeze<readonly InvestigationPhase[]>(["triage"]),
    requiredParameters: Object.freeze([]),
    isReadOnly: true,
  }),
});



export class ToolRegistryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

export interface ToolExecutionRequest {
  readonly toolName: string;
  readonly parameters: {
    readonly txn?: string;
    readonly cutoff?: string;
  };
  readonly currentPhase: InvestigationPhase;
  readonly investigationCutoff: string;
}

export interface ToolExecutionResult {
  readonly toolName: TigerGraphReadTool;
  readonly rawResults: unknown;
  readonly executedAt: string;
  readonly provenance: {
    readonly requestId: string;
    readonly cutoff?: string;
  };
}

export function validateToolInvocationRequest(request: ToolExecutionRequest): ToolDefinition {
  const tool = CONTROLLED_TOOL_REGISTRY[request.toolName as TigerGraphReadTool];
  if (!tool) {
    throw new ToolRegistryError(
      `Unregistered tool execution attempt: '${request.toolName}'. Only allowlisted controlled tools may be executed.`
    );
  }

  if (!tool.permittedPhases.includes(request.currentPhase)) {
    throw new ToolRegistryError(
      `Tool '${tool.name}' is not permitted in investigation phase '${request.currentPhase}' (permitted: ${tool.permittedPhases.join(", ")})`
    );
  }

  // Validate parameters and temporal constraints
  if (tool.name !== "getGraphValidationCounts") {
    if (!request.parameters.txn || !request.parameters.cutoff) {
      throw new ToolRegistryError(`Tool '${tool.name}' requires parameters: txn, cutoff`);
    }

    // Must match investigation cutoff (cannot query future data)
    if (request.parameters.cutoff !== request.investigationCutoff) {
      throw new ToolRegistryError(
        `Temporal guard violation: Tool parameter cutoff (${request.parameters.cutoff}) must match immutable investigationCutoff (${request.investigationCutoff})`
      );
    }

    validateTransactionReadInput({
      txn: request.parameters.txn,
      cutoff: request.parameters.cutoff,
    });
  }

  return tool;
}
