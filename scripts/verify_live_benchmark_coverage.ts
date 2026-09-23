/** Live, read-only 20-case graph-coverage matrix. */
declare const require: (moduleName: string) => any;
declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): void };
const fs = require("fs");
const path = require("path");

import { LiveTigerGraphMcpCommanderToolClient } from "../packages/tigergraph/src/mcp-commander-tool-client.js";

interface CaseInput { caseId: string; cutoff: string; transactionId: string; customerId: string; cardId: string; }
interface CoverageRow extends CaseInput {
  readonly transactionContext: "present" | "missing";
  readonly cardProfileCount: number;
  readonly deviceProfileCount: number;
  readonly purchaserEmailDomainCount: number;
  readonly recipientEmailDomainCount: number;
  readonly billingRegionCount: number;
  readonly eligibleClosedCaseCount: number;
  readonly knownCardCount: number;
  readonly errors: readonly string[];
}

function loadLocalEnvironment(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

function parseCases(): CaseInput[] {
  const lines = fs.readFileSync(path.resolve(process.cwd(), "HHGOA_IEEE/case_pack.csv"), "utf8").trim().split(/\r?\n/).slice(1);
  return lines.map((line: string) => {
    const fields: string[] = []; let quoted = false; let current = "";
    for (const char of line) { if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { fields.push(current); current = ""; } else current += char; }
    fields.push(current);
    return { caseId: fields[0], cutoff: fields[1], transactionId: fields[4], cardId: fields[5], customerId: fields[6] };
  });
}

function count(result: Record<string, unknown>, key: string): number { return Array.isArray(result[key]) ? result[key].length : 0; }

async function verify(input: CaseInput): Promise<CoverageRow> {
  const client = LiveTigerGraphMcpCommanderToolClient.fromEnvironment();
  const errors: string[] = [];
  let context: Record<string, unknown> = {};
  let relationships: Record<string, unknown> = {};
  try { context = ((await client.executeTool("getTransactionContext", { txn: input.transactionId, cutoff: input.cutoff }, `coverage-context-${input.caseId}`)) as { results: Record<string, unknown>[] }).results[0] ?? {}; }
  catch (error) { errors.push(error instanceof Error ? error.message : "context_failure"); }
  try { relationships = ((await client.executeTool("getTransactionRelationshipContext", { txn: input.transactionId, cutoff: input.cutoff }, `coverage-relationships-${input.caseId}`)) as { results: Record<string, unknown>[] }).results[0] ?? {}; }
  catch (error) { errors.push(error instanceof Error ? error.message : "relationship_failure"); }
  return {
    ...input,
    transactionContext: context.transaction === input.transactionId ? "present" : "missing",
    cardProfileCount: count(context, "card_profiles"),
    deviceProfileCount: count(relationships, "device_profiles"),
    purchaserEmailDomainCount: count(relationships, "purchaser_email_domains"),
    recipientEmailDomainCount: count(relationships, "recipient_email_domains"),
    billingRegionCount: count(relationships, "billing_regions"),
    eligibleClosedCaseCount: count(relationships, "eligible_closed_cases"),
    knownCardCount: count(relationships, "known_cards"),
    errors,
  };
}

async function main(): Promise<void> {
  loadLocalEnvironment();
  const inputs = parseCases();
  const results: CoverageRow[] = [];
  // Bounded concurrency prevents burst-loading the Savanna workspace.
  for (let offset = 0; offset < inputs.length; offset += 2) results.push(...await Promise.all(inputs.slice(offset, offset + 2).map(verify)));
  const report = { mode: "LIVE", generatedAt: new Date().toISOString(), results, summary: { total: results.length, contextsAvailable: results.filter((row) => row.transactionContext === "present").length, queryErrors: results.reduce((total, row) => total + row.errors.length, 0) } };
  const output = path.resolve(process.cwd(), "artifacts/benchmark_coverage_ingestion/live_coverage.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  if (report.summary.contextsAvailable !== 20 || report.summary.queryErrors !== 0) throw new Error("live_benchmark_coverage_incomplete");
  console.log(JSON.stringify(report.summary));
}

main().catch((error: Error) => { console.error(error.message); process.exit(1); });
