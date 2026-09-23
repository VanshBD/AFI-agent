/**
 * AFI Agentic Fraud Investigation — 20-Case Benchmark Runner
 * Evaluates the full pipeline across all 20 cases from case_pack.csv.
 * Performs deterministic baseline vs ablation runs without hardcoding answers.
 */

declare const require: any;
declare const process: {
  cwd: () => string;
  argv: readonly string[];
  env: Record<string, string | undefined>;
  exit: (code?: number) => void;
};
declare const module: unknown;

const fs = require("fs");
const path = require("path");

import {
  createInvestigationState,
  InvestigationState,
} from "../packages/domain/src/investigation-state.js";
import {
  createHypothesis,
  Hypothesis,
} from "../packages/domain/src/hypotheses.js";
import {
  CommanderOrchestrator,
  CommanderToolClient,
} from "../packages/domain/src/commander.js";
import { LiveTigerGraphMcpCommanderToolClient } from "../packages/tigergraph/src/mcp-commander-tool-client.js";
import { DeterministicMockCommanderToolClient } from "../packages/tigergraph/src/deterministic-commander-tool-client.js";

export type BenchmarkMode = "live" | "deterministic";

/** Server/CLI-only local config loader; values are never emitted in results. */
function loadLocalEnvironment(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

interface BenchmarkCaseRow {
  case_id: string;
  opened_at: string;
  trigger_type: string;
  trigger_text: string;
  flagged_txn_id: string;
  card_id: string;
  customer_id: string;
  risk_score?: number;
}

export interface BenchmarkCaseResult {
  readonly caseId: string;
  readonly transactionId: string;
  readonly cutoff: string;
  readonly triggerType: string;
  readonly riskScore?: number;
  readonly stepsExecuted: number;
  readonly toolsCalled: readonly string[];
  readonly totalEvidenceCollected: number;
  readonly terminalReason: string;
  readonly dominantPerspective: string;
  readonly contradictionsCount: number;
  readonly sensitivitiesCount: number;
  readonly recommendedAction: string;
  readonly authorizationLevel: string;
  readonly executionStatus: string;
  readonly latencyMs: number;
}

export function parseCasePackCsv(csvContent: string): BenchmarkCaseRow[] {
  const lines = csvContent.trim().split("\n");
  const header = lines[0].split(",");
  const rows: BenchmarkCaseRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle quoted fields
    const parts: string[] = [];
    let inQuote = false;
    let current = "";
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === '"') {
        inQuote = !inQuote;
      } else if (char === ',' && !inQuote) {
        parts.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    parts.push(current);

    if (parts.length >= 7) {
      rows.push({
        case_id: parts[0],
        opened_at: parts[1],
        trigger_type: parts[2],
        trigger_text: parts[3],
        flagged_txn_id: parts[4],
        card_id: parts[5],
        customer_id: parts[6],
        risk_score: parts[7] && parts[7].trim() ? parseFloat(parts[7]) : undefined,
      });
    }
  }

  return rows;
}

