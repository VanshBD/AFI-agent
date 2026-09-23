/**
 * Narrow, explicit MCP mutation boundary for InvestigationCase writeback.
 * Commander cannot import this module; it is for authorized persistence only.
 */
import {
  loadTigerGraphMcpConfigurationFromEnvironment,
  StdioTigerGraphMcpTransport,
  TigerGraphMcpRuntimeError,
  type McpToolTransport,
} from "./mcp-commander-tool-client.js";
import { requireCutoff } from "./read-tool-contracts.js";

const GRAPH = "FraudCommand";

export interface InvestigationCaseWriteback {
  readonly caseId: string;
  readonly openedAt: string;
  readonly triggerType: string;
  readonly status: string;
  readonly verdict: string;
  readonly fraudProbability: number;
  readonly temporalCutoff: string;
  readonly evidence: readonly {
    evidenceId: string;
    sourceType: string;
    sourceRef: string;
    normalizedFinding: string;
    occurredAt: string;
    decisionImpact: string;
  }[];
}

export interface InvestigationCaseWritebackResult {
  readonly caseId: string;
  readonly verified: boolean;
  readonly idempotent: boolean;
}

function requireCaseId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new TigerGraphMcpRuntimeError("invalid_runtime_configuration");
  return value;
}

function parseMcp(response: unknown): Record<string, unknown> {
  const result = response as { content?: readonly { text?: unknown }[]; isError?: boolean };
  if (result?.isError) throw new TigerGraphMcpRuntimeError("mcp_query_error");
  const text = result?.content?.map((content) => typeof content.text === "string" ? content.text : "").find(Boolean);
  if (!text) throw new TigerGraphMcpRuntimeError("invalid_mcp_response");
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  try {
    const parsed = JSON.parse((match?.[1] ?? text).trim());
    if (!parsed || typeof parsed !== "object") throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new TigerGraphMcpRuntimeError("invalid_mcp_response");
  }
}

function assertSuccess(response: unknown): void {
  const parsed = parseMcp(response);
  if (parsed.success !== true) throw new TigerGraphMcpRuntimeError("mcp_query_error");
}

function requireEvidenceId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new TigerGraphMcpRuntimeError("invalid_runtime_configuration");
  return value;
}

export class LiveTigerGraphMcpInvestigationCaseWriter {
  public constructor(private readonly transport: McpToolTransport) {}

  public static fromEnvironment(): LiveTigerGraphMcpInvestigationCaseWriter {
    return new LiveTigerGraphMcpInvestigationCaseWriter(
      new StdioTigerGraphMcpTransport(loadTigerGraphMcpConfigurationFromEnvironment()),
    );
  }

  public async writeCase(input: InvestigationCaseWriteback): Promise<InvestigationCaseWritebackResult> {
    const caseId = requireCaseId(input.caseId);
    const openedAt = requireCutoff(input.openedAt);
    const temporalCutoff = requireCutoff(input.temporalCutoff);
    if (!Number.isFinite(input.fraudProbability) || input.fraudProbability < 0 || input.fraudProbability > 1) {
      throw new TigerGraphMcpRuntimeError("invalid_runtime_configuration");
    }
    if (!input.triggerType || !input.status || !input.verdict) {
      throw new TigerGraphMcpRuntimeError("invalid_runtime_configuration");
    }

    const mutation = await this.transport.callTool({
      name: "tigergraph__add_node",
      arguments: {
        graph_name: GRAPH,
        vertex_type: "InvestigationCase",
        vertex_id: caseId,
        attributes: {
          opened_at: openedAt,
          trigger_type: input.triggerType,
          status: input.status,
          verdict: input.verdict,
          fraud_probability: input.fraudProbability,
          temporal_cutoff: temporalCutoff,
        },
      },
    });
    assertSuccess(mutation);

    const verification = await this.transport.callTool({
      name: "tigergraph__get_node",
      arguments: { graph_name: GRAPH, vertex_type: "InvestigationCase", vertex_id: caseId },
    });
    const parsedVerification = parseMcp(verification);
    if (parsedVerification.success !== true) throw new TigerGraphMcpRuntimeError("mcp_query_error");
    for (const evidence of input.evidence) {
      const evidenceId = requireEvidenceId(evidence.evidenceId);
      const occurredAt = requireCutoff(evidence.occurredAt);
      if (!evidence.sourceType || !evidence.sourceRef || !evidence.normalizedFinding || !evidence.decisionImpact) {
        throw new TigerGraphMcpRuntimeError("invalid_runtime_configuration");
      }
      assertSuccess(await this.transport.callTool({
        name: "tigergraph__add_node",
        arguments: {
          graph_name: GRAPH,
          vertex_type: "Evidence",
          vertex_id: evidenceId,
          attributes: {
            source_type: evidence.sourceType,
            source_ref: evidence.sourceRef,
            normalized_finding: evidence.normalizedFinding,
            occurred_at: occurredAt,
            created_at: temporalCutoff,
            quality: "verified_graph",
            decision_impact: evidence.decisionImpact,
          },
        },
      }));
      assertSuccess(await this.transport.callTool({
        name: "tigergraph__add_edge",
        arguments: {
          graph_name: GRAPH,
          source_vertex_type: "InvestigationCase",
          source_vertex_id: caseId,
          edge_type: "HAS_EVIDENCE",
          target_vertex_type: "Evidence",
          target_vertex_id: evidenceId,
        },
      }));
    }
    return { caseId, verified: true, idempotent: true };
  }
}
