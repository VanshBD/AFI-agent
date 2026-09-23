import {
  TigerGraphReadContractError,
  createReadToolInvocation,
  createReadToolProvenance,
  requireCutoff,
  requireLimit,
  validateReadToolProvenance,
  validateTransactionReadInput,
} from "../packages/tigergraph/src/read-tool-contracts.js";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectContractError(action: () => unknown, expected: string): void {
  try {
    action();
  } catch (error) {
    expect(error instanceof TigerGraphReadContractError, "must reject with contract error");
    if (error instanceof TigerGraphReadContractError) {
      expect(error.message === expected, `expected ${expected}, got ${error.message}`);
    }
    return;
  }
  throw new Error(`expected ${expected}`);
}

const input = validateTransactionReadInput({ txn: "3000001", cutoff: "2016-07-02 00:02:22" });
expect(input.txn === "3000001", "valid transaction id retained");
expect(input.cutoff === "2016-07-02 00:02:22", "valid cutoff retained");
expectContractError(() => validateTransactionReadInput({ txn: "3000001; DROP", cutoff: "2016-07-02 00:02:22" }), "invalid_transaction_id");
expectContractError(() => requireCutoff("2016-07-02T00:02:22Z"), "malformed_cutoff");
expectContractError(() => requireCutoff("2016-02-30 00:02:22"), "malformed_cutoff");
expect(requireLimit(undefined) === 20, "default read limit is bounded");
expect(requireLimit(5) === 5, "valid read limit retained");
expectContractError(() => requireLimit(0), "invalid_limit");
expectContractError(() => requireLimit(21), "invalid_limit");
expectContractError(() => createReadToolInvocation("getGraphValidationCounts", "stage1.counts", input), "counts_tool_accepts_no_input");
expectContractError(() => createReadToolInvocation("findRelatedCases", "bad request id!", input), "invalid_request_id");
const related = createReadToolInvocation("findRelatedCases", "stage1.related.1", input);
expect(related.access === "read" && related.input !== undefined, "related-case invocation is read-only and typed");
const relatedProvenance = createReadToolProvenance(related);
expect(relatedProvenance.cutoff === input.cutoff, "temporal read provenance retains the cutoff");
validateReadToolProvenance(related, relatedProvenance);
expectContractError(
  () => validateReadToolProvenance(related, { ...relatedProvenance, requestId: "other" }),
  "invalid_read_provenance",
);
const counts = createReadToolInvocation("getGraphValidationCounts", "stage1.counts.1");
expect(counts.access === "read" && counts.input === undefined, "count invocation is bounded to fixed no-input query");
expect(createReadToolProvenance(counts).cutoff === undefined, "aggregate provenance has no synthetic cutoff");
console.log("tigergraph read-tool contract tests passed");
