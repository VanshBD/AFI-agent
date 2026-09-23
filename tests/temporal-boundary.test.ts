import {
  TemporalLeakageError,
  isEventAvailableAtCutoff,
  isHistoricalCaseEligible,
  requireEventAvailableAtCutoff,
  requireHistoricalCaseEligible,
} from "../packages/domain/src/temporal-boundary.js";
import { validateBenchmarkTrigger } from "../packages/domain/src/benchmark-trigger.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectThrows(action: () => void, message: string): void {
  try {
    action();
  } catch (error) {
    expect(error instanceof TemporalLeakageError, message);
    return;
  }
  throw new Error(message);
}

const cutoff = { caseId: "HHG-001", openedAt: new Date("2016-12-05T01:55:28Z") };
expect(isEventAvailableAtCutoff(new Date("2016-12-05T01:55:28Z"), cutoff), "Cutoff-time event must be available");
expect(!isEventAvailableAtCutoff(new Date("2016-12-05T01:55:29Z"), cutoff), "Future event must be rejected");
expect(isHistoricalCaseEligible({ caseId: "CC-1", closedAt: new Date("2016-12-05T01:55:27Z") }, cutoff), "Closed history must be eligible");
expect(!isHistoricalCaseEligible({ caseId: "CC-2", closedAt: new Date("2016-12-05T01:55:28Z") }, cutoff), "Case closed at cutoff must be ineligible");
expectThrows(() => requireEventAvailableAtCutoff(new Date("2016-12-06T00:00:00Z"), cutoff, "T-future"), "Future event must throw");
expectThrows(() => requireHistoricalCaseEligible({ caseId: "CC-future", closedAt: new Date("2016-12-06T00:00:00Z") }, cutoff), "Future case must throw");
validateBenchmarkTrigger({ caseId: "HHG-001", openedAt: cutoff.openedAt, triggerType: "risk_score", triggerText: "review", flaggedTransactionId: "3514030", cardId: "C12382-K1", customerId: "C12382", riskScore: 0.61 });
console.log("temporal-boundary tests passed");
