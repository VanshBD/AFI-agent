/**
 * Single-case Live Investigation + Writeback + Idempotency Verification.
 * Case: 3000001 (HHG-001)
 */
declare const require: (moduleName: string) => any;
declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): void };
const fs = require("fs");
const path = require("path");
import { LiveTigerGraphMcpCommanderToolClient } from "../packages/tigergraph/src/mcp-commander-tool-client.js";
import { LiveTigerGraphMcpInvestigationCaseWriter } from "../packages/tigergraph/src/mcp-investigation-writeback.js";
import { InvestigationService } from "../packages/domain/src/investigation-service.js";
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
  const writer = LiveTigerGraphMcpInvestigationCaseWriter.fromEnvironment();
  const toolClient = LiveTigerGraphMcpCommanderToolClient.fromEnvironment();
  const service = new InvestigationService(toolClient);

  console.log("=== STEP 1: Running Live Investigation on Case HHG-001 ===");
  const run = await service.runFullInvestigation({
    caseId: "HHG-001",
    flaggedTxnId: "3000001",
    customerId: "cust-001",
    cardId: "card-001",
    cutoff: "2016-07-02 00:02:22",
    riskScore: 0.12,
    triggerText: "Statistical outlier risk evaluation",
  });

  const evidence = run.stepResults.flatMap((s) => s.newEvidence);
  console.log(`Live investigation generated ${evidence.length} evidence items.`);
  const graphCaseId = "CASE-HHG-001";

  const casePayload = {
    caseId: graphCaseId,
    openedAt: "2016-07-02 00:02:22",
    triggerType: "rule_alert",
    status: "closed_legitimate",
    verdict: "legitimate",
    fraudProbability: 0.12,
    temporalCutoff: "2016-07-02 00:02:22",
    evidence: evidence.map((item) => ({
      evidenceId: `EVID-HHG-001-${item.evidenceId.replace(/^ev-/, "")}`,
      sourceType: "tigergraph_tool",
      sourceRef: item.provenance.queryOrSourceRef,
      normalizedFinding: item.observation,
      occurredAt: "2016-07-02 00:02:22",
      decisionImpact: item.decisionImpact,
    })),
  };

  console.log("=== STEP 2: First Writeback Run ===");
  const write1 = await writer.writeCase(casePayload);
  console.log("Write 1 result:", JSON.stringify(write1));

  // Count edges after Run 1
  const edgesAfterRun1Res: any = await transport.callTool({
    name: "tigergraph__get_node_edges",
    arguments: {
      graph_name: "FraudCommand",
      vertex_type: "InvestigationCase",
      vertex_id: graphCaseId,
      edge_type: "HAS_EVIDENCE",
      limit: 50,
    },
  });
  const edges1 = JSON.parse(edgesAfterRun1Res.content[0].text.match(/```json\s*([\s\S]*?)```/)?.[1] ?? "{}");
  const count1 = edges1.data?.edges?.length ?? 0;
  console.log(`Run 1 HAS_EVIDENCE edge count: ${count1}`);

  console.log("=== STEP 3: Second Identical Writeback Run (Idempotency Proof) ===");
  const write2 = await writer.writeCase(casePayload);
  console.log("Write 2 result:", JSON.stringify(write2));

  // Count edges after Run 2
  const edgesAfterRun2Res: any = await transport.callTool({
    name: "tigergraph__get_node_edges",
    arguments: {
      graph_name: "FraudCommand",
      vertex_type: "InvestigationCase",
      vertex_id: graphCaseId,
      edge_type: "HAS_EVIDENCE",
      limit: 50,
    },
  });
  const edges2 = JSON.parse(edgesAfterRun2Res.content[0].text.match(/```json\s*([\s\S]*?)```/)?.[1] ?? "{}");
  const count2 = edges2.data?.edges?.length ?? 0;
  console.log(`Run 2 HAS_EVIDENCE edge count: ${count2}`);

  console.log("=== VERIFICATION SUMMARY ===");
  console.log(`Initial edge count: ${count1}`);
  console.log(`Repeat edge count:  ${count2}`);
  if (count1 === count2 && count1 > 0) {
    console.log("IDEMPOTENCY: PASS (Zero duplicate edges/vertices created on repeat run)");
  } else {
    console.error("IDEMPOTENCY: FAIL (Edge count mismatch)");
    process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error("Test failed:", err);
  process.exit(1);
});
