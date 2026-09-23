/**
 * Typed, allowlisted TigerGraph MCP adapter for the Commander runtime.
 *
 * This module deliberately exposes installed query execution only. It never
 * accepts GSQL text and never exposes MCP administrative or mutation tools to
 * Commander. Secrets remain only in the child process environment.
 */

declare const require: (moduleName: string) => any;
declare const process: { env: Record<string, string | undefined> };

const { spawn } = require("child_process");

import type { CommanderToolClient } from "../../domain/src/commander.js";
import {
  createReadToolInvocation,
  TigerGraphReadContractError,
  type TigerGraphReadTool,
  type TransactionReadInput,
} from "./read-tool-contracts.js";

const MCP_RUN_INSTALLED_QUERY = "tigergraph__run_installed_query";
const FIXED_GRAPH_NAME = "FraudCommand";
const QUERY_ALLOWLIST = new Set<TigerGraphReadTool>([
  "getTransactionContext",
  "getGraphValidationCounts",
  "getTransactionRelationshipContext",
  "findRelatedCases",
]);

export interface TigerGraphMcpConfiguration {
  readonly host: string;
  readonly secret: string;
  readonly graphName: "FraudCommand";
  readonly timeoutMs: number;
}

export interface McpToolCall {
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export interface McpToolTransport {
  callTool(call: McpToolCall): Promise<unknown>;
}

export class TigerGraphMcpRuntimeError extends Error {
  public constructor(
    public readonly code:
      | "mcp_unavailable"
      | "mcp_timeout"
      | "mcp_protocol_error"
      | "mcp_query_error"
      | "invalid_mcp_response"
      | "invalid_runtime_configuration",
  ) {
    super(code);
    this.name = "TigerGraphMcpRuntimeError";
  }
}

function requireEnvironment(name: "TG_HOST" | "TG_SECRET" | "TG_GRAPHNAME"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TigerGraphMcpRuntimeError("invalid_runtime_configuration");
  return value;
}

/** Reads only server-side process environment; it does not load or log `.env`. */
export function loadTigerGraphMcpConfigurationFromEnvironment(): TigerGraphMcpConfiguration {
  const host = requireEnvironment("TG_HOST");
  const secret = requireEnvironment("TG_SECRET");
  const graphName = requireEnvironment("TG_GRAPHNAME");
  if (!/^https:\/\//i.test(host) || graphName !== FIXED_GRAPH_NAME) {
    throw new TigerGraphMcpRuntimeError("invalid_runtime_configuration");
  }
  const timeoutMs = process.env.TG_TIMEOUT_MS ? parseInt(process.env.TG_TIMEOUT_MS, 10) : 45_000;
  return { host, secret, graphName: FIXED_GRAPH_NAME, timeoutMs };
}

function parseJsonText(text: string): unknown {
  const candidates = [text];
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // MCP servers may include prose after a fenced structured response.
    }
  }
  throw new TigerGraphMcpRuntimeError("invalid_mcp_response");
}

function unwrapMcpContent(response: unknown): unknown {
  if (!response || typeof response !== "object") throw new TigerGraphMcpRuntimeError("invalid_mcp_response");
  const result = response as { content?: readonly { text?: unknown }[]; isError?: boolean };
  if (result.isError) throw new TigerGraphMcpRuntimeError("mcp_query_error");
  const text = result.content?.map((item) => (typeof item.text === "string" ? item.text : "")).find(Boolean);
  if (!text) throw new TigerGraphMcpRuntimeError("invalid_mcp_response");
  return parseJsonText(text);
}

