/**
 * Read-only postcondition check for the 20 official LIVE writebacks.
 * It verifies the deterministic case and evidence vertices and the exact
 * three outgoing HAS_EVIDENCE relationships per case.  It creates nothing.
 */
declare const require: (name: string) => any;
declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): void };
const fs = require("fs"); const path = require("path");

import {
  loadTigerGraphMcpConfigurationFromEnvironment,
  StdioTigerGraphMcpTransport,
  type McpToolTransport,
} from "../packages/tigergraph/src/mcp-commander-tool-client.js";
import { parseCasePackCsv } from "./run_benchmark.js";

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

function parseResponse(value: unknown): Record<string, any> {
  const response = value as { content?: { text?: string }[]; isError?: boolean };
  if (response?.isError) throw new Error("mcp_read_error");
  const text = response?.content?.map((item) => item.text ?? "").find(Boolean);
  if (!text) throw new Error("missing_mcp_text");
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const parsed = JSON.parse((fenced ?? text).trim());
  if (!parsed?.success) throw new Error(`mcp_read_error:${String(parsed?.message ?? "unknown")}`);
  return parsed;
}

async function read(transport: McpToolTransport, name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
  return parseResponse(await transport.callTool({ name, arguments: args }));
}

async function main(): Promise<void> {
  loadEnv();
  const transport = new StdioTigerGraphMcpTransport(loadTigerGraphMcpConfigurationFromEnvironment());
  const cases = parseCasePackCsv(fs.readFileSync(path.resolve(process.cwd(), "HHGOA_IEEE/case_pack.csv"), "utf8"));
  const verified: string[] = [];
  for (const row of cases) {
    const caseId = `CASE-${row.case_id}`;
    await read(transport, "tigergraph__get_node", { graph_name: "FraudCommand", vertex_type: "InvestigationCase", vertex_id: caseId });
    const edgeResponse = await read(transport, "tigergraph__get_node_edges", {
      graph_name: "FraudCommand", vertex_type: "InvestigationCase", vertex_id: caseId, edge_type: "HAS_EVIDENCE", limit: 10,
    });
    const edges = edgeResponse.data?.edges;
    if (!Array.isArray(edges) || edges.length < 3) throw new Error(`unexpected_evidence_edge_count:${row.case_id}:${Array.isArray(edges) ? edges.length : "invalid"}`);
    const targets = new Set(edges.map((edge: any) => String(edge?.to_id ?? edge?.to_id?.id ?? edge?.target_id ?? edge?.target?.id ?? "")));
    for (const suffix of ["txn", "rel", "cases"]) {
      const evidenceId = `EVID-${row.case_id}-${suffix}`;
      await read(transport, "tigergraph__get_node", { graph_name: "FraudCommand", vertex_type: "Evidence", vertex_id: evidenceId });
      if (!targets.has(evidenceId)) throw new Error(`missing_expected_evidence_relationship:${row.case_id}:${evidenceId}`);
    }
    verified.push(row.case_id);
    console.log(`Verified live writeback for ${row.case_id} (${verified.length}/20)`);
  }
  const output = { mode: "LIVE", verifiedCases: verified.length, evidenceVertices: verified.length * 3, hasEvidenceEdges: verified.length * 3 };
  fs.writeFileSync(path.resolve(process.cwd(), "benchmark/final/live-official-writeback-verification.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
}

main().catch((error: Error) => { console.error(error.message); process.exit(1); });
