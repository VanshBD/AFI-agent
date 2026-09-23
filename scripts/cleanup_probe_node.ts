declare const require: (moduleName: string) => any;
declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): void };
const fs = require("fs");
const path = require("path");
import { StdioTigerGraphMcpTransport, loadTigerGraphMcpConfigurationFromEnvironment } from "../packages/tigergraph/src/mcp-commander-tool-client.js";

function loadEnv(): void {
  const p = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(p)) return;
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

async function main(): Promise<void> {
  loadEnv();
  const transport = new StdioTigerGraphMcpTransport(loadTigerGraphMcpConfigurationFromEnvironment());
  console.log("Cleaning up probe node MCP_CONTROLLED_PROBE_001...");
  try {
    const delRes = await transport.callTool({
      name: "tigergraph__delete_node",
      arguments: {
        graph_name: "FraudCommand",
        vertex_type: "InvestigationCase",
        vertex_id: "MCP_CONTROLLED_PROBE_001",
      },
    });
    console.log("Delete result:", JSON.stringify(delRes));
  } catch (err: any) {
    console.log("Delete error:", err.message);
  }

  console.log("Verifying node deletion via tigergraph__get_node...");
  try {
    const getRes = await transport.callTool({
      name: "tigergraph__get_node",
      arguments: {
        graph_name: "FraudCommand",
        vertex_type: "InvestigationCase",
        vertex_id: "MCP_CONTROLLED_PROBE_001",
      },
    });
    console.log("Get result (should indicate not found or empty):", JSON.stringify(getRes));
  } catch (err: any) {
    console.log("Get result error (expected if deleted):", err.message);
  }
}

main().catch((err: Error) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