function normalizeInstalledQueryResponse(response: unknown): { error: boolean; message: string; results: readonly Record<string, unknown>[]; provenance: Record<string, unknown> } {
  const parsed = unwrapMcpContent(response) as {
    success?: unknown;
    message?: unknown;
    data?: { result?: unknown; query_name?: unknown; parameters?: unknown };
    metadata?: unknown;
  };
  if (parsed.success !== true || !Array.isArray(parsed.data?.result)) {
    throw new TigerGraphMcpRuntimeError("mcp_query_error");
  }
  const results = parsed.data.result;
  if (!results.every((result) => result !== null && typeof result === "object" && !Array.isArray(result))) {
    throw new TigerGraphMcpRuntimeError("invalid_mcp_response");
  }
  return {
    error: false,
    message: typeof parsed.message === "string" ? parsed.message : "",
    results: results as readonly Record<string, unknown>[],
    provenance: {
      source: "TigerGraph",
      mcpTool: MCP_RUN_INSTALLED_QUERY,
      graph: FIXED_GRAPH_NAME,
      query: parsed.data.query_name,
      parameters: parsed.data.parameters,
      metadata: parsed.metadata,
    },
  };
}

/**
 * Minimal JSON-RPC/stdio transport. A fresh MCP process per request avoids
 * session state crossing investigations and makes timeout cleanup explicit.
 */
export class StdioTigerGraphMcpTransport implements McpToolTransport {
  public constructor(private readonly config: TigerGraphMcpConfiguration) {}

  public callTool(call: McpToolCall): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn("uvx", ["tigergraph-mcp"], {
        env: {
          ...process.env,
          TG_HOST: this.config.host,
          TG_SECRET: this.config.secret,
          TG_GRAPHNAME: this.config.graphName,
        },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      let completed = false;
      let buffer = "";
      const finish = (error?: Error, value?: unknown) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        child.kill();
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => finish(new TigerGraphMcpRuntimeError("mcp_timeout")), this.config.timeoutMs);

      child.on("error", () => finish(new TigerGraphMcpRuntimeError("mcp_unavailable")));
      child.stdout.on("data", (chunk: { toString(): string }) => {
        buffer += chunk.toString();
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let message: { id?: number; result?: unknown; error?: unknown };
          try { message = JSON.parse(line); } catch { continue; }
          if (message.id === 1) {
            if (message.error) return finish(new TigerGraphMcpRuntimeError("mcp_protocol_error"));
            child.stdin.write(`${JSON.stringify({
              jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: call.name, arguments: call.arguments },
            })}\n`);
          } else if (message.id === 2) {
            if (message.error) return finish(new TigerGraphMcpRuntimeError("mcp_query_error"));
            return finish(undefined, message.result);
          }
        }
      });
      child.stdin.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "fraud-command", version: "0.1.0" },
        },
      })}\n`);
    });
  }
}

/** Commander-facing client: fixed installed query names, validated data only. */
export class LiveTigerGraphMcpCommanderToolClient implements CommanderToolClient {
  public constructor(private readonly transport: McpToolTransport) {}

  public static fromEnvironment(): LiveTigerGraphMcpCommanderToolClient {
    const config = loadTigerGraphMcpConfigurationFromEnvironment();
    return new LiveTigerGraphMcpCommanderToolClient(new StdioTigerGraphMcpTransport(config));
  }

  public async executeTool(
    toolName: TigerGraphReadTool,
    params: { txn?: string; cutoff?: string },
    requestId: string,
  ): Promise<unknown> {
    if (!QUERY_ALLOWLIST.has(toolName)) throw new TigerGraphReadContractError("unallowlisted_read_tool");
    const input = toolName === "getGraphValidationCounts"
      ? undefined
      : { txn: params.txn ?? "", cutoff: params.cutoff ?? "" } satisfies TransactionReadInput;
    const invocation = createReadToolInvocation(toolName, requestId, input);
    const startedAt = Date.now();
    const response = await this.transport.callTool({
      name: MCP_RUN_INSTALLED_QUERY,
      arguments: {
        graph_name: FIXED_GRAPH_NAME,
        query_name: invocation.tool,
        ...(invocation.input === undefined ? {} : { params: invocation.input }),
      },
    });
    const normalized = normalizeInstalledQueryResponse(response);
    return {
      ...normalized,
      provenance: {
        ...normalized.provenance,
        requestId: invocation.requestId,
        cutoff: invocation.input?.cutoff,
        temporalEligibility: "query_enforced",
        latencyMs: Date.now() - startedAt,
      },
    };
  }
}
