export interface InvestigationCutoff {
  readonly caseId: string;
  readonly openedAt: Date;
}

export interface HistoricalCaseTiming {
  readonly caseId: string;
  readonly closedAt: Date;
}

export class TemporalLeakageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TemporalLeakageError";
  }
}

/** True only when an event was available when the investigation opened. */
export function isEventAvailableAtCutoff(eventAt: Date, cutoff: InvestigationCutoff): boolean {
  return eventAt.getTime() <= cutoff.openedAt.getTime();
}

/** Historical labels and notes are memory only after the case has closed. */
export function isHistoricalCaseEligible(
  historicalCase: HistoricalCaseTiming,
  cutoff: InvestigationCutoff,
): boolean {
  return historicalCase.closedAt.getTime() < cutoff.openedAt.getTime();
}

export function requireEventAvailableAtCutoff(
  eventAt: Date,
  cutoff: InvestigationCutoff,
  reference: string,
): void {
  if (!isEventAvailableAtCutoff(eventAt, cutoff)) {
    throw new TemporalLeakageError(
      `${reference} occurred after investigation cutoff for ${cutoff.caseId}`,
    );
  }
}

export function requireHistoricalCaseEligible(
  historicalCase: HistoricalCaseTiming,
  cutoff: InvestigationCutoff,
): void {
  if (!isHistoricalCaseEligible(historicalCase, cutoff)) {
    throw new TemporalLeakageError(
      `Historical case ${historicalCase.caseId} closed on or after investigation cutoff for ${cutoff.caseId}`,
    );
  }
}
