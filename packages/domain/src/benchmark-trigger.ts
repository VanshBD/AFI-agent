export type TriggerType = "risk_score" | "customer_report" | "analyst_request";

export interface BenchmarkTrigger {
  readonly caseId: string;
  readonly openedAt: Date;
  readonly triggerType: TriggerType;
  readonly triggerText: string;
  readonly flaggedTransactionId: string;
  readonly cardId: string;
  readonly customerId: string;
  readonly riskScore?: number;
}

export function validateBenchmarkTrigger(trigger: BenchmarkTrigger): void {
  if (!/^HHG-\d{3}$/.test(trigger.caseId)) throw new Error("Invalid benchmark case ID");
  if (!trigger.triggerText.trim()) throw new Error("Trigger text is required");
  if (!trigger.flaggedTransactionId.trim()) throw new Error("Flagged transaction ID is required");
  if (!trigger.cardId.trim() || !trigger.customerId.trim()) throw new Error("Card and customer IDs are required");
  if (Number.isNaN(trigger.openedAt.getTime())) throw new Error("Opened timestamp is invalid");
  if (trigger.riskScore !== undefined && (trigger.riskScore < 0 || trigger.riskScore > 1)) {
    throw new Error("Risk score must be between 0 and 1");
  }
  if (trigger.triggerType === "risk_score" && trigger.riskScore === undefined) {
    throw new Error("Risk-score trigger requires a risk score");
  }
}
