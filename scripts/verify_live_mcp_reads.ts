/** Controlled live-read verification for the staged FraudCommand fixtures. */
declare const require: (moduleName: string) => any;
declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): void };

const fs = require("fs");
const path = require("path");

import { LiveTigerGraphMcpCommanderToolClient } from "../packages/tigergraph/src/mcp-commander-tool-client.js";

function loadLocalEnvironment(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

function first(result: unknown): Record<string, unknown> {
  const parsed = result as { results?: readonly Record<string, unknown>[] };
  if (!parsed.results?.[0]) throw new Error("live_query_returned_no_result");
  return parsed.results[0];
}

function count(result: Record<string, unknown>, key: string): number {
  const value = result[key];
  return Array.isArray(value) ? value.length : 0;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const client = LiveTigerGraphMcpCommanderToolClient.fromEnvironment();
  const observations: Record<string, unknown> = {};

  const after = first(await client.executeTool("getTransactionContext", { txn: "3000001", cutoff: "2016-07-02 00:02:22" }, "live-mcp-after"));
  requireCondition(after.transaction === "3000001", "eligible_transaction_context_missing");
  observations.transactionAfterCutoff = "PASS";

  const before = first(await client.executeTool("getTransactionContext", { txn: "3000001", cutoff: "2016-07-02 00:02:20" }, "live-mcp-before"));
  requireCondition(before.status === "future_transaction", "future_transaction_was_not_denied");
  observations.transactionBeforeCutoff = "PASS";

  const preClosure = first(await client.executeTool("getTransactionRelationshipContext", { txn: "3000120", cutoff: "2016-07-02 01:17:27" }, "live-mcp-preclosure"));
  requireCondition(count(preClosure, "known_cards") === 0, "future_known_card_was_exposed");
  observations.preClosureKnownCard = "EXCLUDED";

  const eligible = first(await client.executeTool("getTransactionRelationshipContext", { txn: "3000183", cutoff: "2016-07-04 02:10:21" }, "live-mcp-eligible"));
  requireCondition(count(eligible, "billing_regions") > 0, "eligible_billing_region_missing");
  requireCondition(count(eligible, "known_cards") > 0, "eligible_known_card_missing");
  observations.eligibleKnownCard = "VISIBLE";
  observations.eligibleBillingRegion = "VISIBLE";

  console.log(JSON.stringify({ mode: "LIVE", status: "PASS", observations }, null, 2));
}

main().catch((error: Error) => {
  console.error(JSON.stringify({ mode: "LIVE", status: "FAIL", error: error.message }));
  process.exit(1);
});
