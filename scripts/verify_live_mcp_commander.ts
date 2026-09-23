/** Application-level proof: InvestigationService → Commander → MCP → TigerGraph. */
declare const require: (moduleName: string) => any;
declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): void };
const fs = require("fs");
const path = require("path");

import { InvestigationService } from "../packages/domain/src/investigation-service.js";
import { LiveTigerGraphMcpCommanderToolClient } from "../packages/tigergraph/src/mcp-commander-tool-client.js";

function loadLocalEnvironment(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const service = new InvestigationService(LiveTigerGraphMcpCommanderToolClient.fromEnvironment());
  const result = await service.runFullInvestigation({
    caseId: "MCP-LIVE-COMMANDER-3000183",
    flaggedTxnId: "3000183",
    customerId: "C08945",
    cardId: "CP-unknown",
    cutoff: "2016-07-04 02:10:21",
    triggerText: "Controlled live MCP Commander integration validation",
  });
  const evidence = result.stepResults.flatMap((step) => step.newEvidence);
  if (!evidence.length) throw new Error("commander_produced_no_live_evidence");
  if (!evidence.every((e) => e.sourceType === "tigergraph_tool")) throw new Error("non_graph_evidence_in_live_validation");
  console.log(JSON.stringify({
    mode: "LIVE",
    status: "PASS",
    evidenceCount: evidence.length,
    tools: result.state.toolCallIds,
    action: result.state.nextBestAction?.actionType,
  }));
}

main().catch((error: Error) => {
  console.error(JSON.stringify({ mode: "LIVE", status: "FAIL", error: error.message }));
  process.exit(1);
});
