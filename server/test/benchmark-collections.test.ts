import assert from "node:assert/strict";
import test from "node:test";
import { aggregateScores, compareScores, scoreReceipt, type BenchmarkPrediction, type ReceiptLabel } from "../benchmark/scorer.js";
const prediction = (patch: Partial<BenchmarkPrediction>): BenchmarkPrediction => ({ supportedFields: ["taxLines", "receiptDiscounts", "charges"], ...patch });

test("wrong tax label cannot mask an independently regressed amount or rate", () => {
  const label: ReceiptLabel = { taxLines: [{ label: "HST", amount: 39, rate: "0.13" }] };
  const baseline = scoreReceipt(label, prediction({ taxLines: [{ label: "Tax", amount: 39, rate: "0.13" }] }));
  assert.equal(baseline.fields.taxLines.correct, 0);
  assert.equal(baseline.fields["taxLines.amount"].correct, 1);
  assert.equal(baseline.fields["taxLines.rate"].correct, 1);
  for (const [attribute, entry] of [
    ["amount", { label: "Tax", amount: 3900, rate: "0.13" }],
    ["rate", { label: "Tax", amount: 39, rate: "13" }],
  ] as const) {
    const candidate = scoreReceipt(label, prediction({ taxLines: [entry] }));
    assert.equal(candidate.fields.taxLines.correct, 0);
    const gate = compareScores(aggregateScores([baseline]), aggregateScores([candidate]));
    assert.equal(gate.status, "regression");
    assert.ok(gate.regressions.some((entry) => entry.field === `taxLines.${attribute}`));
  }
});

test("wrong discount and charge labels cannot mask amount or charge-stage regressions", () => {
  const label: ReceiptLabel = { receiptDiscounts: [{ label: "COUPON", amount: 100 }], charges: [{ label: "SERVICE", amount: 50, stage: "after-subtotal" }] };
  const baseline = scoreReceipt(label, prediction({ receiptDiscounts: [{ label: "wrong", amount: 100 }], charges: [{ label: "wrong", amount: 50, stage: "after-subtotal" }] }));
  const candidate = scoreReceipt(label, prediction({ receiptDiscounts: [{ label: "wrong", amount: 10000 }], charges: [{ label: "wrong", amount: 5000, stage: "before-subtotal" }] }));
  const gate = compareScores(aggregateScores([baseline]), aggregateScores([candidate]));
  assert.equal(gate.status, "regression");
  for (const field of ["receiptDiscounts.amount", "charges.amount", "charges.stage"]) assert.ok(gate.regressions.some((entry) => entry.field === field));
});

test("collection attributes share one reordered alignment and expose missing or extra rows", () => {
  const label: ReceiptLabel = { taxLines: [{ label: "GST", amount: 5, rate: "0.05" }, { label: "PST", amount: 8, rate: "0.08" }] };
  const reordered = scoreReceipt(label, prediction({ taxLines: [{ label: "PST", amount: 8, rate: "0.080" }, { label: "GST", amount: 5, rate: "0.050" }] }));
  for (const field of ["taxLines.label", "taxLines.amount", "taxLines.rate"] as const) assert.equal(reordered.fields[field].correct, 2);
  const missing = scoreReceipt(label, prediction({ taxLines: [{ label: "PST", amount: 8, rate: "0.08" }] }));
  assert.equal(missing.fields["taxLines.missing"].correct, 0);
  assert.deepEqual([missing.fields["taxLines.amount"].correct, missing.fields["taxLines.amount"].scored], [1, 2]);
  const extra = scoreReceipt(label, prediction({ taxLines: [{ label: "PST", amount: 8, rate: "0.08" }, { label: "GST", amount: 5, rate: "0.05" }, { label: "OTHER", amount: 9, rate: "0.09" }] }));
  assert.equal(extra.fields["taxLines.extra"].correct, 0);
  assert.deepEqual([extra.fields["taxLines.amount"].correct, extra.fields["taxLines.amount"].scored], [2, 3]);
});

test("collection attribute nulls stay unprinted while zero, support, and missing recordings stay separate", () => {
  const label: ReceiptLabel = { taxLines: [{ label: null, amount: 0, rate: null }] };
  const score = scoreReceipt(label, prediction({ taxLines: [{ label: "Tax", amount: 0, rate: "0" }] }));
  assert.equal(score.fields["taxLines.label"].unprinted, 1);
  assert.equal(score.fields["taxLines.rate"].unprinted, 1);
  assert.equal(score.fields["taxLines.amount"].correct, 1);
  assert.equal(scoreReceipt(label, prediction({ supportedFields: [] })).fields["taxLines.amount"].unsupported, 1);
  const missing = scoreReceipt(label, null);
  assert.equal(missing.fields["taxLines.amount"].missingRecording, 1);
  assert.equal(missing.fields["taxLines.rate"].unprinted, 1);
});
