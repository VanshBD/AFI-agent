declare const process: { exit(code?: number): void };

import {
  LiveTigerGraphMcpCommanderToolClient,
  type McpToolCall,
  type McpToolTransport,
} from "../packages/tigergraph/src/mcp-commander-tool-client.js";

class RecordingTransport implements McpToolTransport {
  public calls: McpToolCall[] = [];
  public async callTool(call: McpToolCall): Promise<unknown> {
    this.calls.push(call);
    return {
      content: [{
        type: "text",
        text: "```json\n" + JSON.stringify({
          success: true,
          data: {
            query_name: call.arguments.query_name,
            parameters: call.arguments.params ?? {},
            result: [{ transaction: "3000001", card_profiles: [] }],
          },
          metadata: { graph_name: "FraudCommand", execution_mode: "installed" },
        }) + "\n```",
      }],
    };
  }
}

async function main(): Promise<void> {
  const transport = new RecordingTransport();
  const client = new LiveTigerGraphMcpCommanderToolClient(transport);
  const result = await client.executeTool(
    "getTransactionContext",
    { txn: "3000001", cutoff: "2016-07-02 00:02:22" },
    "mcp-test-1",
  ) as { results: readonly unknown[]; provenance: Record<string, unknown> };

  expect(transport.calls.length === 1, "one fixed MCP call expected");
  expect(JSON.stringify(transport.calls[0]) === JSON.stringify({
    name: "tigergraph__run_installed_query",
    arguments: {
      graph_name: "FraudCommand",
      query_name: "getTransactionContext",
      params: { txn: "3000001", cutoff: "2016-07-02 00:02:22" },
    },
  }), "only the allowlisted installed-query operation may be called");
  expect(result.results.length === 1, "normalized result expected");
  expect(result.provenance.source === "TigerGraph", "TigerGraph provenance expected");
  expect(result.provenance.temporalEligibility === "query_enforced", "temporal provenance expected");

  let rejected = false;
  try {
    await client.executeTool("getTransactionContext", { txn: "bad id", cutoff: "2016-07-02 00:02:22" }, "mcp-test-2");
  } catch (error) {
    rejected = error instanceof Error && error.message === "invalid_transaction_id";
  }
  expect(rejected, "invalid input must be rejected");
  expect(transport.calls.length === 1, "invalid input must not invoke MCP");
  console.log("tigergraph MCP Commander client tests passed");
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
