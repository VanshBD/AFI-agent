export type TigerGraphReadTool =
  | "getTransactionContext"
  | "getGraphValidationCounts"
  | "getTransactionRelationshipContext"
  | "findRelatedCases";


export interface TransactionReadInput {
  readonly txn: string;
  readonly cutoff: string;
}

export interface ReadToolInvocation<TInput> {
  readonly tool: TigerGraphReadTool;
  readonly requestId: string;
  readonly input: TInput;
  readonly access: "read";
}

export interface ReadToolProvenance {
  readonly tool: TigerGraphReadTool;
  readonly graph: "FraudCommand";
  readonly cutoff?: string;
  readonly requestId: string;
}

/**
 * Canonical provenance added by the application adapter after a fixed query
 * returns. It intentionally contains query identity, not query text, tokens,
 * or connection details.
 */
export function createReadToolProvenance(
  invocation: ReadToolInvocation<TransactionReadInput | undefined>,
): ReadToolProvenance {
  return {
    tool: invocation.tool,
    graph: "FraudCommand",
    requestId: invocation.requestId,
    ...(invocation.input === undefined ? {} : { cutoff: invocation.input.cutoff }),
  };
}

/** Rejects output that claims a different fixed tool, graph, or request. */
export function validateReadToolProvenance(
  expected: ReadToolInvocation<TransactionReadInput | undefined>,
  provenance: ReadToolProvenance,
): ReadToolProvenance {
  if (
    provenance.tool !== expected.tool ||
    provenance.graph !== "FraudCommand" ||
    provenance.requestId !== expected.requestId ||
    provenance.cutoff !== expected.input?.cutoff
  ) {
    throw new TigerGraphReadContractError("invalid_read_provenance");
  }
  return provenance;
}

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SQL_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export class TigerGraphReadContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "TigerGraphReadContractError";
  }
}

function requireIdentifier(value: string, field: string): string {
  if (!IDENTIFIER.test(value)) throw new TigerGraphReadContractError(`invalid_${field}`);
  return value;
}

export function requireRequestId(requestId: string): string {
  if (!REQUEST_ID.test(requestId)) throw new TigerGraphReadContractError("invalid_request_id");
  return requestId;
}

/** Enforces the GSQL DATETIME wire format and rejects nonexistent calendar values. */
export function requireCutoff(cutoff: string): string {
  if (!SQL_DATETIME.test(cutoff)) throw new TigerGraphReadContractError("malformed_cutoff");
  const parsed = new Date(`${cutoff.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 19).replace("T", " ") !== cutoff) {
    throw new TigerGraphReadContractError("malformed_cutoff");
  }
  return cutoff;
}

export function requireLimit(limit: number | undefined, maximum = 20): number {
  const value = limit ?? maximum;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new TigerGraphReadContractError("invalid_limit");
  }
  return value;
}

export function validateTransactionReadInput(input: TransactionReadInput): TransactionReadInput {
  return { txn: requireIdentifier(input.txn, "transaction_id"), cutoff: requireCutoff(input.cutoff) };
}

export function createReadToolInvocation(
  tool: TigerGraphReadTool,
  requestId: string,
  input?: TransactionReadInput,
): ReadToolInvocation<TransactionReadInput | undefined> {
  requireRequestId(requestId);
  if (tool === "getGraphValidationCounts") {
    if (input !== undefined) throw new TigerGraphReadContractError("counts_tool_accepts_no_input");
    return { tool, requestId, input, access: "read" };
  }
  if (input === undefined) throw new TigerGraphReadContractError("missing_transaction_read_input");
  return { tool, requestId, input: validateTransactionReadInput(input), access: "read" };
}
