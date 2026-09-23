/** One controlled, deterministic InvestigationCase writeback and idempotency check. */
declare const require: (moduleName: string) => any;
declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): void };
const fs = require("fs");
const path = require("path");

import { LiveTigerGraphMcpInvestigationCaseWriter } from "../packages/tigergraph/src/mcp-investigation-writeback.js";

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
  const writer = LiveTigerGraphMcpInvestigationCaseWriter.fromEnvironment();
  const input = {
    caseId: "MCP_LIVE_VALIDATION_3000183",
    openedAt: "2016-07-04 02:10:21",
    triggerType: "integration_validation",
    status: "validated",
    verdict: "inconclusive",
    fraudProbability: 0,
    temporalCutoff: "2016-07-04 02:10:21",
    evidence: [],
  } as const;
  const first = await writer.writeCase(input);
  const second = await writer.writeCase(input);
  if (!first.verified || !second.verified || !second.idempotent) throw new Error("writeback_verification_failed");
  console.log(JSON.stringify({ mode: "LIVE", status: "PASS", caseId: input.caseId, idempotency: "PASS" }));
}

main().catch((error: Error) => {
  console.error(JSON.stringify({ mode: "LIVE", status: "FAIL", error: error.message }));
  process.exit(1);
});