export class BenchmarkRunner {
  public async runCase(
    row: BenchmarkCaseRow,
    toolClient: CommanderToolClient
  ): Promise<BenchmarkCaseResult> {
    const startTime = Date.now();
    const commander = new CommanderOrchestrator(toolClient);

    let state = createInvestigationState({
      investigationId: `inv-${row.case_id}`,
      triggerId: row.case_id,
      flaggedTransactionId: row.flagged_txn_id,
      customerId: row.customer_id,
      cardId: row.card_id,
      investigationCutoff: row.opened_at,
      riskScore: row.risk_score,
      initialUnresolvedQuestions: [row.trigger_text],
    });

    let hypotheses: readonly Hypothesis[] = [
      createHypothesis({
        hypothesisId: `hyp-${row.case_id}-legit`,
        investigationId: state.investigationId,
        type: "legitimate_activity",
        title: "Legitimate Cardholder Activity",
        description: "Transaction authorized by legitimate customer",
        confidenceScore: 0.5,
        decisionRelevance: "Baseline benign hypothesis",
      }),
      createHypothesis({
        hypothesisId: `hyp-${row.case_id}-fraud`,
        investigationId: state.investigationId,
        type: "card_not_present",
        title: "Unauthorized Fraudulent Activity",
        description: "Compromise or unauthorized transaction",
        confidenceScore: row.risk_score ? (row.risk_score >= 0.7 ? 0.7 : 0.5) : 0.5,
        decisionRelevance: "Potential fraud requiring mitigation",
      }),
    ];

    let steps = 0;
    let lastStepResult: any = undefined;

    while (state.status !== "completed" && steps < 5) {
      steps++;
      const stepRes = await commander.executeInvestigationStep(
        state,
        `bench-req-${row.case_id}-${steps}`,
        hypotheses
      );
      state = stepRes.updatedState;
      hypotheses = stepRes.updatedHypotheses;
      lastStepResult = stepRes;

      if (stepRes.decision.action === "STOP") {
        break;
      }
    }

    return {
      caseId: row.case_id,
      transactionId: row.flagged_txn_id,
      cutoff: row.opened_at,
      triggerType: row.trigger_type,
      riskScore: row.risk_score,
      stepsExecuted: steps,
      toolsCalled: state.toolCallIds.map((t) => t.split(":")[0]),
      totalEvidenceCollected: state.evidenceIds.length,
      terminalReason: state.continuationDecision?.reasonCode ?? "completed",
      dominantPerspective: lastStepResult?.adversarialResult?.netAssessment.dominantPerspective ?? "balanced_uncertainty",
      contradictionsCount: state.contradictions.length,
      sensitivitiesCount: lastStepResult?.decisionSensitivities?.length ?? 0,
      recommendedAction: state.nextBestAction?.actionType ?? "escalate_to_human_analyst",
      authorizationLevel: state.nextBestAction?.approvalRequired ?? "L1",
      executionStatus: lastStepResult?.policyResult?.executionStatus ?? "pending_human_approval",
      latencyMs: Date.now() - startTime,
    };
  }

  public async runFullSuite(mode: BenchmarkMode, toolClient?: CommanderToolClient): Promise<BenchmarkCaseResult[]> {
    const csvPath = path.resolve(process.cwd(), "HHGOA_IEEE/case_pack.csv");
    const content = fs.readFileSync(csvPath, "utf-8");
    const cases = parseCasePackCsv(content);

    const selectedClient = toolClient ?? (mode === "live"
      ? LiveTigerGraphMcpCommanderToolClient.fromEnvironment()
      : new DeterministicMockCommanderToolClient());

    const results: BenchmarkCaseResult[] = [];
    for (const c of cases) {
      const res = await this.runCase(c, selectedClient);
      results.push(res);
    }
    return results;
  }
}

async function main() {
  const requestedMode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length);
  if (requestedMode !== "live" && requestedMode !== "deterministic") {
    throw new Error("Benchmark mode is required: --mode=live or --mode=deterministic");
  }
  if (requestedMode === "live") loadLocalEnvironment();
  const runner = new BenchmarkRunner();
  const results = await runner.runFullSuite(requestedMode);

  console.log(`\n============================================================`);
  console.log(`BENCHMARK EXECUTION SUMMARY (${requestedMode.toUpperCase()} MODE)`);
  console.log(`============================================================`);
  console.log(`Total Cases: ${results.length}`);
  console.log(`Action Breakdown:`);
  const actionCounts: Record<string, number> = {};
  const authCounts: Record<string, number> = {};
  for (const r of results) {
    actionCounts[r.recommendedAction] = (actionCounts[r.recommendedAction] ?? 0) + 1;
    authCounts[r.authorizationLevel] = (authCounts[r.authorizationLevel] ?? 0) + 1;
  }
  console.log(JSON.stringify(actionCounts, null, 2));
  console.log(`Authorization Routing Breakdown:`);
  console.log(JSON.stringify(authCounts, null, 2));
  console.log(`Average Latency: ${(results.reduce((acc, r) => acc + r.latencyMs, 0) / results.length).toFixed(2)} ms/case`);
  console.log(`============================================================\n`);

  // Ensure benchmark directory exists and write results
  const outDir = path.resolve(process.cwd(), "benchmark/final");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `results-${requestedMode}.json`), JSON.stringify({ mode: requestedMode, results }, null, 2), "utf-8");
  console.log(`Benchmark results successfully written to benchmark/final/results-${requestedMode}.json`);
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
